/**
 * اوتو رص - نظام التصدير الاحترافي
 * Auto Rass - Professional Export System
 *
 * يدعم:
 * - PNG عالي الجودة (300 DPI)
 * - PDF جاهز للطباعة (مع صورة الـ layout)
 * - تصدير print-ready بأبعاد حقيقية
 * - تقرير مفصل
 */

'use strict';

const ExportSystem = (() => {

  const CLOUD_FUNCTION_URL = 'https://us-central1-auto-rus-2c07a.cloudfunctions.net/exportPrintReadyPDF';

  async function getIdToken() {
    if (window.firebase && firebase.auth().currentUser) {
      try {
        return await firebase.auth().currentUser.getIdToken(true);
      } catch (e) {
        console.warn("Failed to get Firebase Auth ID Token:", e);
      }
    }
    return null;
  }

  async function checkServerAccess() {
    const token = await getIdToken();
    const fingerprint = window.ProtectionSystem ? window.ProtectionSystem.getState().fingerprint : null;
    const guestId = window.ProtectionSystem ? window.ProtectionSystem.getState().guestId : null;

    try {
      const response = await fetch(CLOUD_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          checkOnly: true,
          fingerprint,
          guestId
        })
      });

      if (response.status === 403) {
        const data = await response.json();
        throw new Error(data.error || 'تم إيقاف صلاحية التصدير لهذا الحساب/الجهاز.');
      }
    } catch (e) {
      if (e.message.includes('حظر') || e.message.includes('انتهت') || e.message.includes('إيقاف') || e.message.includes('غير مسموح')) {
        throw e;
      }
      console.warn("Server access check failed with network error, allowing local fallback:", e);
    }
  }

  /**
   * تصدير Preview PNG عالي الجودة
   */
  function exportPNG(canvasEl, filename = 'auto-rass-layout.png') {
    try {
      let dataURL;
      if (window.CanvasRenderer) {
        dataURL = CanvasRenderer.exportToPNG(300);
      } else if (canvasEl) {
        dataURL = canvasEl.toDataURL('image/png', 1.0);
      }
      if (!dataURL) { showToast('لا يوجد مخطط للتصدير', 'warning'); return; }
      downloadDataURL(dataURL, filename);
      showToast('تم تصدير الصورة بنجاح! (300 DPI)', 'success');
    } catch (e) {
      console.error('خطأ في تصدير PNG:', e);
      showToast('خطأ في التصدير: ' + e.message, 'error');
    }
  }

  /**
   * تصدير Print-Ready PNG بأبعاد حقيقية 1:1
   * مناسب مباشرة للطباعة الاحترافية
   */
  async function exportPrintReady(filename = 'auto-rass-print-ready.png', format = 'png') {
    try {
      if (!window.CanvasRenderer) {
        showToast('المحرك غير متاح', 'error');
        return;
      }
      
      showToast('جاري التحقق من صلاحيات التصدير سحابياً...', 'info');
      try {
        await checkServerAccess();
      } catch (authErr) {
        showToast(authErr.message, 'error');
        return;
      }

      showToast('جاري إنشاء ملف الطباعة...', 'info');
      setTimeout(() => {
        try {
          const dataURL = CanvasRenderer.exportPrintReady(300, null, format);
          if (!dataURL) { showToast('لا يوجد مخطط للتصدير', 'warning'); return; }
          downloadDataURL(dataURL, filename);
          showToast(`✅ تم تصدير ملف الطباعة جاهز للمطبعة! (300 DPI - ${format.toUpperCase()})`, 'success');
        } catch (err) {
          showToast('خطأ في إنشاء ملف الطباعة: ' + err.message, 'error');
        }
      }, 100);
    } catch (e) {
      console.error('خطأ في تصدير Print-Ready:', e);
      showToast('خطأ في التصدير', 'error');
    }
  }

  /**
   * تصدير ملف PDF للطباعة بأبعاد حقيقية 1:1 بجودة 300 DPI
   */
  async function exportPrintReadyPDF(result, config, filename = 'auto-rass-print-ready.pdf') {
    try {
      if (!window.CanvasRenderer) {
        showToast('المحرك غير متاح', 'error');
        return;
      }
      if (!result) {
        showToast('لا يوجد مخطط للتصدير. احسب الرص أولاً.', 'warning');
        return;
      }

      showToast('جاري إعداد ملف الـ PDF للطباعة سحابياً...', 'info');

      const token = await getIdToken();
      const fingerprint = window.ProtectionSystem ? window.ProtectionSystem.getState().fingerprint : null;
      const guestId = window.ProtectionSystem ? window.ProtectionSystem.getState().guestId : null;

      try {
        const response = await fetch(CLOUD_FUNCTION_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          body: JSON.stringify({
            layoutResult: result,
            config: config,
            fingerprint,
            guestId
          })
        });

        if (response.status === 200) {
          const resJson = await response.json();
          if (resJson.success && resJson.pdfData) {
            const binaryString = atob(resJson.pdfData);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const blobUrl = URL.createObjectURL(blob);
            downloadDataURL(blobUrl, filename);
            URL.revokeObjectURL(blobUrl);
            
            if (window.ProtectionSystem && window.ProtectionSystem.incrementLimit) {
              window.ProtectionSystem.incrementLimit('pdfExports');
            }
            showToast('✅ تم تصدير ملف PDF جاهز للمطبعة بنجاح! (300 DPI)', 'success');
            return;
          }
        } else if (response.status === 403) {
          const errData = await response.json();
          showToast(errData.error || 'تم إيقاف صلاحية التصدير لهذا الحساب/الجهاز.', 'error');
          return;
        }
        
        throw new Error('فشل السيرفر في توليد الملف.');

      } catch (err) {
        if (err.message.includes('حظر') || err.message.includes('انتهت') || err.message.includes('إيقاف') || err.message.includes('غير مسموح')) {
          showToast(err.message, 'error');
          return;
        }

        console.warn("Server-side export failed, falling back to client-side:", err);
        showToast('جاري التصدير محلياً (السيرفر غير متصل)...', 'warning');
      }

      // --- LOCAL FALLBACK ---
      // Check if jsPDF is available
      if (typeof window.jspdf === 'undefined') {
        showToast('جاري تحميل مكتبة PDF...', 'info');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      }

      const { jsPDF } = window.jspdf;
      const unit = config.unit || 'cm';
      const paperW = config.paperW;
      const paperH = config.paperH;

      // Determine jsPDF unit
      const pdfUnit = unit === 'inch' ? 'in' : (unit === 'px' ? 'px' : unit);
      const orientation = paperW > paperH ? 'landscape' : 'portrait';

      // Create PDF document with exact dimensions
      const doc = new jsPDF({
        orientation: orientation,
        unit: pdfUnit,
        format: [paperW, paperH]
      });

      // Render each page (if multi-page layout) or a single page
      const pagesToRender = (result.pages && result.pages.length > 0) ? result.pages : [result];

      for (let i = 0; i < pagesToRender.length; i++) {
        if (i > 0) {
          doc.addPage([paperW, paperH], orientation);
        }

        // Render high-res image (300 DPI) for printing
        const dataURL = window.CanvasRenderer.exportPrintReady(300, pagesToRender[i]);
        if (!dataURL) {
          throw new Error('فشل إنشاء صورة الرص عالية الدقة للورقة ' + (i + 1));
        }

        // Add to PDF
        doc.addImage(dataURL, 'PNG', 0, 0, paperW, paperH, undefined, 'FAST');
      }

      doc.save(filename);
      if (window.ProtectionSystem && window.ProtectionSystem.incrementLimit) {
        window.ProtectionSystem.incrementLimit('pdfExports');
      }
      showToast('✅ تم تصدير ملف PDF محلياً بنجاح! (300 DPI)', 'success');
    } catch (e) {
      console.error('PDF export error:', e);
      showToast('خطأ أثناء تصدير PDF: ' + e.message, 'error');
    }
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * تصدير PDF تقرير + صورة الـ Layout
   */
  function exportPDF(result, products, costResult, config) {
    // الحصول على صورة الـ layout بدقة عالية
    let layoutImageURL = null;
    if (window.CanvasRenderer && result) {
      try {
        layoutImageURL = CanvasRenderer.exportToPNG(150);
      } catch (e) {
        console.warn('لم يتمكن من تصدير صورة Layout:', e);
      }
    }

    const printContent = generatePrintHTML(result, products, costResult, config, layoutImageURL);

    const printWin = window.open('', '_blank', 'width=1000,height=800');
    if (!printWin) {
      showToast('يُرجى السماح بفتح النوافذ المنبثقة', 'warning');
      return;
    }
    printWin.document.write(printContent);
    printWin.document.close();
    if (window.ProtectionSystem && window.ProtectionSystem.incrementLimit) {
      window.ProtectionSystem.incrementLimit('pdfExports');
    }
    printWin.focus();

    setTimeout(() => {
      printWin.print();
    }, 1000);
  }

  /**
   * توليد HTML للطباعة مع صورة الـ Layout
   */
  function generatePrintHTML(result, products, costResult, config, layoutImageURL = null) {
    const rawUnit = config?.unit || 'cm';
    let unit = 'سم';
    if (rawUnit === 'mm') unit = 'مم';
    else if (rawUnit === 'cm' || rawUnit === 'سم') unit = 'سم';
    else if (rawUnit === 'inch' || rawUnit === 'in') unit = 'بوصة';
    else if (rawUnit === 'px') unit = 'بكسل';
    else unit = rawUnit;
    const now  = new Date().toLocaleDateString('ar-EG', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const productRows = (products || []).map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHTML(p.name)}</td>
        <td dir="ltr">${p.w} × ${p.h} ${unit}</td>
        <td>${p.qty || 1}</td>
        <td>${p.canRotate ? '✓' : '✗'}</td>
        <td>${p.imageSrc ? '🖼️ مرفوع' : '—'}</td>
      </tr>
    `).join('');

    const costHTML = costResult ? `
      <div class="section">
        <div class="section-title">💰 تفاصيل التكلفة</div>
        <table>
          <tbody>
            <tr><td>إجمالي التكلفة</td><td><strong>${fmtCur(costResult.grandTotal, costResult.currency)}</strong></td></tr>
            <tr><td>تكلفة القطعة الواحدة</td><td>${fmtCur(costResult.costPerPiece, costResult.currency)}</td></tr>
            <tr><td>تكلفة الورق</td><td>${fmtCur(costResult.paperCostTotal, costResult.currency)}</td></tr>
            <tr><td>تكلفة الطباعة</td><td>${fmtCur(costResult.printCostTotal, costResult.currency)}</td></tr>
            <tr><td>تكلفة التشطيب</td><td>${fmtCur(costResult.finishCostTotal, costResult.currency)}</td></tr>
          </tbody>
        </table>
      </div>
    ` : '';

    const layoutHTML = layoutImageURL ? `
      <div class="section">
        <div class="section-title">🗺️ مخطط الرص</div>
        <div style="text-align:center;margin-top:10px">
          <img src="${layoutImageURL}" style="max-width:100%;border:1px solid #ddd;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.15);" />
          <div style="font-size:11px;color:#888;margin-top:6px">المخطط المرئي لترتيب القطع على الفرخة</div>
        </div>
      </div>
    ` : '';

    const effColor = result && result.efficiency >= 70 ? '#2e7d32' :
                     result && result.efficiency >= 50 ? '#e65100' : '#c62828';

    return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>تقرير الرص - اوتو رص</title>
  <!-- Google Fonts: Cairo & IBM Plex Sans Arabic -->
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Cairo', 'IBM Plex Sans Arabic', Arial, sans-serif;
      color: #1a1a2e;
      background: white;
      padding: 32px;
      direction: rtl;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 20px;
      border-bottom: 3px solid #1565C0;
      margin-bottom: 28px;
    }
    .logo       { font-size: 26px; font-weight: 700; color: #1565C0; }
    .logo-sub   { font-size: 12px; color: #777; margin-top: 3px; }
    .date       { font-size: 12px; color: #999; }
    .section    { margin-bottom: 28px; }
    .section-title {
      font-size: 15px; font-weight: 700; color: #1565C0;
      margin-bottom: 14px; padding-bottom: 7px;
      border-bottom: 1px solid #E3F2FD;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 8px;
    }
    .stat-box {
      border: 1px solid #E3F2FD;
      border-radius: 10px;
      padding: 16px;
      text-align: center;
      background: #F8FBFF;
    }
    .stat-box-value { font-size: 24px; font-weight: 700; }
    .stat-box-label { font-size: 11px; color: #888; margin-top: 5px; }
    .config-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .config-item     { font-size: 12px; }
    .config-label    { color: #888; margin-bottom: 2px; }
    .config-value    { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 9px 12px; text-align: right; border-bottom: 1px solid #eee; }
    th { background: #E3F2FD; font-weight: 600; color: #1565C0; }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #eee;
      font-size: 11px; color: #bbb; text-align: center;
    }
    .badge-eff {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      background: #E8F5E9;
      color: #2e7d32;
    }
    @media print {
      body { padding: 20px; }
      .stats-grid { grid-template-columns: repeat(4, 1fr); }
    }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <div class="logo">اوتو رص</div>
      <div class="logo-sub">نظام الرص الذكي للمطابع الاحترافية</div>
    </div>
    <div class="date">تاريخ التقرير: ${now}</div>
  </div>

  <div class="section">
    <div class="section-title">📊 ملخص الرص</div>
    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-box-value" style="color:${effColor}">${result ? result.efficiency.toFixed(1) : 0}%</div>
        <div class="stat-box-label">نسبة الاستغلال</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-value" style="color:#e65100">${result ? result.waste.toFixed(1) : 0}%</div>
        <div class="stat-box-label">نسبة الهالك</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-value" style="color:#1565C0">${result ? result.itemCount : 0}</div>
        <div class="stat-box-label">قطعة في الورقة</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-value" style="color:#6a1b9a">${result ? result.sheetsNeeded : 0}</div>
        <div class="stat-box-label">عدد الأوراق</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">⚙️ إعدادات الطباعة</div>
    <div class="config-grid">
      <div class="config-item">
        <div class="config-label">حجم الورقة</div>
        <div class="config-value" dir="ltr">${config ? config.paperW + ' × ' + config.paperH + ' ' + unit : '—'}</div>
      </div>
      <div class="config-item">
        <div class="config-label">Bleed</div>
        <div class="config-value">${config ? config.bleed : 0} ${unit}</div>
      </div>
      <div class="config-item">
        <div class="config-label">Gutter</div>
        <div class="config-value">${config ? config.gutter : 0} ${unit}</div>
      </div>
      <div class="config-item">
        <div class="config-label">هامش الورقة</div>
        <div class="config-value">${config ? config.paperMargin : 0} ${unit}</div>
      </div>
      <div class="config-item">
        <div class="config-label">الخوارزمية</div>
        <div class="config-value">${result ? result.algorithm : '—'}</div>
      </div>
      <div class="config-item">
        <div class="config-label">وحدة القياس</div>
        <div class="config-value">${unit}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">📦 المنتجات</div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>اسم المنتج</th>
          <th>المقاس</th>
          <th>الكمية</th>
          <th>تدوير</th>
          <th>تصميم</th>
        </tr>
      </thead>
      <tbody>${productRows}</tbody>
    </table>
  </div>

  ${costHTML}

  ${layoutHTML}

  <div class="footer">
    تم إنشاء هذا التقرير بواسطة <strong>اوتو رص</strong> — الرص الذكي للمطابع الاحترافية
  </div>

</body>
</html>
    `;
  }

  function fmtCur(amount, currency = 'ج.م') {
    if (amount == null) return '—';
    return amount.toFixed(2) + ' ' + currency;
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function downloadDataURL(dataURL, filename) {
    const link    = document.createElement('a');
    link.download = filename;
    link.href     = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * تصدير المشروع كـ JSON
   */
  function exportProject(project, filename) {
    const data = JSON.stringify(project, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename || `${project.name || 'project'}.json`;
    link.href     = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  function showToast(msg, type = 'info') {
    if (window.AppUI && window.AppUI.showToast) {
      window.AppUI.showToast(msg, type);
    }
  }

  return {
    exportPNG,
    exportPDF,
    exportPrintReady,
    exportPrintReadyPDF,
    exportProject,
    generatePrintHTML
  };

})();

window.ExportSystem = ExportSystem;
