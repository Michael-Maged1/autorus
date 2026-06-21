const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');
const fetch = require('node-fetch');

admin.initializeApp();
const db = admin.firestore();

// Helper to convert hex color to PDF RGB
function hexToRgb(hex) {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = parseInt(cleanHex.slice(4, 6), 16) / 255;
  return rgb(
    isNaN(r) ? 0.29 : r,
    isNaN(g) ? 0.56 : g,
    isNaN(b) ? 0.85 : b
  );
}

// Convert Firestore Timestamp to JS Date
function toDate(val) {
  if (!val) return null;
  if (typeof val.toDate === 'function') return val.toDate();
  if (typeof val.seconds === 'number') return new Date(val.seconds * 1000);
  return new Date(val);
}

// Check subscription state securely on the server
async function checkSubscription(uid, guestId, fingerprint) {
  const result = {
    status: 'trial',
    allowed: true,
    watermark: true,
    message: ''
  };

  // 1. Verify user document (if logged in)
  if (uid) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      if (data.isBlocked) {
        return { status: 'blocked', allowed: false, message: 'تم حظر هذا الحساب من قبل الإدارة.' };
      }
      if (data.isPaid) {
        const end = toDate(data.subscriptionEnd);
        if (!end || end.getTime() > Date.now()) {
          return { status: 'paid', allowed: true, watermark: false };
        }
      }
    }
  }

  // 2. Verify guest document (if visitor)
  if (guestId) {
    const guestDoc = await db.collection('guests').doc(guestId).get();
    if (guestDoc.exists) {
      const data = guestDoc.data();
      if (data.isBlocked) {
        return { status: 'blocked', allowed: false, message: 'تم حظر هذا الحساب من قبل الإدارة.' };
      }
      if (data.isPaid) {
        const end = toDate(data.subscriptionEnd);
        if (!end || end.getTime() > Date.now()) {
          return { status: 'paid', allowed: true, watermark: false };
        }
      }
    }
  }

  // 3. Verify device fingerprint record
  if (fingerprint) {
    const deviceDoc = await db.collection('deviceFingerprints').doc(fingerprint).get();
    if (deviceDoc.exists) {
      const data = deviceDoc.data();
      if (data.status === 'blocked') {
        return { status: 'blocked', allowed: false, message: 'تم حظر هذا الجهاز من قبل الإدارة.' };
      }
      if (data.status === 'expired') {
        return { status: 'expired', allowed: false, message: 'انتهت الفترة التجريبية المجانية.' };
      }
      const trialEnd = toDate(data.trialEnd);
      if (trialEnd && trialEnd.getTime() < Date.now()) {
        // Update device status in db to expired
        await db.collection('deviceFingerprints').doc(fingerprint).update({ status: 'expired' });
        return { status: 'expired', allowed: false, message: 'انتهت الفترة التجريبية المجانية.' };
      }
      return { status: 'trial', allowed: true, watermark: true };
    }
  }

  // 4. Fallback if no records found (Treat as new trial)
  return { status: 'trial', allowed: true, watermark: true };
}

// Cloud Function endpoint
exports.exportPrintReadyPDF = functions.https.onRequest(async (req, res) => {
  // CORS setup
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const { layoutResult, config, fingerprint, guestId, checkOnly } = req.body;

    // Determine authentication status
    let uid = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1];
      try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        uid = decodedToken.uid;
      } catch (authError) {
        console.warn("Invalid ID Token, continuing as unauthenticated/guest:", authError);
      }
    }

    // Verify licensing status on the server
    const lic = await checkSubscription(uid, guestId, fingerprint);
    if (!lic.allowed) {
      res.status(403).json({ error: lic.message || 'غير مسموح لك بإجراء هذه العملية.' });
      return;
    }

    if (checkOnly) {
      res.status(200).json({ success: true, allowed: true });
      return;
    }

    if (!layoutResult || !config) {
      res.status(400).json({ error: 'Missing required layout parameters' });
      return;
    }

    // --- PDF Generation using pdf-lib ---
    const pdfDoc = await PDFDocument.create();
    const unit = config.unit || 'cm';
    const paperW = config.paperW;
    const paperH = config.paperH;

    // Scaling factor from unit to PDF points (1 inch = 72 points)
    let scale = 72 / 2.54; // default cm
    if (unit === 'mm') {
      scale = 72 / 25.4;
    } else if (unit === 'inch' || unit === 'in') {
      scale = 72;
    } else if (unit === 'px') {
      scale = 1;
    }

    const pagesToRender = (layoutResult.pages && layoutResult.pages.length > 0)
      ? layoutResult.pages
      : [layoutResult];

    const imageCache = {};

    for (let pIdx = 0; pIdx < pagesToRender.length; pIdx++) {
      const pageData = pagesToRender[pIdx];
      const page = pdfDoc.addPage([paperW * scale, paperH * scale]);

      if (pageData.packed) {
        for (const pi of pageData.packed) {
          const bleedV = pi.bleed || 0;
          const origW = pi.rotated ? (pi.item.origH || pi.item.h) : (pi.item.origW || pi.item.w);
          const origH = pi.rotated ? (pi.item.origW || pi.item.w) : (pi.item.origH || pi.item.h);

          // Calculate screen bounding boxes of trim area
          const trimX = pi.x + bleedV;
          const trimY = pi.y + bleedV;
          const trimW = pi.rotated ? origH : origW;
          const trimH = pi.rotated ? origW : origH;

          // PDF coordinate space conversion: (y is inverted)
          const pdfTrimX = trimX * scale;
          const pdfTrimY = (paperH - (trimY + trimH)) * scale;

          let embeddedImg = null;
          const imageSrc = pi.item.imageSrc;

          if (imageSrc) {
            // Check memory cache to optimize embedding
            if (imageCache[imageSrc]) {
              embeddedImg = imageCache[imageSrc];
            } else {
              try {
                let imgBuffer = null;
                let isPng = false;

                if (imageSrc.startsWith('data:image/')) {
                  // Local base64 parsing
                  const match = imageSrc.match(/^data:image\/(\w+);base64,(.+)$/);
                  if (match) {
                    const format = match[1];
                    isPng = format.toLowerCase() === 'png';
                    imgBuffer = Buffer.from(match[2], 'base64');
                  }
                } else if (imageSrc.startsWith('http')) {
                  // Fetch remote URL
                  const fetchResp = await fetch(imageSrc);
                  if (fetchResp.ok) {
                    imgBuffer = await fetchResp.buffer();
                    const contentType = fetchResp.headers.get('content-type') || '';
                    isPng = contentType.includes('png') || imageSrc.toLowerCase().endsWith('.png');
                  }
                }

                if (imgBuffer) {
                  if (isPng) {
                    embeddedImg = await pdfDoc.embedPng(imgBuffer);
                  } else {
                    embeddedImg = await pdfDoc.embedJpg(imgBuffer);
                  }
                  imageCache[imageSrc] = embeddedImg; // cache it
                }
              } catch (imgError) {
                console.warn(`Failed to process/embed image for item: ${pi.item.name}`, imgError);
              }
            }
          }

          if (embeddedImg) {
            // Draw embedded product image
            if (pi.rotated) {
              page.drawImage(embeddedImg, {
                x: pdfTrimX,
                y: pdfTrimY + trimH * scale,
                width: origW * scale,
                height: origH * scale,
                rotate: degrees(-90)
              });
            } else {
              page.drawImage(embeddedImg, {
                x: pdfTrimX,
                y: pdfTrimY,
                width: origW * scale,
                height: origH * scale
              });
            }
          } else {
            // Draw colored placeholder rectangle if no image exists
            const colorHex = pi.item.color || '#4A90D9';
            const rgbColor = hexToRgb(colorHex);
            page.drawRectangle({
              x: pdfTrimX,
              y: pdfTrimY,
              width: trimW * scale,
              height: trimH * scale,
              color: rgbColor
            });

            // Draw item number or name text
            try {
              const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
              const labelText = String(pi.item.name || 'Product');
              page.drawText(labelText, {
                x: pdfTrimX + 5,
                y: pdfTrimY + (trimH * scale) / 2,
                size: Math.max(6, Math.min(12, trimW * scale * 0.1)),
                font: font,
                color: rgb(1, 1, 1)
              });
            } catch (txtErr) {
              // Ignore text drawing failures
            }
          }
        }
      }

      // 4. Server-Side Watermark Application for trials (un-bypassable)
      if (lic.watermark) {
        const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const watermarkText = 'TRIAL VERSION - https://autorus.free.nf/';
        const fontSize = Math.max(12, Math.round(paperW * scale * 0.035));
        const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);
        
        // Draw diagonal watermark text at the center of the page
        const wx = (paperW * scale - textWidth) / 2;
        const wy = (paperH * scale) / 2;
        
        page.drawText(watermarkText, {
          x: wx,
          y: wy,
          size: fontSize,
          font: font,
          color: rgb(0.5, 0.5, 0.5),
          opacity: 0.2,
          rotate: degrees(30)
        });
      }
    }

    const pdfBytes = await pdfDoc.save();
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    // Register backend operation usage metrics
    try {
      if (fingerprint) {
        const devRef = db.collection('deviceFingerprints').doc(fingerprint);
        await devRef.update({
          pdfExports: admin.firestore.FieldValue.increment(1)
        });
      }
    } catch (metricError) {
      console.warn("Failed to increment usage limits:", metricError);
    }

    res.status(200).json({
      success: true,
      pdfData: pdfBase64
    });

  } catch (error) {
    console.error("Critical server-side PDF export error:", error);
    res.status(500).json({ error: 'Internal Server Error: ' + error.message });
  }
});
