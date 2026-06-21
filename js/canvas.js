/**
 * اوتو رص - Canvas التفاعلي الاحترافي
 * Auto Rass - Professional Interactive Canvas Renderer
 *
 * يدعم:
 * - عرض التصاميم الحقيقية (WYSIWYG)
 * - رسم دقيق بدون فجوات وهمية
 * - Zoom & Pan
 * - Tooltips
 * - تصدير بجودة 300 DPI
 */

'use strict';

const CanvasRenderer = (() => {

  let canvas  = null;
  let ctx     = null;
  let wrapper = null;
  let tooltip = null;

  let state = {
    zoom:      1,
    panX:      0,
    panY:      0,
    isDragging: false,
    lastX:     0,
    lastY:     0,
    result:    null,
    padding:   40,
    showCropMarks:  true,
    showNumbers:    true,
    showDimensions: true,
    quality:   2
  };

  const DEFAULT_COLORS = [
    '#4A90D9', '#7B68EE', '#50C878', '#FF6B6B',
    '#FFA500', '#00CED1', '#FF69B4', '#32CD32',
    '#6495ED', '#DC143C', '#00FA9A', '#FF8C00'
  ];

  // ========================
  // تهيئة
  // ========================

  function init(canvasEl, wrapperEl, tooltipEl) {
    canvas  = canvasEl;
    wrapper = wrapperEl;
    tooltip = tooltipEl;

    ctx = canvas.getContext('2d', { alpha: true });
    setupEvents();

    window.addEventListener('resize', () => { if (state.result) render(); });
  }

  // ========================
  // أحداث الماوس واللمس
  // ========================

  function setupEvents() {
    wrapper.addEventListener('wheel',     onWheel,      { passive: false });
    wrapper.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove',  onMouseMove);
    window.addEventListener('mouseup',    onMouseUp);

    wrapper.addEventListener('touchstart', onTouchStart, { passive: false });
    wrapper.addEventListener('touchmove',  onTouchMove,  { passive: false });
    wrapper.addEventListener('touchend',   onTouchEnd);

    wrapper.addEventListener('mousemove', onHover);
    wrapper.addEventListener('mouseleave', hideTooltip);
  }

  function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect  = wrapper.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, delta);
  }

  function zoomAt(mx, my, factor) {
    const newZoom   = Math.max(0.05, Math.min(20, state.zoom * factor));
    const zoomChange = newZoom / state.zoom;
    state.panX  = mx - (mx - state.panX) * zoomChange;
    state.panY  = my - (my - state.panY) * zoomChange;
    state.zoom  = newZoom;
    render();
    updateZoomLabel();
  }

  function onMouseDown(e) {
    state.isDragging = true;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    wrapper.style.cursor = 'grabbing';
  }

  function onMouseMove(e) {
    if (!state.isDragging) return;
    state.panX += e.clientX - state.lastX;
    state.panY += e.clientY - state.lastY;
    state.lastX  = e.clientX;
    state.lastY  = e.clientY;
    render();
  }

  function onMouseUp() {
    state.isDragging = false;
    wrapper.style.cursor = 'grab';
  }

  let lastTouchDist = 0;

  function onTouchStart(e) {
    if (e.touches.length === 1) {
      state.isDragging = true;
      state.lastX = e.touches[0].clientX;
      state.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      lastTouchDist = getTouchDist(e.touches);
    }
    e.preventDefault();
  }

  function onTouchMove(e) {
    if (e.touches.length === 1 && state.isDragging) {
      state.panX += e.touches[0].clientX - state.lastX;
      state.panY += e.touches[0].clientY - state.lastY;
      state.lastX = e.touches[0].clientX;
      state.lastY = e.touches[0].clientY;
      render();
    } else if (e.touches.length === 2) {
      const dist   = getTouchDist(e.touches);
      const factor = dist / lastTouchDist;
      const cx     = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy     = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect   = wrapper.getBoundingClientRect();
      zoomAt(cx - rect.left, cy - rect.top, factor);
      lastTouchDist = dist;
    }
    e.preventDefault();
  }

  function onTouchEnd() { state.isDragging = false; }

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ========================
  // Tooltip
  // ========================

  function onHover(e) {
    if (!state.result || state.isDragging) return;
    const rect  = wrapper.getBoundingClientRect();
    const mx    = (e.clientX - rect.left - state.panX) / state.zoom;
    const my    = (e.clientY - rect.top  - state.panY) / state.zoom;
    const scale = getScale();
    const pad   = state.padding;
    const px    = (mx - pad) / scale;
    const py    = (my - pad) / scale;

    for (const pi of state.result.packed) {
      if (px >= pi.x && px <= pi.x + pi.w && py >= pi.y && py <= pi.y + pi.h) {
        showTooltip(e.clientX - rect.left + 10, e.clientY - rect.top - 10, pi);
        return;
      }
    }
    hideTooltip();
  }

  function showTooltip(x, y, pi) {
    if (!tooltip) return;
    const unit     = getCanvasUnitText(state.result?.unit);
    const origW    = pi.origW || (pi.item.origW) || pi.w;
    const origH    = pi.origH || (pi.item.origH) || pi.h;
    const displayW = pi.rotated ? origH : origW;
    const displayH = pi.rotated ? origW : origH;
    tooltip.innerHTML = `
      <div class="canvas-tooltip-title">${pi.item.name}</div>
      <div class="canvas-tooltip-detail">📐 ${displayW.toFixed(2)} × ${displayH.toFixed(2)} ${unit}</div>
      <div class="canvas-tooltip-detail">🔢 كمية: ${pi.item.qty || 1}</div>
      ${pi.rotated ? '<div class="canvas-tooltip-detail">🔄 مدوّر 90°</div>' : ''}
      ${pi.bleed > 0 ? `<div class="canvas-tooltip-detail">Bleed: ${pi.bleed} ${unit}</div>` : ''}
    `;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
    tooltip.classList.add('visible');
  }

  function hideTooltip() {
    if (tooltip) tooltip.classList.remove('visible');
  }

  // ========================
  // حساب الحجم
  // ========================

  function getScale() {
    if (!state.result) return 1;
    const { paperW, paperH } = state.result;
    const wrapW = wrapper.clientWidth  || 800;
    const wrapH = wrapper.clientHeight || 500;
    const maxW  = wrapW - 2 * state.padding;
    const maxH  = wrapH - 2 * state.padding;
    return Math.min(maxW / paperW, maxH / paperH);
  }

  function fitToScreen() {
    if (!state.result) return;
    const scale    = getScale();
    const { paperW, paperH } = state.result;
    const wrapW    = wrapper.clientWidth  || 800;
    const wrapH    = wrapper.clientHeight || 500;
    const paperPxW = paperW * scale;
    const paperPxH = paperH * scale;
    state.panX  = (wrapW - paperPxW) / 2;
    state.panY  = (wrapH - paperPxH) / 2;
    state.zoom  = 1;
    updateZoomLabel();
  }

  function updateZoomLabel() {
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(state.zoom * 100) + '%';
  }

  // ========================
  // الرسم الرئيسي
  // ========================

  function resizeCanvas() {
    if (!wrapper || !canvas) return;
    const dpr = state.quality;
    const w   = wrapper.clientWidth  || 800;
    const h   = wrapper.clientHeight || 500;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let renderRequested = false;

  function render() {
    if (renderRequested) return;
    renderRequested = true;
    requestAnimationFrame(() => {
      renderRequested = false;
      doRender();
    });
  }

  function doRender() {
    if (!state.result || !canvas || !ctx) return;

    resizeCanvas();
    const w = wrapper.clientWidth  || 800;
    const h = wrapper.clientHeight || 500;
    ctx.clearRect(0, 0, w, h);

    const scale = getScale();
    const { paperW, paperH, packed, cutOrder } = state.result;

    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.zoom, state.zoom);

    const pad = state.padding;

    drawPaper(pad, pad, paperW * scale, paperH * scale);

    if (packed) {
      packed.forEach((pi, idx) => drawItem(pi, scale, pad, idx + 1));
    }

    if (cutOrder && cutOrder.length > 0) {
      drawCutLines(cutOrder, scale, pad, paperW, paperH);
    }

    if (state.showCropMarks) {
      drawCropMarks(pad, scale, paperW, paperH);
    }

    if (state.showDimensions) {
      drawDimensions(pad, scale, paperW, paperH);
    }

    ctx.restore();
  }

  // ========================
  // رسم الورقة
  // ========================

  function drawPaper(x, y, pw, ph) {
    // ظل الورقة
    ctx.shadowColor   = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur    = 20;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, y, pw, ph);

    ctx.shadowColor   = 'transparent';
    ctx.shadowBlur    = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // حد الورقة
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(x, y, pw, ph);

    // شبكة خفيفة
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    ctx.lineWidth   = 0.5;
    const gridStep  = Math.max(pw / 20, 10);
    for (let gx = x; gx <= x + pw; gx += gridStep) {
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + ph); ctx.stroke();
    }
    for (let gy = y; gy <= y + ph; gy += gridStep) {
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + pw, gy); ctx.stroke();
    }
  }

  // ========================
  // رسم العنصر (القلب الجديد)
  // ========================

  function drawItem(pi, scale, pad, num) {
    // موضع الـ slot الكامل على الـ canvas
    const slotX = pad + pi.x * scale;
    const slotY = pad + pi.y * scale;
    const slotW = pi.w * scale;
    const slotH = pi.h * scale;

    // أبعاد التصميم الحقيقية (بدون gutter)
    const bleedPx = (pi.bleed || 0) * scale;
    const gutterPx = (pi.item.gutter || 0) * scale;

    // الـ trim area (التصميم الصافي) — دائماً origW × origH
    const origW   = pi.rotated ? (pi.item.origH || pi.item.h) : (pi.item.origW || pi.item.w);
    const origH   = pi.rotated ? (pi.item.origW || pi.item.w) : (pi.item.origH || pi.item.h);
    const trimX   = slotX + bleedPx;
    const trimY   = slotY + bleedPx;
    const trimW   = origW * scale;
    const trimH   = origH * scale;

    // الـ bleed area = trim + bleed على الجانبين
    const bleedAreaX = slotX;
    const bleedAreaY = slotY;
    const bleedAreaW = (origW + 2 * (pi.bleed || 0)) * scale;
    const bleedAreaH = (origH + 2 * (pi.bleed || 0)) * scale;

    const color = pi.item.color || DEFAULT_COLORS[(num - 1) % DEFAULT_COLORS.length];

    // ── ① الصورة المرفوعة (الاحترافية) ──────────────────────────────
    const actualProduct = (window.products || []).find(p => p.id === pi.item.id) || pi.item;
    const img = actualProduct.image;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();

      // Clip إلى منطقة التصميم فقط (no overflow)
      ctx.beginPath();
      ctx.rect(slotX, slotY, slotW, slotH);
      ctx.clip();

      if (pi.rotated) {
        // رسم الصورة مع تدوير 90° حول مركز الـ trim area
        ctx.translate(trimX + trimW / 2, trimY + trimH / 2);
        ctx.rotate(Math.PI / 2);
        // بعد التدوير، أبعاد الصورة مقلوبة
        ctx.drawImage(img, -trimH / 2, -trimW / 2, trimH, trimW);
      } else {
        ctx.drawImage(img, trimX, trimY, trimW, trimH);
      }

      // خط القص المتقطع إذا كان هناك bleed
      if (pi.bleed > 0) {
        ctx.strokeStyle = 'rgba(255,0,0,0.7)';
        ctx.lineWidth   = 0.8;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(trimX, trimY, trimW, trimH);
        ctx.setLineDash([]);
      }

      ctx.restore();
      return;
    }

    // ── ② عرض بديل (بدون صورة) — لون احترافي ──────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(slotX, slotY, slotW, slotH);
    ctx.clip();

    // منطقة Bleed (إن وجدت)
    if (pi.bleed > 0) {
      ctx.fillStyle = hexToRgba(color, 0.15);
      ctx.fillRect(bleedAreaX, bleedAreaY, bleedAreaW, bleedAreaH);
    }

    // ظل خفيف
    ctx.shadowColor   = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur    = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    // خلفية التصميم بتدرج
    const grad = ctx.createLinearGradient(trimX, trimY, trimX + trimW, trimY + trimH);
    grad.addColorStop(0, hexToRgba(color, 0.9));
    grad.addColorStop(1, hexToRgba(color, 0.65));
    ctx.fillStyle = grad;
    ctx.fillRect(trimX, trimY, trimW, trimH);

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;

    // حدود trim
    ctx.strokeStyle = hexToRgba(color, 1);
    ctx.lineWidth   = 0.8;
    ctx.strokeRect(trimX, trimY, trimW, trimH);

    // حدود bleed
    if (pi.bleed > 0) {
      ctx.strokeStyle = hexToRgba(color, 0.35);
      ctx.lineWidth   = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(bleedAreaX, bleedAreaY, bleedAreaW, bleedAreaH);
      ctx.setLineDash([]);
    }

    // نمط diagonal خفيف
    if (trimW > 20 && trimH > 20) {
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.strokeStyle = '#000';
      ctx.lineWidth   = 1;
      const step = 14;
      ctx.beginPath();
      for (let d = -trimH; d <= trimW + trimH; d += step) {
        ctx.moveTo(trimX + d, trimY);
        ctx.lineTo(trimX + d + trimH, trimY + trimH);
      }
      ctx.stroke();
      ctx.restore();
    }

    // رقم المنتج
    if (state.showNumbers && trimW > 16 && trimH > 12) {
      const fontSize = Math.max(8, Math.min(16, trimW * 0.18, trimH * 0.28));
      ctx.font      = `bold ${fontSize}px 'IBM Plex Sans Arabic', Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = 'rgba(255,255,255,0.95)';
      ctx.shadowColor  = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur   = 3;
      ctx.fillText(String(num), trimX + trimW / 2, trimY + trimH / 2);
      ctx.shadowBlur = 0;
    }

    // اسم المنتج
    if (trimW > 50 && trimH > 28) {
      const nameFs = Math.max(6, Math.min(10, trimW * 0.09));
      ctx.font = `${nameFs}px 'IBM Plex Sans Arabic', Arial`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle    = 'rgba(255,255,255,0.85)';
      ctx.shadowColor  = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur   = 2;
      ctx.fillText(truncateText(pi.item.name, trimW / nameFs * 1.4), trimX + trimW / 2, trimY + trimH - 2);
      ctx.shadowBlur = 0;
    }

    // مؤشر التدوير
    if (pi.rotated && trimW > 18 && trimH > 18) {
      ctx.save();
      ctx.globalAlpha  = 0.75;
      ctx.font         = '11px Arial';
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle    = 'rgba(255,255,255,0.9)';
      ctx.fillText('↻', trimX + trimW - 3, trimY + 2);
      ctx.restore();
    }

    ctx.restore();
  }

  // ========================
  // خطوط القص
  // ========================

  function drawCutLines(cutOrder, scale, pad, paperW, paperH) {
    const pw = paperW * scale;
    const ph = paperH * scale;

    cutOrder.forEach((step, idx) => {
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 0.7;

      if (step.type === 'horizontal') {
        const y = pad + step.position * scale;
        ctx.strokeStyle = 'rgba(33,150,243,0.55)';
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + pw, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#1565C0';
        ctx.font = 'bold 8px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`H${idx + 1}`, pad + 3, y - 1);
      } else {
        const x = pad + step.position * scale;
        ctx.strokeStyle = 'rgba(156,39,176,0.55)';
        ctx.beginPath();
        ctx.moveTo(x, pad);
        ctx.lineTo(x, pad + ph);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#7B1FA2';
        ctx.font = 'bold 8px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`V${idx + 1}`, x + 1, pad + 3);
      }
    });

    ctx.setLineDash([]);
  }

  // ========================
  // علامات القص (Crop Marks)
  // ========================

  function drawCropMarks(pad, scale, paperW, paperH) {
    const pw      = paperW * scale;
    const ph      = paperH * scale;
    const markLen = 10;
    const markGap = 3;

    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth   = 0.7;
    ctx.setLineDash([]);

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

  // ========================
  // أبعاد الورقة
  // ========================

  function drawDimensions(pad, scale, paperW, paperH) {
    const pw   = paperW * scale;
    const ph   = paperH * scale;
    const unit = getCanvasUnitText(state.result?.unit);

    ctx.font         = `11px 'IBM Plex Sans Arabic', Arial`;
    ctx.fillStyle    = 'rgba(255,255,255,0.9)';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor  = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur   = 4;

    ctx.fillText(`${paperW} ${unit}`, pad + pw / 2, pad + ph + 18);

    ctx.save();
    ctx.translate(pad - 18, pad + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${paperH} ${unit}`, 0, 0);
    ctx.restore();

    ctx.shadowBlur = 0;
  }

  // ========================
  // تصدير PNG احترافي (300 DPI)
  // ========================

  function exportToPNG(dpi = 300) {
    if (!state.result) return null;

    const scale      = getScale();
    const { paperW, paperH } = state.result;
    const factor     = dpi / 96;
    const expPad     = 30;

    const expCanvas  = document.createElement('canvas');
    const expCtx     = expCanvas.getContext('2d');

    expCanvas.width  = (paperW * scale + 2 * expPad) * factor;
    expCanvas.height = (paperH * scale + 2 * expPad) * factor;
    expCtx.scale(factor, factor);

    // خلفية داكنة
    expCtx.fillStyle = '#1a2332';
    expCtx.fillRect(0, 0, expCanvas.width / factor, expCanvas.height / factor);

    // حفظ الـ ctx الحالي وإعادة الرسم على الـ export canvas
    const savedCtx    = ctx;
    const savedCanvas = canvas;
    const savedState  = {
      zoom: state.zoom, panX: state.panX, panY: state.panY,
      padding: state.padding
    };

    ctx    = expCtx;
    canvas = expCanvas;
    state.panX    = 0;
    state.panY    = 0;
    state.zoom    = 1;
    state.padding = expPad;

    render();

    const dataURL = expCanvas.toDataURL('image/png', 1.0);

    ctx    = savedCtx;
    canvas = savedCanvas;
    Object.assign(state, savedState);

    return dataURL;
  }

  // ========================
  // تصدير Print-Ready بأبعاد حقيقية
  // تصدير الـ layout بالأبعاد الحقيقية مباشرة (1cm = targetPx pixels)
  // ========================

  function exportPrintReady(dpi = 300, targetResult = null, format = 'png') {
    const res = targetResult || state.result;
    if (!res) return null;

    const { paperW, paperH, packed, bleed = 0, gutter = 0 } = res;
    const unit = res.unit || state.result?.unit || 'cm';

    // Calculate pxPerUnit depending on active unit
    let pxPerUnit = dpi / 2.54; // default cm
    if (unit === 'mm') {
      pxPerUnit = dpi / 25.4;
    } else if (unit === 'inch' || unit === 'in') {
      pxPerUnit = dpi;
    } else if (unit === 'px') {
      pxPerUnit = 1;
    }

    const pw = paperW * pxPerUnit;
    const ph = paperH * pxPerUnit;

    const expCanvas = document.createElement('canvas');
    expCanvas.width  = Math.round(pw);
    expCanvas.height = Math.round(ph);
    const expCtx    = expCanvas.getContext('2d');

    // خلفية بيضاء (ورق)
    expCtx.fillStyle = '#FFFFFF';
    expCtx.fillRect(0, 0, expCanvas.width, expCanvas.height);

    // رسم كل عنصر بالأبعاد الحقيقية
    if (packed) {
      packed.forEach(pi => {
        const actualProduct = (window.products || []).find(p => p.id === pi.item.id) || pi.item;
        const img = actualProduct.image;

        const origW  = pi.rotated ? (pi.item.origH || pi.item.h) : (pi.item.origW || pi.item.w);
        const origH  = pi.rotated ? (pi.item.origW || pi.item.w) : (pi.item.origH || pi.item.h);
        const bleedV = pi.bleed || 0;

        const trimX  = (pi.x + bleedV) * pxPerUnit;
        const trimY  = (pi.y + bleedV) * pxPerUnit;
        const trimW  = origW * pxPerUnit;
        const trimH  = origH * pxPerUnit;

        if (img && img.complete && img.naturalWidth > 0) {
          expCtx.save();
          expCtx.beginPath();
          expCtx.rect(trimX, trimY, trimW, trimH);
          expCtx.clip();
          if (pi.rotated) {
            expCtx.translate(trimX + trimW / 2, trimY + trimH / 2);
            expCtx.rotate(Math.PI / 2);
            expCtx.drawImage(img, -trimH / 2, -trimW / 2, trimH, trimW);
          } else {
            expCtx.drawImage(img, trimX, trimY, trimW, trimH);
          }
          expCtx.restore();
        } else {
          // لون احترافي بديل
          const color = pi.item.color || '#4A90D9';
          expCtx.fillStyle = hexToRgba(color, 0.85);
          expCtx.fillRect(trimX, trimY, trimW, trimH);
          expCtx.strokeStyle = hexToRgba(color, 1);
          expCtx.lineWidth   = 1;
          expCtx.strokeRect(trimX, trimY, trimW, trimH);
        }

        // خط القص إذا كان هناك bleed
        if (bleedV > 0) {
          expCtx.strokeStyle = 'rgba(255,0,0,0.6)';
          expCtx.lineWidth   = 0.5;
          expCtx.setLineDash([6, 6]);
          expCtx.strokeRect(trimX, trimY, trimW, trimH);
          expCtx.setLineDash([]);
        }
      });
    }

    // إضافة علامة مائية في الفترة التجريبية لمنع الاستغلال التجاري المجاني
    if (window.ProtectionSystem && window.ProtectionSystem.shouldShowWatermark()) {
      expCtx.save();
      const fontSize = Math.round(7.5 * (dpi / 72));
      expCtx.font = `bold ${fontSize}px Arial, sans-serif`;
      
      const text = 'نسخة تجريبية - https://autorus.free.nf/';
      const textWidth = expCtx.measureText(text).width;
      
      const tx = (expCanvas.width - textWidth) / 2;
      const ty = expCanvas.height - (fontSize * 1.5);
      
      // خلفية نصف شفافة مقروءة
      expCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      expCtx.fillRect(tx - 12, ty - fontSize * 0.95, textWidth + 24, fontSize * 1.3);
      
      // النص باللون الرمادي الداكن الهادئ
      expCtx.fillStyle = 'rgba(75, 85, 99, 0.95)';
      expCtx.fillText(text, tx, ty);
      expCtx.restore();
    }

    const mimeType = (format === 'jpg' || format === 'jpeg') ? 'image/jpeg' : 'image/png';
    return expCanvas.toDataURL(mimeType, 1.0);
  }

  // ========================
  // API خارجي
  // ========================

  function zoomIn()    { zoomAt(wrapper.clientWidth / 2, wrapper.clientHeight / 2, 1.3); }
  function zoomOut()   { zoomAt(wrapper.clientWidth / 2, wrapper.clientHeight / 2, 0.77); }
  function resetView() { fitToScreen(); render(); }

  function setResult(result) {
    state.result = result;
    fitToScreen();
    render();
  }

  function setQuality(q) { state.quality = q; }

  // ========================
  // دوال مساعدة
  // ========================

  function hexToRgba(hex, alpha = 1) {
    if (!hex) return `rgba(74,144,217,${alpha})`;
    if (hex.startsWith('rgba') || hex.startsWith('rgb')) {
      return hex.replace(/[\d.]+\)$/, `${alpha})`);
    }
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

  function truncateText(text, maxLen) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.slice(0, Math.max(1, maxLen - 2)) + '..';
  }

  function setShowCropMarks(show) {
    state.showCropMarks = show;
    render();
  }

  return {
    init,
    render,
    setResult,
    setQuality,
    zoomIn,
    zoomOut,
    resetView,
    fitToScreen,
    exportToPNG,
    exportPrintReady,
    setShowCropMarks,
    getState: () => ({ ...state })
  };

})();

window.CanvasRenderer = CanvasRenderer;
