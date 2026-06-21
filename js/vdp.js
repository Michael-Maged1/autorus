/**
 * اوتو رص - وحدة طباعة البيانات المتغيرة (VDP)
 * Auto Rass - Variable Data Printing (VDP) Module
 */

'use strict';

const VDPManager = (() => {
  // ========================
  // حالة النظام الداخلية (State)
  // ========================
  const state = {
    currentStep: 1,
    templateFile: null,
    templateImage: null, // HTML Image Element
    templateNaturalW: 0,
    templateNaturalH: 0,
    
    // الأبعاد الفيزيائية الافتراضية للكارت (سم)
    cardWidthCm: 9.0,
    cardHeightCm: 5.5,

    // الحقول المتغيرة المعرفة
    fields: [], // { id, name, type, x, y, w, h, fontSize, color, align, fontWeight, fitOption, barcodeFormat }
    selectedFieldId: null,

    // البيانات المستوردة
    dataRows: [], // مصفوفة كائنات السجلات
    columnHeaders: [], // عناوين الأعمدة المستوردة من Excel
    columnMapping: {}, // تطابق الحقول: { fieldId: columnName }

    // الصور المرفوعة المتغيرة
    uploadedPhotos: {}, // { lowercase_filename: objectURL }

    // سجل المعاينة النشط
    currentRecordIndex: 0,

    // محرر الكانفاس الحركي
    editorScale: 1.0,
    canvasAction: null, // 'drag' | 'resize' | null
    activeHandle: null, // 'tl' | 'tr' | 'bl' | 'br' | null
    dragOffset: { x: 0, y: 0 },
    resizeStartRect: null,
    
    // معامل الزوم لمعاينة الكروت
    previewZoom: 1.0,
    
    // معامل الزوم لمحرر المتغيرات
    editorZoom: 1.0
  };

  // ========================
  // التهيئة المبدئية
  // ========================
  function init() {
    setupWizardNavigation();
    setupTemplateUpload();
    setupCanvasEditor();
    setupDataImport();
    setupPhotoUpload();
    setupPreviewAndExport();
    
    // تحديث أزرار المعاينة البدئية
    updateStepUI();
  }

  // ========================
  // 1. نظام الخطوات المتتالية (Wizard Navigation)
  // ========================
  function setupWizardNavigation() {
    const prevBtn = document.getElementById('vdp-prev-step-btn');
    const nextBtn = document.getElementById('vdp-next-step-btn');

    nextBtn.addEventListener('click', () => {
      if (validateStep(state.currentStep)) {
        if (state.currentStep < 5) {
          state.currentStep++;
          updateStepUI();
        }
      }
    });

    prevBtn.addEventListener('click', () => {
      if (state.currentStep > 1) {
        state.currentStep--;
        updateStepUI();
      }
    });
  }

  function validateStep(step) {
    if (step === 1 && !state.templateImage) {
      showToast('يرجى رفع قالب التصميم أولاً للمتابعة', 'warning');
      return false;
    }
    if (step === 3 && state.dataRows.length === 0) {
      showToast('يرجى استيراد أو إدخال بعض البيانات أولاً للمتابعة', 'warning');
      return false;
    }
    return true;
  }

  function updateStepUI() {
    // تحديث شريط الحالة العلوي
    document.querySelectorAll('.vdp-step').forEach(stepEl => {
      const stepNum = parseInt(stepEl.dataset.step);
      stepEl.classList.toggle('active', stepNum === state.currentStep);
      stepEl.classList.toggle('completed', stepNum < state.currentStep);
    });

    // تحديث محتوى الخطوات
    document.querySelectorAll('.vdp-step-content').forEach(contentEl => {
      const stepId = contentEl.id;
      contentEl.classList.toggle('active', stepId === `vdp-step-${state.currentStep}-content`);
    });

    // تحديث أزرار التنقل
    const prevBtn = document.getElementById('vdp-prev-step-btn');
    const nextBtn = document.getElementById('vdp-next-step-btn');

    prevBtn.style.visibility = state.currentStep === 1 ? 'hidden' : 'visible';
    
    if (state.currentStep === 5) {
      nextBtn.textContent = 'إنهاء وتوليد 🎉';
      nextBtn.style.display = 'none'; // نخفيه ونترك أزرار التصدير تقوم بالعمل
    } else {
      nextBtn.textContent = 'التالي';
      nextBtn.style.display = 'inline-flex';
    }

    // تهيئة محددة لكل خطوة عند فتحها
    if (state.currentStep === 2) {
      setTimeout(resizeEditorCanvas, 100);
    } else if (state.currentStep === 3) {
      renderColumnMapping();
    } else if (state.currentStep === 5) {
      state.currentRecordIndex = 0;
      renderRecordPreview();
    }
  }

  // ========================
  // 2. تحميل قالب التصميم (Step 1)
  // ========================
  function setupTemplateUpload() {
    const zone = document.getElementById('vdp-template-upload-zone');
    const fileInput = document.getElementById('vdp-template-file');

    zone.addEventListener('click', () => fileInput.click());
    
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleTemplateFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleTemplateFile(e.target.files[0]);
      }
    });
  }

  function handleTemplateFile(file) {
    if (!file) return;
    
    showToast('جاري تحميل قالب التصميم...', 'info');
    
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (ext === 'pdf') {
      // التعامل مع ملفات PDF باستخدام PDF.js
      if (typeof pdfjsLib === 'undefined') {
        showToast('مكتبة PDF.js غير محملة بعد، جاري الانتظار...', 'warning');
        return;
      }
      const fileReader = new FileReader();
      fileReader.onload = async function() {
        try {
          const typedarray = new Uint8Array(this.result);
          const pdf = await pdfjsLib.getDocument(typedarray).promise;
          const page = await pdf.getPage(1);
          
          const viewport = page.getViewport({ scale: 2.0 }); // دقة مضاعفة للمعينة
          const tempCanvas = document.createElement('canvas');
          const context = tempCanvas.getContext('2d');
          tempCanvas.width = viewport.width;
          tempCanvas.height = viewport.height;
          
          await page.render({ canvasContext: context, viewport: viewport }).promise;
          
          const img = new Image();
          img.onload = function() {
            state.templateImage = img;
            state.templateNaturalW = img.naturalWidth;
            state.templateNaturalH = img.naturalHeight;
            state.templateFile = file;
            state.editorZoom = 1.0;
            
            showToast('تم استخراج الصفحة الأولى لقالب الـ PDF بنجاح!', 'success');
            state.currentStep = 2;
            updateStepUI();
          };
          img.src = tempCanvas.toDataURL('image/png');
        } catch (e) {
          console.error(e);
          showToast('فشل قراءة ملف الـ PDF: ' + e.message, 'error');
        }
      };
      fileReader.readAsArrayBuffer(file);
    } else {
      // ملفات الصور التقليدية
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          state.templateImage = img;
          state.templateNaturalW = img.naturalWidth;
          state.templateNaturalH = img.naturalHeight;
          state.templateFile = file;
          state.editorZoom = 1.0;

          showToast('تم تحميل قالب التصميم بنجاح!', 'success');
          state.currentStep = 2;
          updateStepUI();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  }

  // ========================
  // 3. محرر القوالب والكانفاس (Step 2)
  // ========================
  function setupCanvasEditor() {
    const canvas = document.getElementById('vdp-editor-canvas');
    
    // ربط أزرار إضافة الحقول
    document.getElementById('vdp-add-text-btn').addEventListener('click', () => addField('text'));
    document.getElementById('vdp-add-image-btn').addEventListener('click', () => addField('image'));
    document.getElementById('vdp-add-qr-btn').addEventListener('click', () => addField('qr'));
    document.getElementById('vdp-add-barcode-btn').addEventListener('click', () => addField('barcode'));

    // ربط حقول تعديل أبعاد البطاقة
    const widthInput = document.getElementById('vdp-card-width');
    const heightInput = document.getElementById('vdp-card-height');

    widthInput.addEventListener('change', (e) => {
      state.cardWidthCm = parseFloat(e.target.value) || 9.0;
    });
    heightInput.addEventListener('change', (e) => {
      state.cardHeightCm = parseFloat(e.target.value) || 5.5;
    });

    // ربط نموذج الخصائص
    document.getElementById('vdp-prop-name').addEventListener('input', (e) => {
      updateActiveFieldProperty('name', e.target.value.trim());
    });
    document.getElementById('vdp-prop-font-size').addEventListener('input', (e) => {
      updateActiveFieldProperty('fontSize', parseInt(e.target.value) || 16);
    });
    document.getElementById('vdp-prop-color').addEventListener('input', (e) => {
      updateActiveFieldProperty('color', e.target.value);
    });
    document.getElementById('vdp-prop-align').addEventListener('change', (e) => {
      updateActiveFieldProperty('align', e.target.value);
    });
    document.getElementById('vdp-prop-font-weight').addEventListener('change', (e) => {
      updateActiveFieldProperty('fontWeight', e.target.value);
    });
    document.getElementById('vdp-prop-font-family').addEventListener('change', (e) => {
      updateActiveFieldProperty('fontFamily', e.target.value);
    });
    document.getElementById('vdp-prop-fit').addEventListener('change', (e) => {
      updateActiveFieldProperty('fitOption', e.target.value);
    });
    document.getElementById('vdp-prop-barcode-format').addEventListener('change', (e) => {
      updateActiveFieldProperty('barcodeFormat', e.target.value);
    });
    document.getElementById('vdp-delete-field-btn').addEventListener('click', deleteSelectedField);

    // ربط أزرار زوم محرر التصميم
    document.getElementById('vdp-editor-zoom-in-btn').addEventListener('click', () => {
      state.editorZoom = Math.min(3.0, state.editorZoom + 0.1);
      applyEditorZoom();
    });
    document.getElementById('vdp-editor-zoom-out-btn').addEventListener('click', () => {
      state.editorZoom = Math.max(0.3, state.editorZoom - 0.1);
      applyEditorZoom();
    });
    document.getElementById('vdp-editor-zoom-reset-btn').addEventListener('click', () => {
      state.editorZoom = 1.0;
      applyEditorZoom();
    });

    // ربط سكرول الماوس لزوم محرر التصميم
    const editorContainer = document.getElementById('vdp-canvas-container');
    if (editorContainer) {
      editorContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomStep = 0.05;
        if (e.deltaY < 0) {
          state.editorZoom = Math.min(3.0, state.editorZoom + zoomStep);
        } else {
          state.editorZoom = Math.max(0.3, state.editorZoom - zoomStep);
        }
        applyEditorZoom();
      }, { passive: false });
    }

    // ربط أحداث الماوس على الكانفاس
    canvas.addEventListener('mousedown', handleCanvasMouseDown);
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    window.addEventListener('mouseup', handleCanvasMouseUp);
  }

  function resizeEditorCanvas() {
    if (!state.templateImage) return;

    const canvas = document.getElementById('vdp-editor-canvas');
    const container = document.getElementById('vdp-canvas-container');
    
    // احتواء الكانفاس في الشاشة بأقصى عرض 800px وأقصى ارتفاع 500px
    const maxW = Math.min(800, container.clientWidth - 40 || 800);
    const maxH = 500;

    const imgW = state.templateNaturalW;
    const imgH = state.templateNaturalH;

    const scaleW = maxW / imgW;
    const scaleH = maxH / imgH;
    state.editorScale = Math.min(scaleW, scaleH, 1.0); // لا نكبر القالب الأصغر

    canvas.width = imgW * state.editorScale;
    canvas.height = imgH * state.editorScale;

    drawEditorCanvas();
    applyEditorZoom();
  }

  function applyEditorZoom() {
    const canvas = document.getElementById('vdp-editor-canvas');
    if (!canvas || !state.templateImage) return;

    const imgW = state.templateNaturalW;
    const imgH = state.templateNaturalH;

    const baseW = imgW * state.editorScale;
    const baseH = imgH * state.editorScale;

    canvas.style.width = (baseW * state.editorZoom) + 'px';
    canvas.style.height = (baseH * state.editorZoom) + 'px';

    const label = document.getElementById('vdp-editor-zoom-label');
    if (label) {
      label.textContent = Math.round(state.editorZoom * 100) + '%';
    }
  }

  function drawEditorCanvas() {
    const canvas = document.getElementById('vdp-editor-canvas');
    if (!canvas || !state.templateImage) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. رسم القالب الخلفية
    ctx.drawImage(state.templateImage, 0, 0, canvas.width, canvas.height);

    // 2. رسم الحقول المتغيرة المعرفة
    state.fields.forEach(field => {
      const isSelected = field.id === state.selectedFieldId;
      const x = field.x * canvas.width;
      const y = field.y * canvas.height;
      const w = field.w * canvas.width;
      const h = field.h * canvas.height;

      // رسم الصندوق الخارجي
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.strokeStyle = isSelected ? '#1565C0' : '#475569';
      ctx.strokeRect(x, y, w, h);

      // تعبئة شفافة للصندوق
      ctx.fillStyle = isSelected ? 'rgba(21, 101, 192, 0.15)' : 'rgba(71, 85, 105, 0.08)';
      ctx.fillRect(x, y, w, h);

      // كتابة اسم الحقل مع محاكاة حية للتنسيقات
      if (field.type === 'text') {
        ctx.fillStyle = field.color || '#000000';
        
        // تحجيم الحجم بناءً على مقياس المحرر الحالي
        const scaledFontSize = Math.round(field.fontSize * state.editorScale);
        const fontFamily = field.fontFamily || 'Cairo';
        
        ctx.font = `${field.fontWeight === 'bold' ? 'bold' : ''} ${scaledFontSize}px '${fontFamily}', sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = field.align || 'center';
        
        let textX = x + w / 2;
        if (field.align === 'left') textX = x;
        else if (field.align === 'right') textX = x + w;

        // قص النص داخل حدود الصندوق لمنع تشوه التخطيط بالمحرر
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.fillText(field.name, textX, y + h / 2);
        ctx.restore();
      } else {
        ctx.fillStyle = isSelected ? '#0d47a1' : '#1e293b';
        ctx.font = 'bold 11px sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'right'; // RTL alignment
        
        const typeIcons = { text: '🔤', image: '🖼️', qr: '🏁', barcode: '📊' };
        const fieldText = `${typeIcons[field.type] || ''} ${field.name}`;
        ctx.fillText(fieldText, x + w - 6, y + 6);
      }

      // رسم مقابض التحكم في الزوايا فقط عند التحديد
      if (isSelected) {
        ctx.fillStyle = '#1565C0';
        const hs = 7; // حجم مقبض التحجيم
        ctx.fillRect(x - hs/2, y - hs/2, hs, hs); // tl
        ctx.fillRect(x + w - hs/2, y - hs/2, hs, hs); // tr
        ctx.fillRect(x - hs/2, y + h - hs/2, hs, hs); // bl
        ctx.fillRect(x + w - hs/2, y + h - hs/2, hs, hs); // br
      }
    });
  }

  function addField(type) {
    const id = 'field_' + Math.random().toString(36).substring(2, 9);
    
    // توليد اسم بدئي بناء على الحقول المطلوبة
    const typeCounts = state.fields.filter(f => f.type === type).length + 1;
    const defaultNames = {
      text: `{{Name}}`,
      image: `{{Photo}}`,
      qr: `{{QRData}}`,
      barcode: `{{Code}}`
    };
    
    const newField = {
      id,
      name: defaultNames[type] || `{{Field_${typeCounts}}}`,
      type,
      x: 0.15,
      y: 0.15,
      w: type === 'text' ? 0.35 : (type === 'image' ? 0.25 : 0.2),
      h: type === 'text' ? 0.08 : (type === 'image' ? 0.35 : 0.2),
      fontSize: 22,
      color: '#000000',
      align: 'center',
      fontWeight: 'bold',
      fontFamily: 'Cairo',
      fitOption: 'contain',
      barcodeFormat: 'CODE128'
    };

    state.fields.push(newField);
    state.selectedFieldId = id;
    
    drawEditorCanvas();
    updatePropertiesPanel();
  }

  function deleteSelectedField() {
    if (!state.selectedFieldId) return;
    state.fields = state.fields.filter(f => f.id !== state.selectedFieldId);
    state.selectedFieldId = null;
    drawEditorCanvas();
    updatePropertiesPanel();
    showToast('تم حذف الحقل المحدد', 'info');
  }

  function updatePropertiesPanel() {
    const section = document.getElementById('vdp-properties-section');
    if (!state.selectedFieldId) {
      section.style.display = 'none';
      return;
    }

    const field = state.fields.find(f => f.id === state.selectedFieldId);
    if (!field) return;

    section.style.display = 'block';
    
    document.getElementById('vdp-prop-name').value = field.name;
    
    // إخفاء كافة الحقول الإضافية أولاً
    document.getElementById('vdp-text-properties').style.display = 'none';
    document.getElementById('vdp-image-properties').style.display = 'none';
    document.getElementById('vdp-barcode-properties').style.display = 'none';

    if (field.type === 'text') {
      document.getElementById('vdp-text-properties').style.display = 'block';
      document.getElementById('vdp-prop-font-size').value = field.fontSize;
      document.getElementById('vdp-prop-color').value = field.color;
      document.getElementById('vdp-prop-align').value = field.align;
      document.getElementById('vdp-prop-font-weight').value = field.fontWeight;
      document.getElementById('vdp-prop-font-family').value = field.fontFamily || 'Cairo';
    } else if (field.type === 'image') {
      document.getElementById('vdp-image-properties').style.display = 'block';
      document.getElementById('vdp-prop-fit').value = field.fitOption;
    } else if (field.type === 'barcode') {
      document.getElementById('vdp-barcode-properties').style.display = 'block';
      document.getElementById('vdp-prop-barcode-format').value = field.barcodeFormat;
    }
  }

  function updateActiveFieldProperty(prop, value) {
    if (!state.selectedFieldId) return;
    const field = state.fields.find(f => f.id === state.selectedFieldId);
    if (field) {
      field[prop] = value;
      drawEditorCanvas();
    }
  }

  // التفاعل مع الفأرة للسحب والتحجيم
  function handleCanvasMouseDown(e) {
    const canvas = document.getElementById('vdp-editor-canvas');
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);

    // 1. التحقق أولاً من النقر على مقبض التحجيم للحقل النشط
    if (state.selectedFieldId) {
      const field = state.fields.find(f => f.id === state.selectedFieldId);
      if (field) {
        const x = field.x * canvas.width;
        const y = field.y * canvas.height;
        const w = field.w * canvas.width;
        const h = field.h * canvas.height;
        const hs = 10; // نطاق التقاط مقبض التحجيم

        // tl
        if (Math.abs(mx - x) < hs && Math.abs(my - y) < hs) {
          state.canvasAction = 'resize';
          state.activeHandle = 'tl';
          state.resizeStartRect = { ...field };
          state.dragOffset = { x: mx, y: my };
          return;
        }
        // tr
        if (Math.abs(mx - (x + w)) < hs && Math.abs(my - y) < hs) {
          state.canvasAction = 'resize';
          state.activeHandle = 'tr';
          state.resizeStartRect = { ...field };
          state.dragOffset = { x: mx, y: my };
          return;
        }
        // bl
        if (Math.abs(mx - x) < hs && Math.abs(my - (y + h)) < hs) {
          state.canvasAction = 'resize';
          state.activeHandle = 'bl';
          state.resizeStartRect = { ...field };
          state.dragOffset = { x: mx, y: my };
          return;
        }
        // br
        if (Math.abs(mx - (x + w)) < hs && Math.abs(my - (y + h)) < hs) {
          state.canvasAction = 'resize';
          state.activeHandle = 'br';
          state.resizeStartRect = { ...field };
          state.dragOffset = { x: mx, y: my };
          return;
        }
      }
    }

    // 2. التحقق من النقر على جسم أي حقل متغير لتحديده وسحبه
    for (let i = state.fields.length - 1; i >= 0; i--) {
      const field = state.fields[i];
      const x = field.x * canvas.width;
      const y = field.y * canvas.height;
      const w = field.w * canvas.width;
      const h = field.h * canvas.height;

      if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
        state.selectedFieldId = field.id;
        state.canvasAction = 'drag';
        state.dragOffset = { x: mx - x, y: my - y };
        
        drawEditorCanvas();
        updatePropertiesPanel();
        return;
      }
    }

    // النقر على مساحة فارغة
    state.selectedFieldId = null;
    drawEditorCanvas();
    updatePropertiesPanel();
  }

  function handleCanvasMouseMove(e) {
    if (!state.canvasAction || !state.selectedFieldId) return;

    const canvas = document.getElementById('vdp-editor-canvas');
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);

    const field = state.fields.find(f => f.id === state.selectedFieldId);
    if (!field) return;

    if (state.canvasAction === 'drag') {
      const displayX = mx - state.dragOffset.x;
      const displayY = my - state.dragOffset.y;
      const displayW = field.w * canvas.width;
      const displayH = field.h * canvas.height;

      // القفل بحدود الكانفاس
      const clampedX = Math.max(0, Math.min(canvas.width - displayW, displayX));
      const clampedY = Math.max(0, Math.min(canvas.height - displayH, displayY));

      field.x = clampedX / canvas.width;
      field.y = clampedY / canvas.height;
    } 
    else if (state.canvasAction === 'resize') {
      const start = state.resizeStartRect;
      const dx = (mx - state.dragOffset.x) / canvas.width;
      const dy = (my - state.dragOffset.y) / canvas.height;

      if (state.activeHandle === 'br') {
        field.w = Math.max(0.02, start.w + dx);
        field.h = Math.max(0.02, start.h + dy);
      } else if (state.activeHandle === 'bl') {
        const newX = Math.min(start.x + start.w - 0.02, start.x + dx);
        field.w = (start.x + start.w) - newX;
        field.x = newX;
        field.h = Math.max(0.02, start.h + dy);
      } else if (state.activeHandle === 'tr') {
        field.w = Math.max(0.02, start.w + dx);
        const newY = Math.min(start.y + start.h - 0.02, start.y + dy);
        field.h = (start.y + start.h) - newY;
        field.y = newY;
      } else if (state.activeHandle === 'tl') {
        const newX = Math.min(start.x + start.w - 0.02, start.x + dx);
        field.w = (start.x + start.w) - newX;
        field.x = newX;

        const newY = Math.min(start.y + start.h - 0.02, start.y + dy);
        field.h = (start.y + start.h) - newY;
        field.y = newY;
      }
    }

    drawEditorCanvas();
  }

  function handleCanvasMouseUp() {
    state.canvasAction = null;
    state.activeHandle = null;
  }

  // ========================
  // 4. استيراد جدول البيانات (Step 3)
  // ========================
  function setupDataImport() {
    // التبديل بين تابات الاستيراد
    const xlsTabBtn = document.getElementById('vdp-tab-excel-btn');
    const manTabBtn = document.getElementById('vdp-tab-manual-btn');
    const xlsContent = document.getElementById('vdp-tab-excel-content');
    const manContent = document.getElementById('vdp-tab-manual-content');

    xlsTabBtn.addEventListener('click', () => {
      xlsTabBtn.classList.add('active');
      manTabBtn.classList.remove('active');
      xlsContent.classList.add('active');
      manContent.classList.remove('active');
    });

    manTabBtn.addEventListener('click', () => {
      manTabBtn.classList.add('active');
      xlsTabBtn.classList.remove('active');
      manContent.classList.add('active');
      xlsContent.classList.remove('active');
    });

    // سحب وإفلات ملف الـ Excel
    const zone = document.getElementById('vdp-excel-upload-zone');
    const fileInput = document.getElementById('vdp-excel-file');

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleExcelFile(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleExcelFile(e.target.files[0]);
    });

    // معالجة المدخلات يدوياً
    document.getElementById('vdp-process-manual-btn').addEventListener('click', processManualData);
  }

  function handleExcelFile(file) {
    if (!file) return;

    showToast('جاري قراءة ملف الجداول...', 'info');

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = e.target.result;
        let workbook;
        
        // التحقق من توافر مكتبة SheetJS
        if (typeof XLSX === 'undefined') {
          showToast('مكتبة SheetJS غير متوفرة بعد للتوليد', 'error');
          return;
        }

        const binary = new Uint8Array(data);
        workbook = XLSX.read(binary, { type: 'array' });
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // تحويل الجدول إلى كائن JSON
        const rawJson = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (rawJson.length === 0) {
          showToast('الملف المرفوع فارغ تماماً', 'warning');
          return;
        }

        // استخراج العناوين
        state.columnHeaders = rawJson[0].map(h => (h || '').toString().trim());
        
        // استخراج السجلات
        state.dataRows = [];
        for (let i = 1; i < rawJson.length; i++) {
          const rowData = rawJson[i];
          if (rowData.length === 0 || rowData.every(cell => cell == null || cell === '')) continue;
          
          const record = {};
          state.columnHeaders.forEach((header, index) => {
            record[header] = rowData[index] !== undefined ? rowData[index].toString().trim() : '';
          });
          state.dataRows.push(record);
        }

        showToast(`✅ تم بنجاح استيراد ${state.dataRows.length} سجل من ملف الـ Excel.`, 'success');
        
        // تحديث تطابق الأعمدة البدئي
        autoMapColumns();
        renderColumnMapping();
        updateRecordsSummary();

      } catch (err) {
        console.error(err);
        showToast('حدث خطأ أثناء قراءة ملف الجداول: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function autoMapColumns() {
    state.columnMapping = {};
    state.fields.forEach(field => {
      // تنظيف اسم المتغير من الأقواس
      const cleanName = field.name.replace(/[{}]/g, '').trim().toLowerCase();
      
      // البحث عن رأس عمود مشابه
      const match = state.columnHeaders.find(header => {
        const h = header.toLowerCase().trim();
        return h === cleanName || h.includes(cleanName) || cleanName.includes(h);
      });

      if (match) {
        state.columnMapping[field.id] = match;
      } else if (state.columnHeaders.length > 0) {
        // إذا لم يجد تطابق، نسند أول عمود كشكل بدئي
        state.columnMapping[field.id] = state.columnHeaders[0];
      }
    });
  }

  function renderColumnMapping() {
    const list = document.getElementById('vdp-mapping-list');
    const container = document.getElementById('vdp-mapping-section');
    if (state.fields.length === 0 || state.columnHeaders.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    list.innerHTML = '';

    state.fields.forEach(field => {
      const card = document.createElement('div');
      card.className = 'vdp-mapping-card';

      const label = document.createElement('label');
      label.textContent = `المتغير ${field.name}:`;

      const select = document.createElement('select');
      select.className = 'form-select';
      select.style.padding = '6px';
      
      state.columnHeaders.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col;
        if (state.columnMapping[field.id] === col) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });

      select.addEventListener('change', (e) => {
        state.columnMapping[field.id] = e.target.value;
      });

      card.appendChild(label);
      card.appendChild(select);
      list.appendChild(card);
    });
  }

  function processManualData() {
    const text = document.getElementById('vdp-manual-textarea').value.trim();
    if (!text) {
      showToast('يرجى تعبئة مربع البيانات أولاً', 'warning');
      return;
    }

    try {
      const recordsRaw = text.split(/\n\s*\n/); // فصل السجلات بواسطة سطر فارغ
      state.dataRows = [];
      const headersSet = new Set();

      recordsRaw.forEach(recordStr => {
        const lines = recordStr.split('\n');
        const record = {};
        
        lines.forEach(line => {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const key = line.substring(0, colonIdx).replace(/[{}]/g, '').trim();
            const val = line.substring(colonIdx + 1).trim();
            if (key) {
              record[key] = val;
              headersSet.add(key);
            }
          }
        });

        if (Object.keys(record).length > 0) {
          state.dataRows.push(record);
        }
      });

      state.columnHeaders = Array.from(headersSet);
      autoMapColumns();
      renderColumnMapping();
      updateRecordsSummary();
      showToast(`✅ تم بنجاح تهيئة ${state.dataRows.length} سجل من الإدخال اليدوي.`, 'success');
    } catch (e) {
      showToast('خطأ في معالجة المدخل اليدوي: ' + e.message, 'error');
    }
  }

  function updateRecordsSummary() {
    const summary = document.getElementById('vdp-data-summary');
    const countLabel = document.getElementById('vdp-total-records-count');
    if (state.dataRows.length > 0) {
      summary.style.display = 'block';
      countLabel.textContent = state.dataRows.length;
    } else {
      summary.style.display = 'none';
    }
  }

  // ========================
  // 5. رفع الصور المتغيرة ومطابقتها (Step 4)
  // ========================
  function setupPhotoUpload() {
    const zone = document.getElementById('vdp-photos-upload-zone');
    const fileInput = document.getElementById('vdp-photos-files');

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handlePhotoFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) handlePhotoFiles(e.target.files);
    });
  }

  function handlePhotoFiles(files) {
    if (!files || files.length === 0) return;

    let loadedCount = 0;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const nameLower = file.name.toLowerCase().trim();
      
      // تخزين مسار محلي لكل صورة
      if (state.uploadedPhotos[nameLower]) {
        URL.revokeObjectURL(state.uploadedPhotos[nameLower]);
      }
      state.uploadedPhotos[nameLower] = URL.createObjectURL(file);
      loadedCount++;
    }

    showToast(`📸 تم إرفاق ${loadedCount} صورة وتجهيزها للمطابقة.`, 'success');
    renderUploadedPhotosList();
  }

  function renderUploadedPhotosList() {
    const container = document.getElementById('vdp-photos-status');
    const grid = document.getElementById('vdp-uploaded-photos-list');
    const keys = Object.keys(state.uploadedPhotos);

    if (keys.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    grid.innerHTML = '';

    keys.forEach(key => {
      const item = document.createElement('div');
      item.className = 'vdp-photo-item';

      const img = document.createElement('img');
      img.src = state.uploadedPhotos[key];
      
      const span = document.createElement('span');
      span.textContent = key;

      item.appendChild(img);
      item.appendChild(span);
      grid.appendChild(item);
    });
  }

  // ========================
  // 6. المعاينة والتصدير (Step 5)
  // ========================
  function setupPreviewAndExport() {
    // أزرار التنقل بالمعاينة
    document.getElementById('vdp-prev-btn').addEventListener('click', () => {
      if (state.currentRecordIndex > 0) {
        state.currentRecordIndex--;
        renderRecordPreview();
      }
    });

    document.getElementById('vdp-next-btn').addEventListener('click', () => {
      if (state.currentRecordIndex < state.dataRows.length - 1) {
        state.currentRecordIndex++;
        renderRecordPreview();
      }
    });

    // أزرار التحكم بالزوم للمعاينة الفردية
    document.getElementById('vdp-zoom-in-btn').addEventListener('click', () => {
      state.previewZoom = Math.min(3.0, state.previewZoom + 0.1);
      applyPreviewZoom();
    });

    document.getElementById('vdp-zoom-out-btn').addEventListener('click', () => {
      state.previewZoom = Math.max(0.3, state.previewZoom - 0.1);
      applyPreviewZoom();
    });

    document.getElementById('vdp-zoom-reset-btn').addEventListener('click', () => {
      state.previewZoom = 1.0;
      applyPreviewZoom();
    });

    // التحكم بالزوم عبر سكرول الماوس على حاوية المعاينة
    const previewContainer = document.querySelector('.vdp-preview-canvas-container');
    if (previewContainer) {
      previewContainer.addEventListener('wheel', (e) => {
        e.preventDefault(); // منع التمرير الافتراضي للصفحة أثناء الزوم
        const zoomStep = 0.05;
        if (e.deltaY < 0) {
          state.previewZoom = Math.min(3.0, state.previewZoom + zoomStep);
        } else {
          state.previewZoom = Math.max(0.3, state.previewZoom - zoomStep);
        }
        applyPreviewZoom();
      }, { passive: false });
    }

    // التصدير كـ ZIP يحتوي على كروت
    document.getElementById('vdp-export-zip-btn').addEventListener('click', exportIndividualImagesZip);
    
    // التصدير كـ PDF متسلسل
    document.getElementById('vdp-export-pdf-seq-btn').addEventListener('click', exportSequentialPDF);

    // الفرض الرص على أفرخ الطباعة وتصدير PDF
    document.getElementById('vdp-impose-btn').addEventListener('click', imposeAndExportPDF);
    
    // حفظ المشروع
    document.getElementById('vdp-save-db-btn').addEventListener('click', saveVDPProject);
  }

  /**
   * دلالة توليد ورسم السجل الفردي على كانفاس خارجي
   * @param {number} rowIndex الفهرس للسجل المطلوب توليده
   * @param {number} dpi دقة التصدير (مثال: 300 للطباعة أو 96 للمعاينة الشاشية)
   * @returns {Promise<HTMLCanvasElement>} الكانفاس الحاوي على الكارت المولد بالكامل
   */
  async function generateRecordCanvas(rowIndex, dpi = 300) {
    return new Promise(async (resolve, reject) => {
      try {
        const row = state.dataRows[rowIndex];
        if (!row || !state.templateImage) {
          reject(new Error('البيانات أو قالب التصميم غير جاهز'));
          return;
        }

        // حساب الأبعاد بالبكسل بناء على DPI المطلوب وحجم الكارت بالسم
        // 1 inch = 2.54 cm
        const outputW = Math.round((state.cardWidthCm / 2.54) * dpi);
        const outputH = Math.round((state.cardHeightCm / 2.54) * dpi);

        const canvas = document.createElement('canvas');
        canvas.width = outputW;
        canvas.height = outputH;
        const ctx = canvas.getContext('2d');

        // 1. رسم خلفية قالب التصميم
        ctx.drawImage(state.templateImage, 0, 0, outputW, outputH);

        // 2. معالجة ورسم الحقول المتغيرة بالتتابع
        for (const field of state.fields) {
          const x = field.x * outputW;
          const y = field.y * outputH;
          const w = field.w * outputW;
          const h = field.h * outputH;

          // سحب قيمة العمود المقابل للحقل
          const columnName = state.columnMapping[field.id];
          const rawValue = columnName ? (row[columnName] || '') : '';

          if (field.type === 'text') {
            // رسم النص
            ctx.fillStyle = field.color || '#000000';
            
            // تحجيم ذكي للخط ليتوافق مع DPI التصدير
            const scaledFontSize = Math.round(field.fontSize * (outputW / state.templateNaturalW));
            const fontFamily = field.fontFamily || 'Cairo';
            ctx.font = `${field.fontWeight === 'bold' ? 'bold' : ''} ${scaledFontSize}px '${fontFamily}', sans-serif`;
            ctx.textBaseline = 'middle';
            
            // محاذاة النص
            ctx.textAlign = field.align || 'center';
            let textX = x + w / 2;
            if (field.align === 'left') textX = x;
            else if (field.align === 'right') textX = x + w;

            ctx.fillText(rawValue, textX, y + h / 2);
          } 
          else if (field.type === 'image') {
            // رسم الصورة الشخصية
            const val = rawValue.trim();
            let photoSrc = null;

            if (val) {
              // 1. تحقق مما إذا كانت رابط مباشر أو Data URI
              if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('data:')) {
                photoSrc = val;
              } else {
                // 2. استخراج اسم الملف للبحث في الصور المرفوعة محلياً
                // يدعم المسارات بنظام ويندوز أو لينكس (سواء سلاش أو باك سلاش)
                const filename = val.split(/[/\\]/).pop().toLowerCase().trim();
                if (state.uploadedPhotos[filename]) {
                  photoSrc = state.uploadedPhotos[filename];
                } else {
                  // 3. إذا لم يجدها في الصور المرفوعة ولم يكن مسار محلي لنظام تشغيل (مثل C:\...)
                  // نحاول استخدامه كرابط نسبي للموقع
                  const isWindowsPath = /^[a-zA-Z]:\\/.test(val) || val.includes('\\');
                  if (!isWindowsPath) {
                    photoSrc = val;
                  }
                }
              }
            }

            let img = null;
            if (photoSrc) {
              try {
                img = await loadLocalImageAsync(photoSrc);
              } catch (err) {
                console.warn('Failed to load image:', photoSrc, err);
              }
            }
            
            if (img) {
              // حساب الموضع والتحجيم بناء على خيار الاحتواء
              const fit = field.fitOption || 'contain';
              
              let drawX = x, drawY = y, drawW = w, drawH = h;
              
              if (fit === 'contain' || fit === 'cover') {
                const imgRatio = img.naturalWidth / img.naturalHeight;
                const boxRatio = w / h;
                
                if (fit === 'contain') {
                  if (imgRatio > boxRatio) {
                    drawH = w / imgRatio;
                    drawY = y + (h - drawH) / 2;
                  } else {
                    drawW = h * imgRatio;
                    drawX = x + (w - drawW) / 2;
                  }
                } else { // cover (تعبئة)
                  ctx.save();
                  // قص حواف الصندوق لعدم الخروج عنه
                  ctx.beginPath();
                  ctx.rect(x, y, w, h);
                  ctx.clip();
                  
                  if (imgRatio > boxRatio) {
                    drawW = h * imgRatio;
                    drawX = x + (w - drawW) / 2;
                  } else {
                    drawH = w / imgRatio;
                    drawY = y + (h - drawH) / 2;
                  }
                }
              }

              ctx.drawImage(img, drawX, drawY, drawW, drawH);
              if (field.fitOption === 'cover') {
                ctx.restore();
              }
            } else {
              // رسم بديل عند عدم وجود صورة أو فشل تحميلها
              ctx.strokeStyle = '#cbd5e1';
              ctx.strokeRect(x, y, w, h);
              ctx.fillStyle = '#f8fafc';
              ctx.fillRect(x, y, w, h);
              ctx.fillStyle = '#94a3b8';
              ctx.font = `10px '${field.fontFamily || 'Cairo'}', sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('لا توجد صورة', x + w / 2, y + h / 2);
            }
          } 
          else if (field.type === 'qr') {
            // رسم رمز QR Code
            if (rawValue) {
              if (typeof QRious === 'undefined') {
                reject(new Error('مكتبة QRIous لتوليد QR غير متوفرة'));
                return;
              }
              const qrSize = Math.max(120, Math.round(w));
              const qr = new QRious({
                value: rawValue,
                size: qrSize,
                level: 'H'
              });
              ctx.drawImage(qr.canvas, x, y, w, h);
            }
          } 
          else if (field.type === 'barcode') {
            // رسم الباركود
            if (rawValue) {
              if (typeof JsBarcode === 'undefined') {
                reject(new Error('مكتبة JsBarcode لتوليد الباركود غير متوفرة'));
                return;
              }
              const barcodeCanvas = document.createElement('canvas');
              try {
                JsBarcode(barcodeCanvas, rawValue, {
                  format: field.barcodeFormat || 'CODE128',
                  width: 2,
                  height: 80,
                  displayValue: true,
                  fontSize: 14,
                  margin: 2
                });
                ctx.drawImage(barcodeCanvas, x, y, w, h);
              } catch (barcodeErr) {
                console.warn('Barcode generation failed for:', rawValue, barcodeErr);
                // رسم بديل عند الفشل (مثلا مدخل ean13 ليس 13 رقم)
                ctx.strokeStyle = '#ef4444';
                ctx.strokeRect(x, y, w, h);
                ctx.fillStyle = '#fef2f2';
                ctx.fillRect(x, y, w, h);
                ctx.fillStyle = '#ef4444';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('خطأ باركود', x + w / 2, y + h / 2);
              }
            }
          }
        }

        resolve(canvas);
      } catch (err) {
        reject(err);
      }
    });
  }

  function loadLocalImageAsync(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (src.startsWith('http://') || src.startsWith('https://')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    });
  }

  async function renderRecordPreview() {
    if (state.dataRows.length === 0) return;

    const canvas = document.getElementById('vdp-preview-canvas');
    const indicator = document.getElementById('vdp-current-record-indicator');
    
    indicator.textContent = `السجل ${state.currentRecordIndex + 1} من ${state.dataRows.length}`;

    try {
      // توليد الكانفاس بدقة معاينة شاشية خفيفة (120 DPI) للتسريع
      const previewCanvas = await generateRecordCanvas(state.currentRecordIndex, 120);
      
      canvas.width = previewCanvas.width;
      canvas.height = previewCanvas.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(previewCanvas, 0, 0);
      
      applyPreviewZoom();
    } catch (e) {
      console.error(e);
      showToast('خطأ أثناء توليد المعاينة: ' + e.message, 'error');
    }
  }

  function applyPreviewZoom() {
    const canvas = document.getElementById('vdp-preview-canvas');
    if (!canvas) return;
    
    const baseW = canvas.width;
    const baseH = canvas.height;
    
    canvas.style.width = (baseW * state.previewZoom) + 'px';
    canvas.style.height = (baseH * state.previewZoom) + 'px';
    
    const label = document.getElementById('vdp-preview-zoom-label');
    if (label) {
      label.textContent = Math.round(state.previewZoom * 100) + '%';
    }
  }

  // تصدير كملف مضغوط ZIP يحتوي على الكروت كصور
  async function exportIndividualImagesZip() {
    if (state.dataRows.length === 0) return;
    
    // التحقق من توافر مكتبة JSZip
    if (typeof JSZip === 'undefined') {
      showToast('مكتبة JSZip غير متوفرة حالياً للتوليد', 'error');
      return;
    }

    showToast('جاري توليد كافة البطاقات، يرجى الانتظار...', 'info');
    const zip = new JSZip();

    try {
      for (let i = 0; i < state.dataRows.length; i++) {
        const cardCanvas = await generateRecordCanvas(i, 300); // 300 DPI للطباعة
        
        // تحويل الكانفاس إلى DataURL ثنائي
        const dataUrl = cardCanvas.toDataURL('image/png');
        const base64Data = dataUrl.replace(/^data:image\/(png|jpg|jpeg);base64,/, "");
        
        const filename = `card_${i + 1}.png`;
        zip.file(filename, base64Data, { base64: true });
      }

      showToast('جاري ضغط الملفات وتحميل الـ ZIP...', 'info');
      const content = await zip.generateAsync({ type: 'blob' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `vdp_generated_cards.zip`;
      link.click();
      
      showToast('🎉 تم تصدير وتحميل كافة الملفات بنجاح!', 'success');
    } catch (err) {
      console.error(err);
      showToast('حدث خطأ أثناء التصدير: ' + err.message, 'error');
    }
  }

  // تصدير كـ PDF متسلسل (صفحة لكل بطاقة)
  async function exportSequentialPDF() {
    if (state.dataRows.length === 0) return;

    if (typeof window.jspdf === 'undefined') {
      showToast('جاري تحميل مكتبة PDF...', 'info');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }

    const { jsPDF } = window.jspdf;
    
    showToast('جاري توليد كروت الـ PDF المتسلسلة...', 'info');

    try {
      const orientation = state.cardWidthCm > state.cardHeightCm ? 'landscape' : 'portrait';
      const doc = new jsPDF({
        orientation: orientation,
        unit: 'cm',
        format: [state.cardWidthCm, state.cardHeightCm]
      });

      for (let i = 0; i < state.dataRows.length; i++) {
        if (i > 0) {
          doc.addPage([state.cardWidthCm, state.cardHeightCm], orientation);
        }

        const cardCanvas = await generateRecordCanvas(i, 300); // 300 DPI
        const dataURL = cardCanvas.toDataURL('image/jpeg', 0.95);
        
        doc.addImage(dataURL, 'JPEG', 0, 0, state.cardWidthCm, state.cardHeightCm, undefined, 'FAST');
      }

      doc.save(`vdp_sequential_cards.pdf`);
      if (window.ProtectionSystem && window.ProtectionSystem.incrementLimit) {
        window.ProtectionSystem.incrementLimit('pdfExports');
      }
      showToast('✅ تم بنجاح تحميل الـ PDF المتسلسل للمطبعة!', 'success');

    } catch (e) {
      console.error(e);
      showToast('حدث خطأ أثناء تصدير PDF: ' + e.message, 'error');
    }
  }

  // رص وتوزيع تلقائي وتصدير PDF الطباعة (Nesting Engine)
  async function imposeAndExportPDF() {
    if (state.dataRows.length === 0) {
      showToast('لا توجد بيانات لرصها وتوزيعها', 'warning');
      return;
    }

    if (typeof window.jspdf === 'undefined') {
      showToast('جاري تحميل مكتبة PDF...', 'info');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }

    showToast('جاري بدء معالجة الرص والفرض التلقائي...', 'info');

    try {
      // 1. سحب الإعدادات الحالية لفرخ الورقة والـ Bleed من الواجهة الرئيسية للموقع
      const paperW = parseFloat(document.getElementById('paper-width').value) || 50.0;
      const paperH = parseFloat(document.getElementById('paper-height').value) || 35.0;
      const bleed = parseFloat(document.getElementById('bleed').value) || 0.0;
      const gutter = parseFloat(document.getElementById('gutter').value) || 0.0;
      const paperMargin = parseFloat(document.getElementById('paper-margin').value) || 0.0;
      const unit = document.getElementById('currency') ? 'سم' : 'cm'; // وحدة القياس سم

      // 2. تحضير قطع البطاقات لمديول الرص
      // كل بطاقة تمثل عنصراً فريداً ليكون لكل موضع سجل بيانات مختلف!
      const itemsToPack = [];
      for (let i = 0; i < state.dataRows.length; i++) {
        itemsToPack.push({
          id: `vdp_${i}`,
          w: state.cardWidthCm,
          h: state.cardHeightCm,
          qty: 1, // كل كارت مخصص يطبع مرة واحدة
          rowIndex: i, // مرجع السجل
          canRotate: true // تدوير تلقائي للحشو الأمثل
        });
      }

      // 3. تشغيل مديول الرص متعدد الأفرخ
      const config = {
        paperW,
        paperH,
        bleed,
        gutter,
        paperMargin,
        autoRepeat: false, // لا نريد تكرار الكروت عشوائياً، بل طباعة سجلاتها بالضبط
        algorithm: 'auto',
        iterations: 400,
        unit
      };

      const result = await PackingEngine.packQuantity(config, itemsToPack);

      if (result.error) {
        showToast('خطأ في الرص: ' + result.error, 'error');
        return;
      }

      const pages = result.pages || [result];
      showToast(`📏 تم التوزيع على ${pages.length} أفرخ طباعة. جاري رسم PDF بدقة 300 DPI...`, 'info');

      // 4. رسم صفحات الـ PDF المفروضة
      const { jsPDF } = window.jspdf;
      const orientation = paperW > paperH ? 'landscape' : 'portrait';
      const doc = new jsPDF({
        orientation,
        unit: 'cm',
        format: [paperW, paperH]
      });

      // تحضير وحساب بكسلات الفرخ بجودة 300 DPI للرسم
      const sheetPixelW = Math.round((paperW / 2.54) * 300);
      const sheetPixelH = Math.round((paperH / 2.54) * 300);

      // رسم كل فرخة طباعة وإضافتها لـ PDF
      for (let pIdx = 0; pIdx < pages.length; pIdx++) {
        if (pIdx > 0) {
          doc.addPage([paperW, paperH], orientation);
        }

        const pageResult = pages[pIdx];
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = sheetPixelW;
        pageCanvas.height = sheetPixelH;
        const pageCtx = pageCanvas.getContext('2d');

        // رسم خلفية بيضاء للورقة
        pageCtx.fillStyle = '#FFFFFF';
        pageCtx.fillRect(0, 0, sheetPixelW, sheetPixelH);

        // رسم كروت هذا الفرخ
        for (const packedItem of pageResult.packed) {
          const itemConfig = packedItem.item;
          const rIdx = itemConfig.rowIndex;

          // توليد الكانفاس عالي الدقة للكارت الفردي
          const cardCanvas = await generateRecordCanvas(rIdx, 300);

          // رسم الكارت في موقعه
          const x = (packedItem.x / paperW) * sheetPixelW;
          const y = (packedItem.y / paperH) * sheetPixelH;
          const w = (packedItem.w / paperW) * sheetPixelW;
          const h = (packedItem.h / paperH) * sheetPixelH;

          pageCtx.save();
          pageCtx.translate(x + w / 2, y + h / 2);
          
          if (packedItem.rotated) {
            pageCtx.rotate(Math.PI / 2);
            // رسم الكارت مع التدوير
            pageCtx.drawImage(cardCanvas, -h / 2, -w / 2, h, w);
          } else {
            pageCtx.drawImage(cardCanvas, -w / 2, -h / 2, w, h);
          }
          pageCtx.restore();
        }

        // رسم علامات القص للفرخ بالكامل إذا كانت مفعلة في الصفحة الرئيسية
        const isCropEnabled = document.getElementById('crop-marks')?.checked !== false;
        if (isCropEnabled) {
          drawSheetCropMarks(pageCtx, pageResult.packed, paperW, paperH, sheetPixelW, sheetPixelH, bleed);
        }

        // إضافة الفرخة المرسومة لملف PDF
        const sheetDataURL = pageCanvas.toDataURL('image/jpeg', 0.95);
        doc.addImage(sheetDataURL, 'JPEG', 0, 0, paperW, paperH, undefined, 'FAST');
      }

      doc.save(`vdp_imposed_sheets.pdf`);
      if (window.ProtectionSystem && window.ProtectionSystem.incrementLimit) {
        window.ProtectionSystem.incrementLimit('pdfExports');
        window.ProtectionSystem.incrementLimit('nestingOperations');
      }
      showToast(`🎉 تم توليد وتصدير ملف الـ PDF المفروض بنجاح! (${pages.length} أفرخ طباعة - 300 DPI)`, 'success');

    } catch (e) {
      console.error(e);
      showToast('خطأ أثناء الرص والفرض: ' + e.message, 'error');
    }
  }

  // رسم علامات القص للأفرخ المفروضة
  function drawSheetCropMarks(ctx, packedItems, paperW, paperH, pixelW, pixelH, bleedCm) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;

    packedItems.forEach(item => {
      // إحداثيات الكارت الفعلي بالبكسل (داخل الـ bleed)
      const bleedPixels = (bleedCm / paperW) * pixelW;
      
      const x1 = (item.x / paperW) * pixelW + bleedPixels;
      const y1 = (item.y / paperH) * pixelH + bleedPixels;
      const w = (item.w / paperW) * pixelW - 2 * bleedPixels;
      const h = (item.h / paperH) * pixelH - 2 * bleedPixels;
      const x2 = x1 + w;
      const y2 = y1 + h;

      const len = 20; // طول خط القص بالبكسل

      // رسم أربعة زوايا لكل كارت
      // top-left
      ctx.beginPath(); ctx.moveTo(x1 - len, y1); ctx.lineTo(x1 - 5, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y1 - len); ctx.lineTo(x1, y1 - 5); ctx.stroke();

      // top-right
      ctx.beginPath(); ctx.moveTo(x2 + len, y1); ctx.lineTo(x2 + 5, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2, y1 - len); ctx.lineTo(x2, y1 - 5); ctx.stroke();

      // bottom-left
      ctx.beginPath(); ctx.moveTo(x1 - len, y2); ctx.lineTo(x1 - 5, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y2 + len); ctx.lineTo(x1, y2 + 5); ctx.stroke();

      // bottom-right
      ctx.beginPath(); ctx.moveTo(x2 + len, y2); ctx.lineTo(x2 + 5, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2, y2 + len); ctx.lineTo(x2, y2 + 5); ctx.stroke();
    });
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

  // ========================
  // 7. حفظ المشروع في Firestore
  // ========================
  async function saveVDPProject() {
    // التحقق من حالة الدخول
    if (typeof firebase === 'undefined' || !firebase.apps.length) {
      showToast('الاتصال بقاعدة البيانات غير متاح', 'warning');
      return;
    }

    const auth = firebase.auth();
    if (!auth.currentUser) {
      showToast('يرجى تسجيل الدخول أولاً لتتمكن من حفظ مشاريع الـ VDP سحابياً', 'warning');
      return;
    }

    const name = prompt('يرجى كتابة اسم لمشروع البيانات المتغيرة (VDP):') || '';
    if (!name.trim()) return;

    showToast('جاري حفظ المشروع سحابياً...', 'info');

    try {
      const db = firebase.firestore();
      
      // تبسيط وتحويل كائنات الحقول ليتم حفظها بأمان
      const fieldsData = state.fields.map(f => ({ ...f }));
      
      const projectDoc = {
        name: name.trim(),
        userId: auth.currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        type: 'vdp',
        cardWidthCm: state.cardWidthCm,
        cardHeightCm: state.cardHeightCm,
        fields: fieldsData,
        columnMapping: state.columnMapping,
        // حفظ قالب التصميم كملف أو مسار (في وضع الإنتاج يتم رفعه لـ Storage، هنا نحتفظ بالاسم والخصائص الأساسية)
        templateFileName: state.templateFile ? state.templateFile.name : 'template.png',
        dataRows: state.dataRows.slice(0, 100) // حفظ أول 100 سطر للتبسيط
      };

      await db.collection('vdp_projects').add(projectDoc);
      showToast('🎉 تم حفظ مشروع البيانات المتغيرة (VDP) سحابياً بنجاح!', 'success');

    } catch (e) {
      console.error(e);
      showToast('حدث خطأ أثناء حفظ المشروع: ' + e.message, 'error');
    }
  }

  // ========================
  // واجهة التنقل بين الأقسام (Wizard UI Coordinator)
  // ========================
  function setupStepTriggers() {
    // ربط التنقل بالساحر
    document.querySelectorAll('.vdp-step').forEach(stepEl => {
      stepEl.addEventListener('click', () => {
        const stepNum = parseInt(stepEl.dataset.step);
        // نتحقق من الخطوات السابقة قبل الانتقال العشوائي
        let canGo = true;
        for (let s = 1; s < stepNum; s++) {
          if (!validateStep(s)) {
            canGo = false;
            break;
          }
        }
        if (canGo) {
          state.currentStep = stepNum;
          updateStepUI();
        }
      });
    });
  }

  // تهيئة مستمعات التحميل
  setTimeout(() => {
    setupStepTriggers();
  }, 100);

  // ========================
  // API العامة للمديول
  // ========================
  return {
    init,
    getState: () => ({ ...state }),
    addField,
    deleteSelectedField,
    handleTemplateFile,
    handleExcelFile,
    processManualData,
    generateRecordCanvas
  };

})();

// إلحاق المديول بالنافذة
window.VDPManager = VDPManager;
