/**
 * اوتو رص - قارئ الملفات الاحترافي
 * Auto Rass - Professional File Reader
 *
 * استخراج مقاسات الملفات (PDF, SVG, PNG, JPG) وتحويلها إلى صور عالية الجودة
 */

'use strict';

const FileReaderHelper = (() => {

  /**
   * معالجة ملف مرفوع
   */
  async function processFile(file) {
    const type = file.type;
    const name = file.name.toLowerCase();

    if (name.endsWith('.svg')) {
      return await readSVG(file);
    } else if (type === 'application/pdf' || name.endsWith('.pdf')) {
      return await readPDF(file);
    } else if (type.startsWith('image/')) {
      return await readImage(file);
    } else {
      return {
        name: file.name.replace(/\.[^.]+$/, ''),
        error: 'نوع الملف غير مدعوم للاستخراج التلقائي',
        manualRequired: true
      };
    }
  }

  /**
   * قراءة SVG واستخراج المقاسات
   */
  async function readSVG(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const parser = new DOMParser();
          const doc = parser.parseFromString(text, 'image/svg+xml');
          const svg = doc.querySelector('svg');

          if (!svg) {
            resolve({ name: file.name, error: 'ملف SVG غير صالح', manualRequired: true });
            return;
          }

          let w = parseFloat(svg.getAttribute('width') || 0);
          let h = parseFloat(svg.getAttribute('height') || 0);
          const viewBox = svg.getAttribute('viewBox');

          if ((!w || !h) && viewBox) {
            const parts = viewBox.split(/\s+|,/);
            if (parts.length >= 4) {
              w = parseFloat(parts[2]);
              h = parseFloat(parts[3]);
            }
          }

          // تحويل من px إلى mm (96dpi)
          const wUnit = svg.getAttribute('width') || '';
          if (wUnit.includes('mm')) {
            // بالفعل بالمليمتر
          } else if (wUnit.includes('cm')) {
            w *= 10; h *= 10;
          } else if (wUnit.includes('in')) {
            w *= 25.4; h *= 25.4;
          } else {
            // افتراض pixels @ 96dpi
            w = w * 25.4 / 96;
            h = h * 25.4 / 96;
          }

          // قراءة المحتوى كـ Data URL للعرض والرسم
          const reader2 = new FileReader();
          reader2.onload = (ev) => {
            resolve({
              name: file.name.replace('.svg', ''),
              w: Math.round(w),
              h: Math.round(h),
              source: 'SVG',
              imageSrc: ev.target.result
            });
          };
          reader2.readAsDataURL(file);

        } catch (err) {
          resolve({ name: file.name, error: err.message, manualRequired: true });
        }
      };
      reader.readAsText(file);
    });
  }

  /**
   * استخراج DPI من ملفات PNG و JPEG لقراءة المقاسات الحقيقية للطباعة
   */
  function getImageDPI(arrayBuffer, fileType) {
    const view = new DataView(arrayBuffer);
    
    // 1. PNG
    if (fileType === 'image/png' || fileType.includes('png')) {
      let pos = 8;
      while (pos < view.byteLength - 8) {
        const length = view.getUint32(pos);
        const type = String.fromCharCode(
          view.getUint8(pos + 4),
          view.getUint8(pos + 5),
          view.getUint8(pos + 6),
          view.getUint8(pos + 7)
        );
        if (type === 'pHYs') {
          const ppcX = view.getUint32(pos + 8);
          const ppcY = view.getUint32(pos + 12);
          const unit = view.getUint8(pos + 16);
          if (unit === 1) { // 1 = meter
            const dpiX = Math.round(ppcX * 0.0254);
            const dpiY = Math.round(ppcY * 0.0254);
            return { dpiX, dpiY };
          }
          break;
        }
        pos += 12 + length;
      }
    }
    
    // 2. JPEG
    if (fileType === 'image/jpeg' || fileType.includes('jpg') || fileType.includes('jpeg')) {
      let pos = 0;
      if (view.getUint16(pos) === 0xFFD8) { // SOI
        pos += 2;
        while (pos < view.byteLength - 4) {
          const marker = view.getUint16(pos);
          const length = view.getUint16(pos + 2);
          
          if (marker === 0xFFE0) { // APP0 (JFIF)
            if (view.getUint8(pos + 4) === 0x4A && // J
                view.getUint8(pos + 5) === 0x46 && // F
                view.getUint8(pos + 6) === 0x49 && // I
                view.getUint8(pos + 7) === 0x46 && // F
                view.getUint8(pos + 8) === 0x00) { // \0
              const unit = view.getUint8(pos + 11);
              const dpiX = view.getUint16(pos + 12);
              const dpiY = view.getUint16(pos + 14);
              if (unit === 1) { // inches
                return { dpiX, dpiY };
              } else if (unit === 2) { // cm
                return { dpiX: Math.round(dpiX * 2.54), dpiY: Math.round(dpiY * 2.54) };
              }
            }
          } else if (marker === 0xFFE1) { // APP1 (Exif)
            if (view.getUint8(pos + 4) === 0x45 && // E
                view.getUint8(pos + 5) === 0x78 && // x
                view.getUint8(pos + 6) === 0x69 && // i
                view.getUint8(pos + 7) === 0x66 && // f
                view.getUint8(pos + 8) === 0x00) { // \0
              
              const tiffOffset = pos + 10;
              const isLittleEndian = view.getUint16(tiffOffset) === 0x4949; // "II"
              const ifdOffset = view.getUint32(tiffOffset + 4, isLittleEndian);
              
              let dirOffset = tiffOffset + ifdOffset;
              if (dirOffset + 2 <= view.byteLength) {
                const entriesCount = view.getUint16(dirOffset, isLittleEndian);
                dirOffset += 2;
                
                let dpiX = null, dpiY = null, unit = 2; // default unit 2 = inches
                
                for (let i = 0; i < entriesCount; i++) {
                  if (dirOffset + 12 > view.byteLength) break;
                  const tag = view.getUint16(dirOffset, isLittleEndian);
                  const type = view.getUint16(dirOffset + 2, isLittleEndian);
                  const count = view.getUint32(dirOffset + 4, isLittleEndian);
                  const valueOffset = view.getUint32(dirOffset + 8, isLittleEndian);
                  
                  if (tag === 0x011A) { // XResolution
                    if (type === 5) { // RATIONAL
                      const valOffset = tiffOffset + valueOffset;
                      if (valOffset + 8 <= view.byteLength) {
                        const num = view.getUint32(valOffset, isLittleEndian);
                        const den = view.getUint32(valOffset + 4, isLittleEndian);
                        if (den !== 0) dpiX = Math.round(num / den);
                      }
                    }
                  } else if (tag === 0x011B) { // YResolution
                    if (type === 5) {
                      const valOffset = tiffOffset + valueOffset;
                      if (valOffset + 8 <= view.byteLength) {
                        const num = view.getUint32(valOffset, isLittleEndian);
                        const den = view.getUint32(valOffset + 4, isLittleEndian);
                        if (den !== 0) dpiY = Math.round(num / den);
                      }
                    }
                  } else if (tag === 0x0128) { // ResolutionUnit
                    unit = view.getUint16(dirOffset + 8, isLittleEndian);
                  }
                  dirOffset += 12;
                }
                
                if (dpiX) {
                  if (unit === 3) { // 3 = cm
                    dpiX = Math.round(dpiX * 2.54);
                    if (dpiY) dpiY = Math.round(dpiY * 2.54);
                  }
                  return { dpiX, dpiY: dpiY || dpiX };
                }
              }
            }
          }
          
          if (marker >= 0xFFD0 && marker <= 0xFFD9) { // RST or SOI/EOI
            pos += 2;
          } else {
            pos += 2 + length;
          }
        }
      }
    }
    
    return null;
  }

  /**
   * قراءة صورة واستخراج الأبعاد
   */
  async function readImage(file) {
    return new Promise((resolve) => {
      const arrayReader = new FileReader();
      arrayReader.onload = (eArray) => {
        const arrayBuffer = eArray.target.result;
        const dpiInfo = getImageDPI(arrayBuffer, file.type);
        
        const urlReader = new FileReader();
        urlReader.onload = (eUrl) => {
          const dataUrl = eUrl.target.result;
          const img = new Image();
          img.onload = () => {
            const dpi = (dpiInfo && dpiInfo.dpiX > 30) ? dpiInfo.dpiX : 96;
            const wMm = Math.round(img.naturalWidth * 25.4 / dpi);
            const hMm = Math.round(img.naturalHeight * 25.4 / dpi);
            resolve({
              name: file.name.replace(/\.[^.]+$/, ''),
              w: wMm,
              h: hMm,
              source: 'Image',
              imageSrc: dataUrl,
              note: dpiInfo 
                ? `تم استخراج المقاسات بدقة ${dpi} DPI` 
                : 'المقاسات بناءً على 96dpi - تحقق من الأبعاد الفعلية للطباعة'
            });
          };
          img.onerror = () => {
            resolve({ name: file.name, error: 'تعذر قراءة الصورة', manualRequired: true });
          };
          img.src = dataUrl;
        };
        urlReader.readAsDataURL(file);
      };
      arrayReader.readAsArrayBuffer(file);
    });
  }

  /**
   * قراءة PDF (تحميل ديناميكي لـ PDF.js ورسم الصفحة الأولى بدقة 300 DPI)
   */
  async function readPDF(file) {
    return new Promise((resolve) => {
      const loadPdfjs = () => {
        if (typeof window.pdfjsLib !== 'undefined') return Promise.resolve();
        return new Promise((res, rej) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          script.onload = res;
          script.onerror = rej;
          document.head.appendChild(script);
        });
      };

      loadPdfjs().then(() => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const fileReader = new FileReader();
        fileReader.onload = async (e) => {
          try {
            const bytes = new Uint8Array(e.target.result);
            const loadingTask = window.pdfjsLib.getDocument({ data: bytes });
            const pdf = await loadingTask.promise;

            if (pdf.numPages === 0) {
              resolve({ name: file.name, error: 'الملف لا يحتوي على صفحات', manualRequired: true });
              return;
            }

            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 1.0 });

            // 1 point = 0.352778 mm
            const ptToMm = 0.352778;
            const wMm = Math.round(viewport.width * ptToMm);
            const hMm = Math.round(viewport.height * ptToMm);

            // رندر الصفحة الأولى بدقة عالية للطباعة والمعاينة
            const scale = 3.0; // دقة كافية جداً للتصميمات الصغيرة والكبيرة
            const renderViewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = renderViewport.width;
            canvas.height = renderViewport.height;
            const ctx = canvas.getContext('2d');

            await page.render({
              canvasContext: ctx,
              viewport: renderViewport
            }).promise;

            const imageSrc = canvas.toDataURL('image/png');

            resolve({
              name: file.name.replace('.pdf', ''),
              w: wMm,
              h: hMm,
              source: 'PDF',
              imageSrc
            });
          } catch (err) {
            console.error('PDF parsing error, falling back:', err);
            resolve(fallbackReadPDF(e.target.result, file.name));
          }
        };
        fileReader.readAsArrayBuffer(file);
      }).catch((err) => {
        console.error('Failed to load PDF.js CDN:', err);
        const fileReader = new FileReader();
        fileReader.onload = (e) => {
          resolve(fallbackReadPDF(e.target.result, file.name));
        };
        fileReader.readAsArrayBuffer(file);
      });
    });
  }

  /**
   * استخراج MediaBox في حالة فشل PDF.js
   */
  function fallbackReadPDF(arrayBuffer, filename) {
    const bytes = new Uint8Array(arrayBuffer);
    const header = String.fromCharCode(...bytes.slice(0, 8));

    if (!header.startsWith('%PDF')) {
      return { name: filename, error: 'ليس ملف PDF صالح', manualRequired: true };
    }

    const text = new TextDecoder('latin1').decode(bytes.slice(0, 5000));
    const mediaBoxMatch = text.match(/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);

    if (mediaBoxMatch) {
      const ptToMm = 0.352778;
      const w = Math.round((parseFloat(mediaBoxMatch[3]) - parseFloat(mediaBoxMatch[1])) * ptToMm);
      const h = Math.round((parseFloat(mediaBoxMatch[4]) - parseFloat(mediaBoxMatch[2])) * ptToMm);
      return {
        name: filename.replace('.pdf', ''),
        w,
        h,
        source: 'PDF (مستخرج)'
      };
    } else {
      return {
        name: filename.replace('.pdf', ''),
        error: 'تعذر استخراج مقاسات PDF تلقائياً',
        manualRequired: true,
        hint: 'أدخل المقاسات يدوياً'
      };
    }
  }

  /**
   * معالجة عدة ملفات
   */
  async function processFiles(files, onProgress) {
    const results = [];
    let count = 0;
    for (const file of files) {
      const result = await processFile(file);
      results.push(result);
      count++;
      if (typeof onProgress === 'function') {
        onProgress(count, files.length);
      }
      // Yield control to the browser event loop to allow UI rendering and prevent freezing
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    return results;
  }

  return {
    processFile,
    processFiles
  };

})();

window.FileReaderHelper = FileReaderHelper;

