/**
 * اوتو رص - مدير رص وجه وظهر
 * Auto Rass - Duplex Imposition Manager
 */

'use strict';

const DuplexManager = (() => {
  // ========================
  // حالة القسم
  // ========================
  let state = {
    frontFile: null,
    backFile: null,
    frontImage: null,
    backImage: null,
    
    // الأبعاد الفردية المستخرجة
    frontW: 9.0,
    frontH: 5.5,
    backW: 9.0,
    backH: 5.5,

    // نتيجة الرص الحالية
    result: null,
    currentSide: 'front', // 'front' or 'back'

    // حالة الكانفاس (زوم وبان)
    zoom: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    lastX: 0,
    lastY: 0,
    padding: 40,
    quality: 2
  };

  // عناصر واجهة المستخدم
  let canvas = null;
  let ctx = null;
  let wrapper = null;
  let tooltip = null;

  // ========================
  // تهيئة القسم
  // ========================
  function init() {
    canvas = document.getElementById('duplex-canvas');
    wrapper = document.getElementById('duplex-canvas-wrapper');
    tooltip = document.getElementById('duplex-canvas-tooltip');
    
    if (canvas) {
      ctx = canvas.getContext('2d', { alpha: true });
      setupCanvasEvents();
    }

    setupUploadZones();
    setupFormEvents();

    // التحديث عند تغيير تبويب أو وحدة القياس
    document.addEventListener('tabChanged', (e) => {
      if (e.detail.tab === 'duplex') {
        setTimeout(() => {
          resizeCanvas();
          if (state.result) {
            fitToScreen();
            render();
          }
        }, 100);
      }
    });

    window.addEventListener('resize', () => {
      if (document.querySelector('.nav-btn[data-tab="duplex"]').classList.contains('active')) {
        resizeCanvas();
        if (state.result) render();
      }
    });
  }

  // ========================
  // إعداد رفع الملفات
  // ========================
  function setupUploadZones() {
    const frontZone = document.getElementById('duplex-front-zone');
    const backZone = document.getElementById('duplex-back-zone');
    const frontInput = document.getElementById('duplex-front-input');
    const backInput = document.getElementById('duplex-back-input');

    // تفعيل الكليك للاختيار
    frontZone.addEventListener('click', () => frontInput.click());
    backZone.addEventListener('click', () => backInput.click());

    // السحب والإفلات للوجه
    setupDragDrop(frontZone, (file) => handleFileUpload(file, 'front'));
    frontInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFileUpload(e.target.files[0], 'front');
    });

    // السحب والإفلات للظهر
    setupDragDrop(backZone, (file) => handleFileUpload(file, 'back'));
    backInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFileUpload(e.target.files[0], 'back');
    });
  }

  function setupDragDrop(zone, callback) {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('dragover');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) {
        callback(e.dataTransfer.files[0]);
      }
    });
  }

  // معالجة الملفات المرفوعة
  async function handleFileUpload(file, side) {
    showToast(`جاري استخراج بيانات ملف ${side === 'front' ? 'الوجه' : 'الظهر'}...`, 'info');
    
    try {
      const result = await FileReaderHelper.processFile(file);
      if (result.error) {
        showToast(`خطأ في معالجة الملف: ${result.error}`, 'error');
        return;
      }

      const activeUnit = localStorage.getItem('unit') || 'cm';
      let w = result.w; // بـ مم
      let h = result.h;

      // تحويل للوحدة الحالية
      if (activeUnit === 'cm') {
        w /= 10;
        h /= 10;
      } else if (activeUnit === 'inch') {
        w /= 25.4;
        h /= 25.4;
      }

      // حفظ أبعاد الملف
      if (side === 'front') {
        state.frontFile = file;
        state.frontW = w;
        state.frontH = h;
        document.getElementById('duplex-card-width').value = w.toFixed(1);
        document.getElementById('duplex-card-height').value = h.toFixed(1);
      } else {
        state.backFile = file;
        state.backW = w;
        state.backH = h;
      }

      // تحميل الصورة للمعاينة والرسم
      if (result.imageSrc) {
        const img = new Image();
        img.onload = () => {
          if (side === 'front') {
            state.frontImage = img;
            showUploadPreview('duplex-front-preview', result.imageSrc, 'front');
          } else {
            state.backImage = img;
            showUploadPreview('duplex-back-preview', result.imageSrc, 'back');
          }
          if (state.result) render();
        };
        img.src = result.imageSrc;
      }

      showToast(`تم رفع ملف ${side === 'front' ? 'الوجه' : 'الظهر'} بنجاح! المقاس المستخرج: ${w.toFixed(1)} × ${h.toFixed(1)}`, 'success');

    } catch (err) {
      console.error(err);
      showToast('حدث خطأ أثناء قراءة الملف', 'error');
    }
  }

  function showUploadPreview(previewId, imageSrc, side) {
    const previewEl = document.getElementById(previewId);
    previewEl.innerHTML = `
      <div class="duplex-preview-container">
        <button class="duplex-remove-btn" onclick="event.stopPropagation(); DuplexManager.removeFile('${side}')">✕</button>
        <img src="${imageSrc}" class="duplex-image-preview" />
        <div style="font-size:0.75rem; margin-top:6px; color:var(--text-secondary)">
          ${side === 'front' ? 'الوجه (Front)' : 'الظهر (Back)'}
        </div>
      </div>
    `;
  }

  function removeFile(side) {
    if (side === 'front') {
      state.frontFile = null;
      state.frontImage = null;
      document.getElementById('duplex-front-preview').innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="upload-icon">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        <p class="upload-title">رفع ملف الوجه (Front)</p>
        <small class="upload-hint">اسحب وأفلت أو اضغط للاختيار</small>
      `;
    } else {
      state.backFile = null;
      state.backImage = null;
      document.getElementById('duplex-back-preview').innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="upload-icon">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        <p class="upload-title">رفع ملف الظهر (Back)</p>
        <small class="upload-hint">اسحب وأفلت أو اضغط للاختيار</small>
      `;
    }
    if (state.result) render();
  }

  // ========================
  // تفاعلات وحساب الرص
  // ========================
  function setupFormEvents() {
    document.getElementById('btn-duplex-calculate').addEventListener('click', calculate);
    
    // التبديل بين المعاينة وجه/ظهر
    document.getElementById('btn-show-front').addEventListener('click', () => switchSide('front'));
    document.getElementById('btn-show-back').addEventListener('click', () => switchSide('back'));

    // زووم الكانفاس
    document.getElementById('duplex-zoom-in').addEventListener('click', () => zoomAt(wrapper.clientWidth / 2, wrapper.clientHeight / 2, 1.3));
    document.getElementById('duplex-zoom-out').addEventListener('click', () => zoomAt(wrapper.clientWidth / 2, wrapper.clientHeight / 2, 0.77));
    document.getElementById('duplex-reset-view').addEventListener('click', () => { fitToScreen(); render(); });

    // التصدير
    document.getElementById('btn-duplex-export-pdf').addEventListener('click', exportPDF);
    document.getElementById('btn-duplex-export-jpg').addEventListener('click', exportJPG);
  }

  function switchSide(side) {
    state.currentSide = side;
    document.getElementById('btn-show-front').classList.toggle('active', side === 'front');
    document.getElementById('btn-show-back').classList.toggle('active', side === 'back');
    render();
  }

  async function calculate() {
    if (window.ProtectionSystem && !window.ProtectionSystem.verifyAccess()) return;

    if (!state.frontFile || !state.backFile) {
      showToast('يرجى رفع ملف الوجه وملف الظهر أولاً لبدء الرص', 'warning');
      return;
    }

    // استخراج أبعاد الكارت
    const cardW = parseFloat(document.getElementById('duplex-card-width').value);
    const cardH = parseFloat(document.getElementById('duplex-card-height').value);
    const bleed = parseFloat(document.getElementById('duplex-card-bleed').value) || 0;
    const allowRotate = document.getElementById('duplex-card-rotate').checked;

    if (isNaN(cardW) || isNaN(cardH) || cardW <= 0 || cardH <= 0) {
      showToast('يرجى إدخال مقاسات كارت صحيحة', 'warning');
      return;
    }

    // مقاس الورقة من الشريط الجانبي
    const paperW = parseFloat(document.getElementById('paper-width').value) || 50;
    const paperH = parseFloat(document.getElementById('paper-height').value) || 35;
    const gutter = parseFloat(document.getElementById('gutter').value) || 0;
    const safeMargin = parseFloat(document.getElementById('safe-margin').value) || 0;
    const paperMargin = parseFloat(document.getElementById('paper-margin').value) || 0;
    const guillotineMode = document.getElementById('guillotine-mode').checked;
    
    const activeUnit = localStorage.getItem('unit') || 'cm';
    const autoRepeat = document.getElementById('auto-repeat')?.checked !== false;

    const config = {
      paperW, paperH,
      bleed, gutter, safeMargin, paperMargin,
      guillotineMode,
      autoRepeat,
      algorithm: 'auto',
      iterations: 500,
      unit: activeUnit
    };

    // تجهيز العنصر
    const cardItem = {
      id: 9999,
      name: document.getElementById('duplex-card-name').value.trim() || 'كارت وجه وظهر',
      w: cardW,
      h: cardH,
      qty: 1, // سنعتمد على خيار التكرار لملء الورقة
      canRotate: allowRotate,
      bleedOverride: bleed
    };

    showLoading(true, 'جاري حساب الرص الأمثل للوجه والظهر...');

    try {
      await sleep(100);
      const result = await PackingEngine.packQuantity(config, [cardItem]);
      showLoading(false);

      if (result.error) {
        showToast('خطأ: ' + result.error, 'error');
        return;
      }

      state.result = result;

      // عرض النتائج والإحصائيات
      document.getElementById('duplex-results-section').style.display = 'block';
      animateCounter('duplex-stat-efficiency', result.efficiency, 1, '%');
      animateCounter('duplex-stat-waste', result.waste, 1, '%');
      document.getElementById('duplex-stat-pieces').textContent = result.itemCount + ' كارت وجه وظهر';

      // تلوين نسبة الكفاءة
      const effEl = document.getElementById('duplex-stat-efficiency');
      effEl.style.color = result.efficiency >= 70 ? '#4CAF50' : (result.efficiency >= 50 ? '#FF9800' : '#F44336');

      // تهيئة الكانفاس
      fitToScreen();
      render();

      showToast('تم حساب الرص بنجاح!', 'success');

      // تسجيل العملية في نظام التراخيص
      if (window.ProtectionSystem && window.ProtectionSystem.incrementLimit) {
        window.ProtectionSystem.incrementLimit('nestingOperations');
      }

    } catch (err) {
      console.error(err);
      showLoading(false);
      showToast('حدث خطأ أثناء الحساب: ' + err.message, 'error');
    }
  }

  // ========================
  // إعداد الكانفاس للرسم
  // ========================
  function resizeCanvas() {
    if (!canvas || !wrapper) return;
    const dpr = state.quality;
    const w = wrapper.clientWidth || 800;
    const h = wrapper.clientHeight || 500;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getScale() {
    if (!state.result) return 1;
    const { paperW, paperH } = state.result;
    const wrapW = wrapper.clientWidth || 800;
    const wrapH = wrapper.clientHeight || 500;
    const maxW = wrapW - 2 * state.padding;
    const maxH = wrapH - 2 * state.padding;
    return Math.min(maxW / paperW, maxH / paperH);
  }

  function fitToScreen() {
    if (!state.result) return;
    const scale = getScale();
    const { paperW, paperH } = state.result;
    const wrapW = wrapper.clientWidth || 800;
    const wrapH = wrapper.clientHeight || 500;
    state.panX = (wrapW - paperW * scale) / 2;
    state.panY = (wrapH - paperH * scale) / 2;
    state.zoom = 1;
    updateZoomLabel();
  }

  function updateZoomLabel() {
    const label = document.getElementById('duplex-zoom-label');
    if (label) label.textContent = Math.round(state.zoom * 100) + '%';
  }

  // ========================
  // الرسم التفاعلي
  // ========================
  function render() {
    if (!state.result || !canvas || !ctx) return;

    resizeCanvas();
    const w = wrapper.clientWidth || 800;
    const h = wrapper.clientHeight || 500;
    ctx.clearRect(0, 0, w, h);

    const scale = getScale();
    const { paperW, paperH, packed, bleed = 0 } = state.result;

    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.zoom, state.zoom);

    const pad = state.padding;

    // 1. رسم الورقة الأساسية
    drawPaper(pad, pad, paperW * scale, paperH * scale);

    // 2. رسم الكروت وجه أو ظهر
    if (packed) {
      packed.forEach((pi, idx) => {
        drawDuplexItem(pi, scale, pad, idx + 1, paperW, bleed);
      });
    }

    // 3. رسم علامات القص
    if (document.getElementById('crop-marks')?.checked !== false) {
      drawCropMarks(pad, scale, paperW, paperH);
    }

    // 4. رسم الأبعاد
    drawDimensions(pad, scale, paperW, paperH);

    ctx.restore();
  }

  function drawPaper(x, y, pw, ph) {
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, y, pw, ph);

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, pw, ph);

    // شبكة خفيفة
    ctx.strokeStyle = 'rgba(0,0,0,0.03)';
    ctx.lineWidth = 0.5;
    const gridStep = Math.max(pw / 20, 10);
    for (let gx = x; gx <= x + pw; gx += gridStep) {
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + ph); ctx.stroke();
    }
    for (let gy = y; gy <= y + ph; gy += gridStep) {
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + pw, gy); ctx.stroke();
    }
  }

  function drawDuplexItem(pi, scale, pad, num, paperW, bleed) {
    const isFront = state.currentSide === 'front';
    const cardImg = isFront ? state.frontImage : state.backImage;

    // عرض وارتفاع الكارت الفعلي (بدون تكرار أو bleed)
    const cardW = pi.rotated ? (pi.item.origH || pi.item.h) : (pi.item.origW || pi.item.w);
    const cardH = pi.rotated ? (pi.item.origW || pi.item.w) : (pi.item.origH || pi.item.h);

    // حساب موضع الـ trim الصافي
    const trimY = pad + (pi.y + bleed) * scale;
    const trimW = cardW * scale;
    const trimH = cardH * scale;

    let trimX = 0;
    if (isFront) {
      trimX = pad + (pi.x + bleed) * scale;
    } else {
      // الظهر: محاذاة أفقية معكوسة
      trimX = pad + (paperW - pi.x - bleed - cardW) * scale;
    }

    const slotX = isFront ? pad + pi.x * scale : pad + (paperW - pi.x - pi.w) * scale;
    const slotY = pad + pi.y * scale;
    const slotW = pi.w * scale;
    const slotH = pi.h * scale;

    ctx.save();
    
    // عمل clip لحدود الـ slot بالكامل (حتى لا تخرج الصورة)
    ctx.beginPath();
    ctx.rect(slotX, slotY, slotW, slotH);
    ctx.clip();

    if (cardImg && cardImg.complete && cardImg.naturalWidth > 0) {
      ctx.save();
      // تدوير حول مركز الـ trim
      ctx.translate(trimX + trimW / 2, trimY + trimH / 2);
      if (pi.rotated) {
        // الوجه: تدوير مع اتجاه عقارب الساعة
        // الظهر: تدوير عكس عقارب الساعة لكي تطابق المحاذاة بعد قلب الورق أفقياً
        ctx.rotate(isFront ? Math.PI / 2 : -Math.PI / 2);
        ctx.drawImage(cardImg, -trimH / 2, -trimW / 2, trimH, trimW);
      } else {
        ctx.drawImage(cardImg, -trimW / 2, -trimH / 2, trimW, trimH);
      }
      ctx.restore();

      // خط القص المتقطع للبليد
      if (bleed > 0) {
        ctx.strokeStyle = 'rgba(244,67,54,0.6)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(trimX, trimY, trimW, trimH);
        ctx.setLineDash([]);
      }
    } else {
      // رسم شكل كارت افتراضي جذاب
      const color = isFront ? '#1565C0' : '#4CAF50';
      
      // رسم البليد بلون خفيف
      if (bleed > 0) {
        ctx.fillStyle = hexToRgba(color, 0.1);
        ctx.fillRect(slotX, slotY, slotW, slotH);
      }

      // تدرج الخلفية للكارت
      const grad = ctx.createLinearGradient(trimX, trimY, trimX + trimW, trimY + trimH);
      grad.addColorStop(0, hexToRgba(color, 0.85));
      grad.addColorStop(1, hexToRgba(color, 0.6));
      ctx.fillStyle = grad;
      ctx.fillRect(trimX, trimY, trimW, trimH);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(trimX, trimY, trimW, trimH);

      if (bleed > 0) {
        ctx.strokeStyle = hexToRgba(color, 0.3);
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(slotX, slotY, slotW, slotH);
        ctx.setLineDash([]);
      }

      // كتابة اسم ورقم الكارت
      if (trimW > 30 && trimH > 25) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${Math.max(10, Math.min(15, trimW * 0.1))}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${num}`, trimX + trimW / 2, trimY + trimH / 2 - 6);

        ctx.font = `${Math.max(7, Math.min(10, trimW * 0.08))}px 'IBM Plex Sans Arabic'`;
        ctx.fillText(isFront ? 'الوجه (Front)' : 'الظهر (Back)', trimX + trimW / 2, trimY + trimH / 2 + 10);
      }
    }

    ctx.restore();
  }

  function drawCropMarks(pad, scale, paperW, paperH) {
    const pw = paperW * scale;
    const ph = paperH * scale;
    const markLen = 10;
    const markGap = 3;

    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.7;

    const corners = [
      [pad, pad], [pad + pw, pad],
      [pad, pad + ph], [pad + pw, pad + ph]
    ];

    corners.forEach(([cx, cy]) => {
      const dx = cx === pad ? -1 : 1;
      const dy = cy === pad ? -1 : 1;

      ctx.beginPath();
      ctx.moveTo(cx + dx * markGap, cy);
      ctx.lineTo(cx + dx * (markGap + markLen), cy);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx, cy + dy * markGap);
      ctx.lineTo(cx, cy + dy * (markGap + markLen));
      ctx.stroke();
    });
  }

  function drawDimensions(pad, scale, paperW, paperH) {
    const pw = paperW * scale;
    const ph = paperH * scale;
    const unit = getCanvasUnitText(state.result?.unit);

    ctx.font = `11px 'IBM Plex Sans Arabic', Arial`;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 4;

    ctx.fillText(`${paperW} ${unit}`, pad + pw / 2, pad + ph + 18);

    ctx.save();
    ctx.translate(pad - 18, pad + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${paperH} ${unit}`, 0, 0);
    ctx.restore();

    ctx.shadowBlur = 0;
  }

  // ========================
  // أحداث التفاعل (Mouse & Touch)
  // ========================
  function setupCanvasEvents() {
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = wrapper.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, delta);
    }, { passive: false });

    wrapper.addEventListener('mousedown', (e) => {
      state.isDragging = true;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      wrapper.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!state.isDragging) return;
      state.panX += e.clientX - state.lastX;
      state.panY += e.clientY - state.lastY;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      render();
    });

    window.addEventListener('mouseup', () => {
      state.isDragging = false;
      wrapper.style.cursor = 'grab';
    });

    // أحداث اللمس للهاتف
    wrapper.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        state.isDragging = true;
        state.lastX = e.touches[0].clientX;
        state.lastY = e.touches[0].clientY;
      }
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
      if (state.isDragging && e.touches.length === 1) {
        const clientX = e.touches[0].clientX;
        const clientY = e.touches[0].clientY;
        state.panX += clientX - state.lastX;
        state.panY += clientY - state.lastY;
        state.lastX = clientX;
        state.lastY = clientY;
        render();
      }
    }, { passive: true });

    wrapper.addEventListener('touchend', () => {
      state.isDragging = false;
    });

    wrapper.addEventListener('mousemove', handleCanvasHover);
    wrapper.addEventListener('mouseleave', hideTooltip);
  }

  function zoomAt(mx, my, factor) {
    const newZoom = Math.max(0.1, Math.min(15, state.zoom * factor));
    const change = newZoom / state.zoom;
    state.panX = mx - (mx - state.panX) * change;
    state.panY = my - (my - state.panY) * change;
    state.zoom = newZoom;
    render();
    updateZoomLabel();
  }

  function handleCanvasHover(e) {
    if (!state.result || state.isDragging || !tooltip) return;

    const rect = wrapper.getBoundingClientRect();
    const scale = getScale();
    const pad = state.padding;
    const paperW = state.result.paperW;

    // الموضع الفعلي بالفارة بعد حساب الزوم والبان
    const mx = (e.clientX - rect.left - state.panX) / state.zoom;
    const my = (e.clientY - rect.top - state.panY) / state.zoom;
    
    // الموضع بوحدة القياس المستعملة (سم مثلاً)
    const px = (mx - pad) / scale;
    const py = (my - pad) / scale;

    const isFront = state.currentSide === 'front';

    for (const pi of state.result.packed) {
      const cardW = pi.rotated ? (pi.item.origH || pi.item.h) : (pi.item.origW || pi.item.w);
      const cardH = pi.rotated ? (pi.item.origW || pi.item.w) : (pi.item.origH || pi.item.h);
      const bleed = state.result.bleed || 0;

      let cx1 = 0, cx2 = 0;
      if (isFront) {
        cx1 = pi.x + bleed;
        cx2 = pi.x + bleed + cardW;
      } else {
        cx1 = paperW - pi.x - bleed - cardW;
        cx2 = paperW - pi.x - bleed;
      }
      
      const cy1 = pi.y + bleed;
      const cy2 = pi.y + bleed + cardH;

      if (px >= cx1 && px <= cx2 && py >= cy1 && py <= cy2) {
        showTooltip(e.clientX - rect.left + 12, e.clientY - rect.top - 12, pi, cardW, cardH);
        return;
      }
    }
    hideTooltip();
  }

  function showTooltip(x, y, pi, cardW, cardH) {
    const unit = getCanvasUnitText(state.result?.unit);
    tooltip.innerHTML = `
      <div class="canvas-tooltip-title">${escapeHTML(pi.item.name)}</div>
      <div class="canvas-tooltip-detail">📐 المقاس: ${cardW.toFixed(2)} × ${cardH.toFixed(2)} ${unit}</div>
      ${pi.rotated ? '<div class="canvas-tooltip-detail">🔄 تدوير 90° أوتوماتيكي</div>' : ''}
      ${pi.bleed > 0 ? `<div class="canvas-tooltip-detail">Bleed: ${pi.bleed} ${unit}</div>` : ''}
    `;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
    tooltip.classList.add('visible');
  }

  function hideTooltip() {
    if (tooltip) tooltip.classList.remove('visible');
  }

  // ========================
  // تصدير صور وملفات PDF عالية الجودة للطباعة (300 DPI)
  // ========================
  
  // دالة لتوليد كانفاس طباعة جاهز للوجه أو الظهر بأبعاد حقيقية 1:1
  function generateHighResCanvas(side, dpi = 300) {
    if (!state.result) return null;

    const { paperW, paperH, packed, bleed = 0 } = state.result;
    const unit = state.result.unit || 'cm';

    // حساب عدد البكسلات لكل وحدة قياس
    let pxPerUnit = dpi / 2.54; // default cm
    if (unit === 'mm') pxPerUnit = dpi / 25.4;
    else if (unit === 'inch') pxPerUnit = dpi;
    else if (unit === 'px') pxPerUnit = 1;

    const pw = paperW * pxPerUnit;
    const ph = paperH * pxPerUnit;

    const expCanvas = document.createElement('canvas');
    expCanvas.width = Math.round(pw);
    expCanvas.height = Math.round(ph);
    const expCtx = expCanvas.getContext('2d');

    // ورق أبيض
    expCtx.fillStyle = '#FFFFFF';
    expCtx.fillRect(0, 0, expCanvas.width, expCanvas.height);

    const isFront = side === 'front';
    const cardImg = isFront ? state.frontImage : state.backImage;

    if (packed) {
      packed.forEach(pi => {
        const cardW = pi.rotated ? (pi.item.origH || pi.item.h) : (pi.item.origW || pi.item.w);
        const cardH = pi.rotated ? (pi.item.origW || pi.item.w) : (pi.item.origH || pi.item.h);

        const trimY = (pi.y + bleed) * pxPerUnit;
        const trimW = cardW * pxPerUnit;
        const trimH = cardH * pxPerUnit;

        let trimX = 0;
        if (isFront) {
          trimX = (pi.x + bleed) * pxPerUnit;
        } else {
          trimX = (paperW - pi.x - bleed - cardW) * pxPerUnit;
        }

        const slotX = isFront ? pi.x * pxPerUnit : (paperW - pi.x - pi.w) * pxPerUnit;
        const slotY = pi.y * pxPerUnit;
        const slotW = pi.w * pxPerUnit;
        const slotH = pi.h * pxPerUnit;

        expCtx.save();
        
        // clip لحدود الـ slot لمنع خروج البليد
        expCtx.beginPath();
        expCtx.rect(slotX, slotY, slotW, slotH);
        expCtx.clip();

        if (cardImg && cardImg.complete && cardImg.naturalWidth > 0) {
          expCtx.save();
          expCtx.translate(trimX + trimW / 2, trimY + trimH / 2);
          if (pi.rotated) {
            expCtx.rotate(isFront ? Math.PI / 2 : -Math.PI / 2);
            expCtx.drawImage(cardImg, -trimH / 2, -trimW / 2, trimH, trimW);
          } else {
            expCtx.drawImage(cardImg, -trimW / 2, -trimH / 2, trimW, trimH);
          }
          expCtx.restore();
        } else {
          // رسم بديل
          const color = isFront ? '#1565C0' : '#4CAF50';
          expCtx.fillStyle = hexToRgba(color, 0.85);
          expCtx.fillRect(trimX, trimY, trimW, trimH);
          
          expCtx.strokeStyle = color;
          expCtx.lineWidth = 2;
          expCtx.strokeRect(trimX, trimY, trimW, trimH);
        }

        // خط القص إذا كان هناك bleed
        if (bleed > 0) {
          expCtx.strokeStyle = 'rgba(255,0,0,0.6)';
          expCtx.lineWidth = 1;
          expCtx.setLineDash([8, 8]);
          expCtx.strokeRect(trimX, trimY, trimW, trimH);
          expCtx.setLineDash([]);
        }

        expCtx.restore();
      });
    }

    // إضافة العلامة المائية للنسخ المجانية
    if (window.ProtectionSystem && window.ProtectionSystem.shouldShowWatermark()) {
      expCtx.save();
      const fontSize = Math.round(8 * (dpi / 72));
      expCtx.font = `bold ${fontSize}px Arial, sans-serif`;
      
      const text = 'نسخة تجريبية وجه وظهر - https://autorus.free.nf/';
      const textWidth = expCtx.measureText(text).width;
      
      const tx = (expCanvas.width - textWidth) / 2;
      const ty = expCanvas.height - (fontSize * 1.5);
      
      expCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      expCtx.fillRect(tx - 12, ty - fontSize * 0.95, textWidth + 24, fontSize * 1.3);
      
      expCtx.fillStyle = 'rgba(75, 85, 99, 0.95)';
      expCtx.fillText(text, tx, ty);
      expCtx.restore();
    }

    return expCanvas;
  }

  // تصدير PDF مدمج وجه وظهر
  async function exportPDF() {
    if (!state.result) {
      showToast('لا توجد نتيجة رص للتصدير', 'warning');
      return;
    }

    showToast('جاري تصدير ملف PDF المدمج...', 'info');

    try {
      // تحميل jsPDF عند الحاجة
      if (typeof window.jspdf === 'undefined') {
        showToast('جاري تحميل مكتبة PDF...', 'info');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      }

      const { jsPDF } = window.jspdf;
      const { paperW, paperH, unit = 'cm' } = state.result;

      const pdfUnit = unit === 'inch' ? 'in' : (unit === 'px' ? 'px' : unit);
      const orientation = paperW > paperH ? 'landscape' : 'portrait';

      // إنشاء مستند PDF بالحجم الفعلي
      const doc = new jsPDF({
        orientation,
        unit: pdfUnit,
        format: [paperW, paperH]
      });

      // 1. إضافة صفحة الوجه (Front)
      const frontCanvas = generateHighResCanvas('front', 300);
      const frontDataURL = frontCanvas.toDataURL('image/png', 1.0);
      doc.addImage(frontDataURL, 'PNG', 0, 0, paperW, paperH, undefined, 'FAST');

      // 2. إضافة صفحة الظهر (Back)
      doc.addPage([paperW, paperH], orientation);
      const backCanvas = generateHighResCanvas('back', 300);
      const backDataURL = backCanvas.toDataURL('image/png', 1.0);
      doc.addImage(backDataURL, 'PNG', 0, 0, paperW, paperH, undefined, 'FAST');

      const name = document.getElementById('duplex-card-name').value.trim() || 'duplex';
      doc.save(`اوتورص-${name}-300dpi.pdf`);

      showToast('✅ تم تصدير ملف PDF جاهز للمطبعة بنجاح! (صفحتين: وجه وظهر)', 'success');

      if (window.ProtectionSystem && window.ProtectionSystem.incrementLimit) {
        window.ProtectionSystem.incrementLimit('pdfExports');
      }

    } catch (err) {
      console.error(err);
      showToast('خطأ أثناء تصدير PDF: ' + err.message, 'error');
    }
  }

  // تصدير صور JPG عالية الجودة
  function exportJPG() {
    if (!state.result) {
      showToast('لا توجد نتيجة رص للتصدير', 'warning');
      return;
    }

    showToast('جاري إنشاء صور الطباعة عالية الدقة...', 'info');

    setTimeout(() => {
      try {
        const name = document.getElementById('duplex-card-name').value.trim() || 'duplex';

        // 1. تصدير الوجه
        const frontCanvas = generateHighResCanvas('front', 300);
        const frontURL = frontCanvas.toDataURL('image/jpeg', 1.0);
        downloadDataURL(frontURL, `اوتورص-${name}-الوجه-300dpi.jpg`);

        // 2. تصدير الظهر
        const backCanvas = generateHighResCanvas('back', 300);
        const backURL = backCanvas.toDataURL('image/jpeg', 1.0);
        downloadDataURL(backURL, `اوتورص-${name}-الظهر-300dpi.jpg`);

        showToast('✅ تم تحميل صورتي الوجه والظهر (300 DPI) بنجاح!', 'success');

      } catch (err) {
        console.error(err);
        showToast('خطأ أثناء تصدير الصور', 'error');
      }
    }, 100);
  }

  // ========================
  // دوال مساعدة
  // ========================
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function showLoading(show, message = '') {
    if (window.AppUI && window.AppUI.showLoading) {
      window.AppUI.showLoading(show, message);
    } else {
      console.log(show ? 'LOADING: ' + message : 'STOP LOADING');
    }
  }

  function showToast(msg, type = 'info') {
    if (window.AppUI && window.AppUI.showToast) {
      window.AppUI.showToast(msg, type);
    } else {
      alert(msg);
    }
  }

  function animateCounter(id, targetVal, durationSec = 1, suffix = '') {
    const el = document.getElementById(id);
    if (!el) return;
    const start = 0;
    const end = parseFloat(targetVal);
    if (isNaN(end)) { el.textContent = targetVal; return; }
    
    const startTime = performance.now();
    
    function update(time) {
      const elapsed = (time - startTime) / 1000;
      const progress = Math.min(elapsed / durationSec, 1);
      const current = start + progress * (end - start);
      el.textContent = current.toFixed(1) + suffix;
      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }
    requestAnimationFrame(update);
  }

  function downloadDataURL(dataURL, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  function hexToRgba(hex, alpha = 1) {
    if (!hex) return `rgba(21,101,192,${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function getCanvasUnitText(unitCode) {
    if (unitCode === 'mm') return 'مم';
    if (unitCode === 'cm' || unitCode === 'سم') return 'سم';
    if (unitCode === 'inch' || unitCode === 'in') return 'بوصة';
    if (unitCode === 'px') return 'بكسل';
    return unitCode || 'سم';
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // تصدير الدوال المتاحة
  return {
    init,
    removeFile
  };
})();

window.DuplexManager = DuplexManager;
