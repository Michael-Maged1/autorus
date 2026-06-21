/* =====================================================
   صانع الكتيبات الاحترافي - Booklet Creator Engine
   Professional Booklet Creator — booklet.js
   ===================================================== */

'use strict';

window.BookletCreator = (function () {

  /* ─────────────────────────────────────────────────────
     CONSTANTS
  ───────────────────────────────────────────────────── */
  const DPI_PRINT   = 300;          // export resolution
  const DPI_PREVIEW = 96;           // canvas preview resolution
  const MM_PER_INCH = 25.4;
  const MAX_PAGES   = 200;
  const MAX_FILE_MB = 80;

  // Open-book sizes in mm [width, height] (Landscape spreads)
  const OPEN_BOOK_SIZES = {
    A5: [210,  148],
    A4: [297,  210],
    A3: [420,  297],
    A2: [594,  420],
  };

  /* ─────────────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────────────── */
  const state = {
    inputMode:   'images',  // 'images' | 'pdf'
    pages:       [],        // { id, img (HTMLImageElement), name, isBlank }
    direction:   'rtl',     // 'rtl' | 'ltr'
    openBook: {
      preset: 'A4',
      w: 297,   // mm
      h: 210,   // mm
    },
    margins: {
      top:    10,   // mm
      bottom: 10,
      left:   10,
      right:  10,
      gutter: 10,  // center fold, default 10mm = 1cm
    },
    fitToMargins: false, // fit content inside margins
    binding:   'saddle', // 'saddle' | 'folded'
    grayscale: false,
    marks: {
      crop:         false,
      bleed:        false,
      registration: false,
      safeArea:     false,
    },
    currentSheet:  0,
    showFront:     true,
    imposedSheets: [],     // [{ front:[l,r], back:[l,r] }]  page objects or null=blank
    zoom:          1.0,
    previewDirty:  true,
    pdfDoc:        null,   // pdfjsLib document
    pdfFileName:   '',
    dragSrcIdx:    null,
  };

  /* ─────────────────────────────────────────────────────
     DOM REFS (populated in init)
  ───────────────────────────────────────────────────── */
  let dom = {};

  /* ─────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────── */
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function mmToPx(mm, dpi) {
    return (mm / MM_PER_INCH) * dpi;
  }

  function getActiveUnit() {
    if (window.ProjectsManager) {
      const settings = window.ProjectsManager.getSettings();
      return settings.unit || 'cm';
    }
    return 'cm';
  }

  function getActiveUnitLabel() {
    const unit = getActiveUnit();
    if (unit === 'mm') return 'مم';
    if (unit === 'cm') return 'سم';
    if (unit === 'inch') return 'بوصة';
    if (unit === 'px') return 'بكسل';
    return 'سم';
  }

  function convertMmToActiveUnit(mm) {
    const unit = getActiveUnit();
    let val = mm;
    if (unit === 'cm') val = mm * 0.1;
    else if (unit === 'inch') val = mm / 25.4;
    return parseFloat(val.toFixed(4));
  }

  function convertActiveUnitToMm(val) {
    const unit = getActiveUnit();
    let mm = val;
    if (unit === 'cm') mm = val * 10;
    else if (unit === 'inch') mm = val * 25.4;
    return parseFloat(mm.toFixed(4));
  }

  function formatPresetDims(w, h) {
    const scaleW = convertMmToActiveUnit(w);
    const scaleH = convertMmToActiveUnit(h);
    const prec = (scaleW % 1 === 0 && scaleH % 1 === 0) ? 0 : 1;
    return `${scaleW.toFixed(prec)}×${scaleH.toFixed(prec)}`;
  }

  function getDefaultGutterText() {
    const unitLabel = getActiveUnitLabel();
    const val = convertMmToActiveUnit(10);
    const prec = val % 1 === 0 ? 0 : 1;
    return `الثنية الافتراضية: ${val.toFixed(prec)} ${unitLabel}`;
  }

  function updateBookletUnitUI() {
    const presets = { A5: [210, 148], A4: [297, 210], A3: [420, 297], A2: [594, 420] };
    if (dom.root) {
      dom.root.querySelectorAll('.size-preset-btn').forEach(btn => {
        const preset = btn.dataset.preset;
        const sz = presets[preset];
        if (sz) {
          const dimsEl = btn.querySelector('.preset-dims');
          if (dimsEl) dimsEl.textContent = formatPresetDims(sz[0], sz[1]);
        }
      });
    }
    const note = document.getElementById('booklet-default-gutter-note');
    if (note) {
      note.textContent = getDefaultGutterText();
    }
    updateIndividualPageInfo();
  }

  function showToast(msg, type = 'info') {
    // Re-use existing toast system
    if (window.App && window.App.showToast) {
      window.App.showToast(msg, type);
    } else {
      const tc = document.getElementById('toast-container');
      if (!tc) return;
      const t = document.createElement('div');
      t.className = `toast toast-${type}`;
      t.innerHTML = `<span>${msg}</span>`;
      tc.appendChild(t);
      setTimeout(() => { t.classList.add('show'); }, 10);
      setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3500);
    }
  }

  function uid() {
    return Math.random().toString(36).slice(2, 9);
  }

  function updateImposition() {
    const padded   = padPagesToDivisibleBy4(state.pages);
    state.imposedSheets = buildImposedSheets(padded, state.direction);
    state.previewDirty  = true;
    renderPreview();
    renderImpositionTable();
    renderThumbnailGrid();
  }

  /* ─────────────────────────────────────────────────────
     PAD TO DIVISIBLE BY 4
  ───────────────────────────────────────────────────── */
  function padPagesToDivisibleBy4(pages) {
    const rem = pages.length % 4;
    if (rem === 0 && pages.length > 0) return [...pages];
    const blanksNeeded = rem === 0 ? 0 : 4 - rem;
    const blanks = Array.from({ length: blanksNeeded }, () => ({
      id: uid(), img: null, name: 'blank', isBlank: true,
    }));
    // Append blanks at end for LTR; prepend 1 at start and rest at end for RTL
    // (both directions: blanks go at the very end for simplicity & printer convention)
    return [...pages, ...blanks];
  }

  /* ─────────────────────────────────────────────────────
     SADDLE-STITCH IMPOSITION
  ───────────────────────────────────────────────────── */
  function buildImposedSheets(padded, direction) {
    const n = padded.length;   // must be divisible by 4
    const sheets = [];
    const half = n / 2;

    for (let i = 0; i < n / 4; i++) {
      // Standard saddle-stitch formula (1-based page numbers):
      // Sheet i front: [n - 2i, 2i + 1]
      // Sheet i back:  [2i + 2, n - 2i - 1]
      const frontRight = padded[n - 1 - 2 * i];         // page n-2i (0-idx: n-1-2i)
      const frontLeft  = padded[2 * i];                  // page 2i+1 (0-idx: 2i)
      const backLeft   = padded[2 * i + 1];              // page 2i+2 (0-idx: 2i+1)
      const backRight  = padded[n - 2 - 2 * i];          // page n-2i-1 (0-idx: n-2-2i)

      if (direction === 'rtl') {
        // Arabic RTL: cover (Page 1) is on the LEFT of the front spread, back cover (Page n) on the RIGHT
        sheets.push({
          front: { left: frontLeft,  right: frontRight },
          back:  { left: backRight,  right: backLeft  },
        });
      } else {
        // English LTR: cover (Page 1) is on the RIGHT of the front spread, back cover (Page n) on the LEFT
        sheets.push({
          front: { left: frontRight, right: frontLeft },
          back:  { left: backLeft,   right: backRight  },
        });
      }
    }
    return sheets;
  }

  function getPageNumber(padded, page) {
    return padded.indexOf(page) + 1;
  }

  function getPaddedPages() {
    return padPagesToDivisibleBy4(state.pages);
  }

  /* ─────────────────────────────────────────────────────
     GRAYSCALE
  ───────────────────────────────────────────────────── */
  function applyGrayscaleToCanvas(ctx, w, h) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = lum;
    }
    ctx.putImageData(imageData, 0, h < 0 ? -h : 0); // guard
  }

  /* ─────────────────────────────────────────────────────
     RENDER A SINGLE PAGE TO CANVAS (returns ImageBitmap promise)
  ───────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────
     RENDER A SINGLE PAGE TO CANVAS
  ───────────────────────────────────────────────────── */
  function renderPageToOffscreenCanvas(page, pxW, pxH, gray, side = 'left', hasBleed = false) {
    const oc  = document.createElement('canvas');
    oc.width  = pxW;
    oc.height = pxH;
    const ctx = oc.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pxW, pxH);

    if (gray) {
      ctx.filter = 'grayscale(100%)';
    }

    // Calculate trim box boundaries in pixels inside this canvas
    let trimX = 0;
    let trimY = 0;
    let trimW = pxW;
    let trimH = pxH;

    const bVal = hasBleed ? 3 : 0; // bleed in mm
    let scale = pxH / (state.openBook.h + bVal * 2);

    if (hasBleed) {
      const bPx = bVal * scale;
      trimY = bPx;
      trimH = pxH - 2 * bPx;
      trimW = pxW - bPx;
      if (side === 'left') {
        trimX = bPx;
      } else {
        trimX = 0;
      }
    }

    let targetX = 0;
    let targetY = 0;
    let targetW = pxW;
    let targetH = pxH;

    if (state.fitToMargins) {
      const mt = state.margins.top * scale;
      const mb = state.margins.bottom * scale;
      const ml = state.margins.left * scale;
      const mr = state.margins.right * scale;
      const mg = state.margins.gutter * scale;

      targetY = trimY + mt;
      targetH = trimH - mt - mb;

      if (side === 'left') {
        targetX = trimX + ml;
        targetW = trimW - ml - mg / 2;
      } else {
        targetX = trimX + mg / 2;
        targetW = trimW - mr - mg / 2;
      }

      if (targetW < 0) targetW = 0;
      if (targetH < 0) targetH = 0;
    } else {
      // Draw fully covering the canvas (which extends to bleed boundaries if bleed is enabled)
      targetX = 0;
      targetY = 0;
      targetW = pxW;
      targetH = pxH;
    }

    if (page && page.img && !page.isBlank) {
      const img   = page.img;
      const scaleImg = Math.min(targetW / img.naturalWidth, targetH / img.naturalHeight);
      const sw    = img.naturalWidth  * scaleImg;
      const sh    = img.naturalHeight * scaleImg;
      const dx    = targetX + (targetW - sw) / 2;
      const dy    = targetY + (targetH - sh) / 2;
      ctx.drawImage(img, dx, dy, sw, sh);
    } else {
      // blank page - keep it solid white
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(targetX, targetY, targetW, targetH);
    }

    if (gray && (!ctx.filter || ctx.filter === 'none')) {
      applyGrayscaleToCanvas(ctx, pxW, pxH);
    }
    return oc;
  }

  /* ─────────────────────────────────────────────────────
     PREVIEW RENDERER
  ───────────────────────────────────────────────────── */
  function renderPreview() {
    if (!dom.previewCanvas) return;

    const sheet    = state.imposedSheets[state.currentSheet];
    const ctx      = dom.previewCanvas.getContext('2d');
    const PREVIEW_W = 680;
    const PREVIEW_H = 420;

    dom.previewCanvas.width  = PREVIEW_W;
    dom.previewCanvas.height = PREVIEW_H;

    if (!sheet) {
      // Empty state
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '18px IBM Plex Sans Arabic, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ارفع صوراً أو ملف PDF للمعاينة', PREVIEW_W / 2, PREVIEW_H / 2);
      return;
    }

    const spread   = state.showFront ? sheet.front : sheet.back;
    const pageLeft  = spread.left;
    const pageRight = spread.right;

    // Individual page size in mm
    const singleW = state.openBook.w / 2;
    const singleH = state.openBook.h;

    // Scale to fit preview
    const margin   = 40;
    const scaleX   = ((PREVIEW_W - margin * 2) / state.openBook.w);
    const scaleY   = ((PREVIEW_H - margin * 2) / singleH);
    const baseScale = Math.min(scaleX, scaleY) * state.zoom;

    const spreadPxW = state.openBook.w * baseScale;
    const pagePxW   = singleW  * baseScale;
    const pagePxH   = singleH  * baseScale;

    const offsetX = (PREVIEW_W - spreadPxW) / 2;
    const offsetY = (PREVIEW_H - pagePxH)   / 2;

    // Dark bg
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

    // Shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur  = 24;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(offsetX, offsetY, spreadPxW, pagePxH);
    ctx.restore();

    // Render left page
    const leftOC  = renderPageToOffscreenCanvas(pageLeft,  Math.round(pagePxW), Math.round(pagePxH), state.grayscale, 'left');
    ctx.drawImage(leftOC,  offsetX, offsetY, pagePxW, pagePxH);

    // Render right page
    const rightOC = renderPageToOffscreenCanvas(pageRight, Math.round(pagePxW), Math.round(pagePxH), state.grayscale, 'right');
    ctx.drawImage(rightOC, offsetX + pagePxW, offsetY, pagePxW, pagePxH);

    // Draw Center Marks (ticks) at the top and bottom of the fold if checked
    if (state.marks.registration) {
      ctx.save();
      ctx.strokeStyle = '#000000'; // Black 100%
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([]);
      
      // Top tick (drawing 15px long tick crossing the top edge: 10px outside, 5px inside)
      ctx.beginPath();
      ctx.moveTo(offsetX + pagePxW, offsetY - 10);
      ctx.lineTo(offsetX + pagePxW, offsetY + 5);
      ctx.stroke();

      // Bottom tick (drawing 15px long tick crossing the bottom edge: 5px inside, 10px outside)
      ctx.beginPath();
      ctx.moveTo(offsetX + pagePxW, offsetY + pagePxH - 5);
      ctx.lineTo(offsetX + pagePxW, offsetY + pagePxH + 10);
      ctx.stroke();
      ctx.restore();
    }

    // Margin guides / Safe Area Guides
    if (state.margins.top > 0 || state.margins.bottom > 0 || state.margins.left > 0 || state.margins.right > 0 || state.margins.gutter > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(244,67,54,0.5)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 4]);

      const mt = state.margins.top    * baseScale;
      const mb = state.margins.bottom * baseScale;
      const ml = state.margins.left   * baseScale;
      const mr = state.margins.right  * baseScale;
      const mg = state.margins.gutter * baseScale;

      // Left page margins
      ctx.strokeRect(offsetX + ml, offsetY + mt, pagePxW - ml - mg / 2, pagePxH - mt - mb);
      // Right page margins
      ctx.strokeRect(offsetX + pagePxW + mg / 2, offsetY + mt, pagePxW - mr - mg / 2, pagePxH - mt - mb);
      ctx.restore();
    }

    // Crop marks (corners)
    if (state.marks.crop) {
      drawCropMarks(ctx, offsetX, offsetY, spreadPxW, pagePxH, 10, 4);
    }

    // Page number labels
    const padded = getPaddedPages();
    [
      { page: pageLeft,  x: offsetX + pagePxW / 2 },
      { page: pageRight, x: offsetX + pagePxW + pagePxW / 2 },
    ].forEach(({ page, x }) => {
      const num  = page ? (padded.indexOf(page) + 1) : '—';
      const label = page?.isBlank ? `فراغ` : `صفحة ${num}`;
      ctx.save();
      ctx.fillStyle   = 'rgba(0,0,0,0.55)';
      ctx.font        = `bold ${Math.max(10, baseScale * 5)}px IBM Plex Sans Arabic, sans-serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, x, offsetY + pagePxH - 6);
      ctx.restore();
    });

    // Front/Back indicator
    const sideLabel = state.showFront ? 'وجه الورقة (Front)' : 'ظهر الورقة (Back)';
    ctx.save();
    ctx.fillStyle   = 'rgba(255,255,255,0.55)';
    ctx.font        = '12px IBM Plex Sans Arabic, sans-serif';
    ctx.textAlign   = 'center';
    ctx.fillText(sideLabel, PREVIEW_W / 2, offsetY - 10);
    ctx.restore();

    // Update sheet info text
    updateSheetNavUI();
  }

  function drawCropMarks(ctx, x, y, w, h, len, gap) {
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth   = 0.75;
    ctx.setLineDash([]);
    const marks = [
      // top-left
      [[x - gap - len, y], [x - gap, y]],
      [[x, y - gap - len], [x, y - gap]],
      // top-right
      [[x + w + gap, y], [x + w + gap + len, y]],
      [[x + w, y - gap - len], [x + w, y - gap]],
      // bottom-left
      [[x - gap - len, y + h], [x - gap, y + h]],
      [[x, y + h + gap], [x, y + h + gap + len]],
      // bottom-right
      [[x + w + gap, y + h], [x + w + gap + len, y + h]],
      [[x + w, y + h + gap], [x + w, y + h + gap + len]],
    ];
    marks.forEach(([[x1, y1], [x2, y2]]) => {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });
    ctx.restore();
  }

  /* ─────────────────────────────────────────────────────
     IMPOSITION TABLE
  ───────────────────────────────────────────────────── */
  function renderImpositionTable() {
    if (!dom.impositionTableBody) return;
    const padded = getPaddedPages();
    dom.impositionTableBody.innerHTML = '';

    state.imposedSheets.forEach((sheet, i) => {
      const row = document.createElement('tr');
      const sheetNum = i + 1;

      function pgPill(page) {
        if (!page) return '<span class="page-num-pill blank">فراغ</span>';
        const n = padded.indexOf(page) + 1;
        if (page.isBlank) return '<span class="page-num-pill blank">فراغ</span>';
        return `<span class="page-num-pill">${n}</span>`;
      }

      row.innerHTML = `
        <td><strong>${sheetNum}</strong></td>
        <td>${pgPill(sheet.front.right)} | ${pgPill(sheet.front.left)}</td>
        <td>${pgPill(sheet.back.left)} | ${pgPill(sheet.back.right)}</td>
      `;
      dom.impositionTableBody.appendChild(row);
    });

    if (state.imposedSheets.length === 0) {
      dom.impositionTableBody.innerHTML = `
        <tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:16px;">
          لا توجد بيانات — ارفع صوراً أو ملف PDF أولاً
        </td></tr>`;
    }
  }

  /* ─────────────────────────────────────────────────────
     THUMBNAIL GRID
  ───────────────────────────────────────────────────── */
  function renderThumbnailGrid() {
    const isImages  = state.inputMode === 'images';
    const gridEl    = isImages
      ? document.getElementById('booklet-thumbnail-grid')
      : document.getElementById('booklet-thumbnail-grid-pdf');
    const sectionEl = isImages
      ? document.getElementById('booklet-thumbs-section')
      : document.getElementById('pdf-thumbs-section');
    const blankEl   = isImages
      ? document.getElementById('booklet-blank-notice')
      : document.getElementById('pdf-blank-notice');
    const countEl   = isImages
      ? document.getElementById('booklet-page-count-label')
      : document.getElementById('pdf-page-count-label');

    if (!gridEl) return;

    const padded = getPaddedPages();
    gridEl.innerHTML = '';

    // Show/hide the thumbnail section
    if (sectionEl) sectionEl.style.display = padded.length > 0 ? '' : 'none';

    padded.forEach((page, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb' + (page.isBlank ? ' blank-page' : '');
      thumb.draggable  = !page.isBlank;
      thumb.dataset.idx = idx;

      if (!page.isBlank && page.img) {
        const img = document.createElement('img');
        img.src = page.img.src;
        img.alt = `صفحة ${idx + 1}`;
        thumb.appendChild(img);
      } else {
        const bl = document.createElement('div');
        bl.className = 'page-thumb-blank-label';
        bl.textContent = 'فراغ';
        thumb.appendChild(bl);
      }

      const numEl = document.createElement('div');
      numEl.className   = 'page-thumb-num';
      numEl.textContent = idx + 1;
      thumb.appendChild(numEl);

      if (!page.isBlank) {
        const rm = document.createElement('button');
        rm.className = 'page-thumb-remove';
        rm.title     = 'حذف';
        rm.innerHTML = '×';
        rm.addEventListener('click', (e) => {
          e.stopPropagation();
          removePage(page.id);
        });
        thumb.appendChild(rm);
      }

      // Drag events
      thumb.addEventListener('dragstart', onThumbDragStart);
      thumb.addEventListener('dragover',  onThumbDragOver);
      thumb.addEventListener('drop',      onThumbDrop);
      thumb.addEventListener('dragend',   onThumbDragEnd);

      gridEl.appendChild(thumb);
    });

    // Update page count labels
    const realCount = state.pages.length;
    const padCount  = padded.length;
    const blanks    = padCount - realCount;

    if (countEl) {
      countEl.textContent = `${realCount} صفحة`;
    }
    if (dom.pageSummaryLabel) {
      dom.pageSummaryLabel.textContent = `${realCount} صفحة — ${Math.ceil(padCount / 4)} ورقة مطبوعة`;
    }

    if (blankEl) {
      if (blanks > 0) {
        blankEl.style.display = 'flex';
        blankEl.querySelector('.blank-count').textContent = blanks;
      } else {
        blankEl.style.display = 'none';
      }
    }

    if (dom.exportBar) {
      dom.exportBar.style.display = state.pages.length > 0 ? 'flex' : 'none';
    }
  }

  function removePage(id) {
    state.pages = state.pages.filter(p => p.id !== id);
    updateImposition();
  }

  /* ─────────────────────────────────────────────────────
     DRAG & DROP REORDER
  ───────────────────────────────────────────────────── */
  function onThumbDragStart(e) {
    state.dragSrcIdx = parseInt(this.dataset.idx);
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.dragSrcIdx);
  }

  function onThumbDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.page-thumb').forEach(t => t.classList.remove('drag-target'));
    this.classList.add('drag-target');
  }

  function onThumbDrop(e) {
    e.stopPropagation();
    e.preventDefault();
    const srcIdx  = state.dragSrcIdx;
    const dstIdx  = parseInt(this.dataset.idx);

    if (srcIdx === null || srcIdx === dstIdx) return;

    // Only allow reordering real pages (not blanks)
    const padded = getPaddedPages();
    const realSrc = padded[srcIdx];
    const realDst = padded[dstIdx];
    if (!realSrc || realSrc.isBlank || !realDst || realDst.isBlank) return;

    // Find positions in state.pages
    const si = state.pages.findIndex(p => p.id === realSrc.id);
    const di = state.pages.findIndex(p => p.id === realDst.id);
    if (si === -1 || di === -1) return;

    const tmp = state.pages[si];
    state.pages[si] = state.pages[di];
    state.pages[di] = tmp;

    updateImposition();
  }

  function onThumbDragEnd() {
    document.querySelectorAll('.page-thumb').forEach(t => {
      t.classList.remove('dragging', 'drag-target');
    });
    state.dragSrcIdx = null;
  }

  /* ─────────────────────────────────────────────────────
     IMAGE LOADING
  ───────────────────────────────────────────────────── */
  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload  = () => resolve(img);
        img.onerror = () => reject(new Error(`فشل تحميل الصورة: ${file.name}`));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('خطأ في قراءة الملف'));
      reader.readAsDataURL(file);
    });
  }

  async function handleImageFiles(files) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    const valid   = Array.from(files).filter(f => allowed.includes(f.type));

    if (valid.length === 0) {
      showToast('الرجاء رفع صور بصيغة JPG، PNG، أو WEBP', 'error');
      return;
    }

    const remaining = MAX_PAGES - state.pages.length;
    if (valid.length > remaining) {
      showToast(`الحد الأقصى ${MAX_PAGES} صفحة. سيتم إضافة أول ${remaining} صورة فقط.`, 'warning');
    }

    const toLoad = valid.slice(0, remaining);
    showBookletLoading(true, `جاري تحميل ${toLoad.length} صورة…`);

    let loaded = 0;
    for (const file of toLoad) {
      try {
        const img = await loadImageFile(file);
        state.pages.push({ id: uid(), img, name: file.name, isBlank: false });
        loaded++;
        updateProgressBar(loaded / toLoad.length);
      } catch (err) {
        console.warn(err.message);
      }
    }

    showBookletLoading(false);
    updateImposition();
    showToast(`تم تحميل ${loaded} صورة بنجاح`, 'success');
  }

  /* ─────────────────────────────────────────────────────
     PDF LOADING
  ───────────────────────────────────────────────────── */
  async function handlePdfFile(file) {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      showToast(`الملف كبير جداً (حد ${MAX_FILE_MB} ميغابايت)`, 'error');
      return;
    }

    if (!window.pdfjsLib) {
      showToast('مكتبة PDF.js غير متوفرة', 'error');
      return;
    }

    showBookletLoading(true, 'جاري قراءة ملف PDF…');
    state.pages = [];

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      state.pdfDoc = pdfDoc;
      state.pdfFileName = file.name;
      const numPages = Math.min(pdfDoc.numPages, MAX_PAGES);

      showBookletLoading(true, `جاري معالجة ${numPages} صفحة…`);

      for (let i = 1; i <= numPages; i++) {
        const pdfPage = await pdfDoc.getPage(i);
        const viewport = pdfPage.getViewport({ scale: 2 }); // ~144 DPI preview
        const oc  = document.createElement('canvas');
        oc.width  = viewport.width;
        oc.height = viewport.height;
        const ctx = oc.getContext('2d');
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;

        const img = new Image();
        img.src = oc.toDataURL('image/jpeg', 0.92);
        await new Promise(r => { img.onload = r; });

        state.pages.push({ id: uid(), img, name: `صفحة ${i}`, isBlank: false, pdfPageIndex: i });
        updateProgressBar(i / numPages);
      }

      if (dom.pdfIndicator) {
        dom.pdfIndicator.style.display = 'flex';
        dom.pdfIndicator.querySelector('.pdf-name').textContent = file.name;
        dom.pdfIndicator.querySelector('.pdf-pages').textContent = `${numPages} صفحة`;
      }

      showBookletLoading(false);
      updateImposition();
      showToast(`تم تحميل ملف PDF (${numPages} صفحة) بنجاح`, 'success');
    } catch (err) {
      console.error('PDF load error:', err);
      showBookletLoading(false);
      showToast('فشل قراءة ملف PDF — تأكد أن الملف غير محمي بكلمة مرور', 'error');
    }
  }

  /* ─────────────────────────────────────────────────────
     LOADING UI
  ───────────────────────────────────────────────────── */
  function showBookletLoading(show, text = '') {
    if (!dom.loadingOverlay) return;
    dom.loadingOverlay.style.display = show ? 'flex' : 'none';
    if (dom.loadingText && text) dom.loadingText.textContent = text;
    updateProgressBar(0);
  }

  function updateProgressBar(fraction) {
    if (!dom.progressBar) return;
    dom.progressBar.style.width = `${Math.round(fraction * 100)}%`;
  }

  /* ─────────────────────────────────────────────────────
     SHEET NAVIGATION UI
  ───────────────────────────────────────────────────── */
  function updateSheetNavUI() {
    const total = state.imposedSheets.length;
    if (dom.sheetInfo) {
      const front = state.showFront ? 'وجه' : 'ظهر';
      dom.sheetInfo.innerHTML = `الورقة <strong>${total > 0 ? state.currentSheet + 1 : 0}</strong> / ${total} — ${front}`;
    }
    if (dom.btnPrevSheet) dom.btnPrevSheet.disabled = state.currentSheet <= 0;
    if (dom.btnNextSheet) dom.btnNextSheet.disabled = state.currentSheet >= total - 1;
    if (dom.sideLabel) {
      dom.sideLabel.textContent = state.showFront ? 'وجه (Front)' : 'ظهر (Back)';
      dom.sideLabel.className   = 'sheet-side-label' + (state.showFront ? '' : ' active-side');
    }
  }

  /* ─────────────────────────────────────────────────────
     EXPORT — PRINT / IMPOSITION JPG (ZIP)
  ───────────────────────────────────────────────────── */
  function drawCropMarksOnPrint(ctx, x, y, w, h, space) {
    const len = space * 0.7;
    const gap = 2 * (DPI_PRINT / 72); // scaled gap
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.5 * (DPI_PRINT / 72);
    const corners = [
      // top-left
      [[x - gap - len, y], [x - gap, y]],
      [[x, y - gap - len], [x, y - gap]],
      // top-right
      [[x + w + gap, y], [x + w + gap + len, y]],
      [[x + w, y - gap - len], [x + w, y - gap]],
      // bottom-left
      [[x - gap - len, y + h], [x - gap, y + h]],
      [[x, y + h + gap], [x, y + h + gap + len]],
      // bottom-right
      [[x + w + gap, y + h], [x + w + gap + len, y + h]],
      [[x + w, y + h + gap], [x + w, y + h + gap + len]],
    ];
    corners.forEach(([[x1, y1], [x2, y2]]) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawBleedMarksOnPrint(ctx, x, y, w, h, space) {
    const len = space * 0.5;
    const gap = 1 * (DPI_PRINT / 72);
    ctx.save();
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 0.3 * (DPI_PRINT / 72);
    ctx.setLineDash([2 * (DPI_PRINT / 72), 1.5 * (DPI_PRINT / 72)]);
    const corners = [
      // top-left
      [[x - gap - len, y], [x - gap, y]],
      [[x, y - gap - len], [x, y - gap]],
      // top-right
      [[x + w + gap, y], [x + w + gap + len, y]],
      [[x + w, y - gap - len], [x + w, y - gap]],
      // bottom-left
      [[x - gap - len, y + h], [x - gap, y + h]],
      [[x, y + h + gap], [x, y + h + gap + len]],
      // bottom-right
      [[x + w + gap, y + h], [x + w + gap + len, y + h]],
      [[x + w, y + h + gap], [x + w, y + h + gap + len]],
    ];
    corners.forEach(([[x1, y1], [x2, y2]]) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawRegistrationMarkOnPrint(ctx, cx, cy, r) {
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.5 * (DPI_PRINT / 72);
    
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    
    const extension = r + 2 * (DPI_PRINT / 72);
    ctx.beginPath();
    ctx.moveTo(cx - extension, cy);
    ctx.lineTo(cx + extension, cy);
    ctx.moveTo(cx, cy - extension);
    ctx.lineTo(cx, cy + extension);
    ctx.stroke();
    ctx.restore();
  }

  function renderImposedSpreadToCanvas(spread) {
    const openW  = state.openBook.w;   // mm
    const openH  = state.openBook.h;   // mm
    const bVal = state.marks.bleed ? 3 : 0;
    const MARK_SPACE = (state.marks.crop || state.marks.registration || state.marks.bleed) ? 10 : 0;

    const docW = openW + bVal * 2 + MARK_SPACE * 2;
    const docH = openH + bVal * 2 + MARK_SPACE * 2;

    const pxW = Math.round(mmToPx(docW, DPI_PRINT));
    const pxH = Math.round(mmToPx(docH, DPI_PRINT));

    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pxW, pxH);

    const scale = pxH / docH; // scale mm to pixels

    const leftW_mm = (openW / 2) + bVal;
    const rightW_mm = (openW / 2) + bVal;
    const pageH_mm = openH + bVal * 2;

    const pxW_left = Math.round(leftW_mm * scale);
    const pxW_right = Math.round(rightW_mm * scale);
    const pxH_total = Math.round(pageH_mm * scale);

    const leftOC = renderPageToOffscreenCanvas(spread.left, pxW_left, pxH_total, state.grayscale, 'left', state.marks.bleed);
    const rightOC = renderPageToOffscreenCanvas(spread.right, pxW_right, pxH_total, state.grayscale, 'right', state.marks.bleed);

    const trimX = MARK_SPACE + bVal;
    const trimY = MARK_SPACE + bVal;
    const trimW = openW;
    const trimH = openH;

    const bleedX = MARK_SPACE;
    const bleedY = MARK_SPACE;
    const bleedW = openW + bVal * 2;
    const bleedH = openH + bVal * 2;

    const lx = bleedX * scale;
    const ly = bleedY * scale;
    ctx.drawImage(leftOC, lx, ly, leftW_mm * scale, pageH_mm * scale);

    const rx = (trimX + openW / 2) * scale;
    ctx.drawImage(rightOC, rx, ly, rightW_mm * scale, pageH_mm * scale);

    if (state.marks.crop) {
      drawCropMarksOnPrint(ctx, trimX * scale, trimY * scale, trimW * scale, trimH * scale, MARK_SPACE * scale);
    }

    if (state.marks.bleed) {
      drawBleedMarksOnPrint(ctx, bleedX * scale, bleedY * scale, bleedW * scale, bleedH * scale, MARK_SPACE * scale);
    }

    if (state.marks.registration) {
      ctx.save();
      ctx.strokeStyle = '#000000'; // Black 100%
      ctx.lineWidth = 0.5 * (DPI_PRINT / 72); // solid black tick
      ctx.setLineDash([]);
      
      const cx = (trimX + openW / 2) * scale;
      // Top tick
      ctx.beginPath();
      ctx.moveTo(cx, (trimY - 5) * scale);
      ctx.lineTo(cx, (trimY + 2) * scale);
      ctx.stroke();
      
      // Bottom tick
      ctx.beginPath();
      ctx.moveTo(cx, (trimY + openH - 2) * scale);
      ctx.lineTo(cx, (trimY + openH + 5) * scale);
      ctx.stroke();
      ctx.restore();
    }

    if (state.marks.safeArea) {
      const mt = state.margins.top * scale;
      const mb = state.margins.bottom * scale;
      const ml = state.margins.left * scale;
      const mr = state.margins.right * scale;
      const mg = state.margins.gutter * scale;

      ctx.save();
      ctx.strokeStyle = 'rgba(0, 200, 200, 0.7)';
      ctx.lineWidth = 0.25 * scale;
      ctx.setLineDash([2 * scale, 2 * scale]);

      ctx.strokeRect((trimX + ml) * scale, (trimY + mt) * scale, (openW / 2 - ml - mg / 2) * scale, (openH - mt - mb) * scale);
      ctx.strokeRect((trimX + openW / 2 + mg / 2) * scale, (trimY + mt) * scale, (openW / 2 - mr - mg / 2) * scale, (openH - mt - mb) * scale);
      ctx.restore();
    }

    return canvas;
  }

  async function exportPrintJpgZip() {
    if (state.pages.length === 0) {
      showToast('لا توجد صفحات للتصدير', 'error');
      return;
    }

    // ✅ Fixed: use correct element IDs matching the HTML
    const convertBlackText = document.getElementById('booklet-opt-pure-black')?.checked ?? true;
    const threshold = parseInt(document.getElementById('booklet-opt-threshold')?.value) || 30;
    const onlySmallText = document.getElementById('booklet-opt-small-text')?.checked ?? true;
    const smallTextMaxSize = parseFloat(document.getElementById('booklet-opt-small-size')?.value) || 12;
    const convertRichBlack = document.getElementById('booklet-opt-rich-black')?.checked ?? true;

    const jpgReport = {
      detectedBlackText: 0,
      convertedToPureBlack: 0,
      richBlackTextConverted: 0,
      coloredTextPreserved: 0
    };

    const prepressOptions = {
      convertBlackText,
      threshold,
      onlySmallText,
      smallTextMaxSize,
      convertRichBlack,
      excludeMaskCanvas: true,
      report: jpgReport
    };

    showBookletLoading(true, 'جاري معالجة وتصميم ملازم الكتيب (JPG — CMYK 100% K)…');

    try {
      if (typeof window.JSZip === 'undefined') {
        showToast('جاري تحميل مكتبة الضغط...', 'info');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      }

      const zip = new window.JSZip();
      const totalSides = state.imposedSheets.length * 2;
      let sideCount = 0;

      for (let i = 0; i < state.imposedSheets.length; i++) {
        const sheet = state.imposedSheets[i];
        const sheetIndex = String(i + 1).padStart(2, '0');

        for (const [sideName, spread] of [['front', sheet.front], ['back', sheet.back]]) {
          // Render high-resolution visual spread and its text mask canvas
          const { visualCanvas, maskCanvas, excludeMaskCanvas } = await renderImposedSpreadForCmykExport(spread, prepressOptions);

          // ✅ TRUE CMYK: Convert to CMYK bytes then write as CMYK TIFF (no RGB round-trip)
          // This gives 100% K for text and proper CMYK for colours — press-ready
          const cmykBytes = convertSpreadToCmykBytes(
            visualCanvas, maskCanvas, excludeMaskCanvas, threshold, jpgReport
          );
          const tiffBlob = buildCmykTiff(
            cmykBytes, visualCanvas.width, visualCanvas.height, DPI_PRINT
          );
          const tiffArrayBuf = await tiffBlob.arrayBuffer();
          zip.file(`sheet_${sheetIndex}_${sideName}.tif`, tiffArrayBuf);

          sideCount++;
          updateProgressBar(sideCount / totalSides);
        }
      }

      showBookletLoading(true, 'جاري ضغط ملفات CMYK-TIFF وتنزيل الكتيب الجاهز...');
      const content = await zip.generateAsync({ type: 'blob' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `كتيب-طباعة-CMYK-TIFF-${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showBookletLoading(false);
      showToast('🎉 تم تصدير الكتيب كملفات CMYK-TIFF (100% K) جاهزة للمطبعة!', 'success');
      showOptimizationReport(jpgReport);
    } catch (err) {
      console.error('Print JPG export error:', err);
      showBookletLoading(false);
      showToast('فشل تصدير الملف — حاول مجدداً', 'error');
    }
  }

  /* ─────────────────────────────────────────────────────
     PREPRESS HELPER FUNCTIONS
  ───────────────────────────────────────────────────── */
  function parseColorToRgb(colorStr) {
    if (typeof colorStr !== 'string') return null;
    const trimmed = colorStr.trim().toLowerCase();
    if (trimmed === 'black') return { r: 0, g: 0, b: 0 };
    if (trimmed.startsWith('#')) {
      if (trimmed.length === 4) {
        return {
          r: parseInt(trimmed[1] + trimmed[1], 16),
          g: parseInt(trimmed[2] + trimmed[2], 16),
          b: parseInt(trimmed[3] + trimmed[3], 16)
        };
      } else if (trimmed.length === 7) {
        return {
          r: parseInt(trimmed.substring(1, 3), 16),
          g: parseInt(trimmed.substring(3, 5), 16),
          b: parseInt(trimmed.substring(5, 7), 16)
        };
      }
    } else {
      const m = trimmed.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) {
        return {
          r: parseInt(m[1], 10),
          g: parseInt(m[2], 10),
          b: parseInt(m[3], 10)
        };
      }
    }
    return null;
  }

  function syncContextState(srcCtx, dstCtx) {
    dstCtx.setTransform(srcCtx.getTransform());
    dstCtx.font = srcCtx.font;
    dstCtx.textAlign = srcCtx.textAlign;
    dstCtx.textBaseline = srcCtx.textBaseline;
    dstCtx.direction = srcCtx.direction;
    dstCtx.lineWidth = srcCtx.lineWidth;
    dstCtx.lineCap = srcCtx.lineCap;
    dstCtx.lineJoin = srcCtx.lineJoin;
    dstCtx.miterLimit = srcCtx.miterLimit;
  }

  function setupTextInterception(ctx, maskCtx, excludeMaskCtx, options) {
    const originalFillText = ctx.fillText;
    const originalStrokeText = ctx.strokeText;
    const originalDrawImage = ctx.drawImage;
    
    ctx.fillText = function(text, x, y, maxWidth) {
      const rgb = parseColorToRgb(ctx.fillStyle);
      
      let sizeAllowed = true;
      if (options.onlySmallText) {
        const sizeMatch = ctx.font.match(/(\d+(?:\.\d+)?)(px|pt|em|rem|%)/);
        if (sizeMatch) {
          let size = parseFloat(sizeMatch[1]);
          const unit = sizeMatch[2];
          if (unit === 'px') size = size * 72 / 96;
          if (size > options.smallTextMaxSize) sizeAllowed = false;
        }
      }
      
      if (rgb && sizeAllowed) {
        const isNearBlack = (rgb.r <= options.threshold && rgb.g <= options.threshold && rgb.b <= options.threshold) ||
                            (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) <= 25 && Math.max(rgb.r, rgb.g, rgb.b) <= 200);
        
        if (isNearBlack) {
          const isRich = (rgb.r > 0 || rgb.g > 0 || rgb.b > 0);
          options.report.detectedBlackText++;
          options.report.convertedToPureBlack++;
          if (isRich && options.convertRichBlack) {
            options.report.richBlackTextConverted++;
          }
          
          if (maskCtx) {
            maskCtx.save();
            syncContextState(ctx, maskCtx);
            maskCtx.fillStyle = '#ffffff';
            maskCtx.fillText(text, x, y, maxWidth);
            maskCtx.restore();
          }
        } else {
          options.report.coloredTextPreserved++;
        }
      } else {
        options.report.coloredTextPreserved++;
      }
      
      originalFillText.call(ctx, text, x, y, maxWidth);
    };
    
    ctx.strokeText = function(text, x, y, maxWidth) {
      const rgb = parseColorToRgb(ctx.strokeStyle);
      
      let sizeAllowed = true;
      if (options.onlySmallText) {
        const sizeMatch = ctx.font.match(/(\d+(?:\.\d+)?)(px|pt|em|rem|%)/);
        if (sizeMatch) {
          let size = parseFloat(sizeMatch[1]);
          const unit = sizeMatch[2];
          if (unit === 'px') size = size * 72 / 96;
          if (size > options.smallTextMaxSize) sizeAllowed = false;
        }
      }
      
      if (rgb && sizeAllowed) {
        const isNearBlack = (rgb.r <= options.threshold && rgb.g <= options.threshold && rgb.b <= options.threshold) ||
                            (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) <= 25 && Math.max(rgb.r, rgb.g, rgb.b) <= 200);
        
        if (isNearBlack) {
          const isRich = (rgb.r > 0 || rgb.g > 0 || rgb.b > 0);
          options.report.detectedBlackText++;
          options.report.convertedToPureBlack++;
          if (isRich) {
            options.report.richBlackTextConverted++;
          }
          
          if (maskCtx) {
            maskCtx.save();
            syncContextState(ctx, maskCtx);
            maskCtx.strokeStyle = '#ffffff';
            maskCtx.strokeText(text, x, y, maxWidth);
            maskCtx.restore();
          }
        } else {
          options.report.coloredTextPreserved++;
        }
      } else {
        options.report.coloredTextPreserved++;
      }
      
      originalStrokeText.call(ctx, text, x, y, maxWidth);
    };

    ctx.drawImage = function(img, ...args) {
      let x = 0, y = 0, w = 0, h = 0;
      if (args.length === 2) {
        x = args[0];
        y = args[1];
        w = img.width || img.naturalWidth || 0;
        h = img.height || img.naturalHeight || 0;
      } else if (args.length === 4) {
        x = args[0];
        y = args[1];
        w = args[2];
        h = args[3];
      } else if (args.length === 8) {
        x = args[4];
        y = args[5];
        w = args[6];
        h = args[7];
      }
      
      if (excludeMaskCtx && w > 0 && h > 0) {
        excludeMaskCtx.save();
        syncContextState(ctx, excludeMaskCtx);
        excludeMaskCtx.fillStyle = '#ffffff';
        excludeMaskCtx.fillRect(x, y, w, h);
        excludeMaskCtx.restore();
      }
      
      originalDrawImage.apply(ctx, [img, ...args]);
    };
    
    return () => {
      ctx.fillText = originalFillText;
      ctx.strokeText = originalStrokeText;
      ctx.drawImage = originalDrawImage;
    };
  }

  async function renderHighResPdfPageOverCanvas(pdfPage, canvas, gray, side = 'left', hasBleed = false, options = {}) {
    const ctx = canvas.getContext('2d');
    const pxW = canvas.width;
    const pxH = canvas.height;

    let trimX = 0;
    let trimY = 0;
    let trimW = pxW;
    let trimH = pxH;

    const bVal = hasBleed ? 3 : 0;
    const scale = pxH / (state.openBook.h + bVal * 2);

    if (hasBleed) {
      const bPx = bVal * scale;
      trimY = bPx;
      trimH = pxH - 2 * bPx;
      trimW = pxW - bPx;
      if (side === 'left') {
        trimX = bPx;
      } else {
        trimX = 0;
      }
    }

    let targetX = 0;
    let targetY = 0;
    let targetW = pxW;
    let targetH = pxH;

    if (state.fitToMargins) {
      const mt = state.margins.top * scale;
      const mb = state.margins.bottom * scale;
      const ml = state.margins.left * scale;
      const mr = state.margins.right * scale;
      const mg = state.margins.gutter * scale;

      targetY = trimY + mt;
      targetH = trimH - mt - mb;

      if (side === 'left') {
        targetX = trimX + ml;
        targetW = trimW - ml - mg / 2;
      } else {
        targetX = trimX + mg / 2;
        targetW = trimW - mr - mg / 2;
      }

      if (targetW < 0) targetW = 0;
      if (targetH < 0) targetH = 0;
    } else {
      targetX = 0;
      targetY = 0;
      targetW = pxW;
      targetH = pxH;
    }

    if (targetW <= 0 || targetH <= 0) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(targetX, targetY, targetW, targetH);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.round(targetW);
    tempCanvas.height = Math.round(targetH);
    const tempCtx = tempCanvas.getContext('2d');

    tempCtx.fillStyle = '#ffffff';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    let tempMaskCanvas = null;
    let tempMaskCtx = null;
    if (options.maskCanvas) {
      tempMaskCanvas = document.createElement('canvas');
      tempMaskCanvas.width = Math.round(targetW);
      tempMaskCanvas.height = Math.round(targetH);
      tempMaskCtx = tempMaskCanvas.getContext('2d');
      tempMaskCtx.fillStyle = '#000000'; // black background
      tempMaskCtx.fillRect(0, 0, tempMaskCanvas.width, tempMaskCanvas.height);
    }

    let tempExcludeMaskCanvas = null;
    let tempExcludeMaskCtx = null;
    if (options.excludeMaskCanvas) {
      tempExcludeMaskCanvas = document.createElement('canvas');
      tempExcludeMaskCanvas.width = Math.round(targetW);
      tempExcludeMaskCanvas.height = Math.round(targetH);
      tempExcludeMaskCtx = tempExcludeMaskCanvas.getContext('2d');
      tempExcludeMaskCtx.fillStyle = '#000000'; // black background
      tempExcludeMaskCtx.fillRect(0, 0, tempExcludeMaskCanvas.width, tempExcludeMaskCanvas.height);
    }

    const unscaledViewport = pdfPage.getViewport({ scale: 1 });
    const scaleImg = Math.min(tempCanvas.width / unscaledViewport.width, tempCanvas.height / unscaledViewport.height);
    const sw = unscaledViewport.width * scaleImg;
    const sh = unscaledViewport.height * scaleImg;
    const dx = (tempCanvas.width - sw) / 2;
    const dy = (tempCanvas.height - sh) / 2;

    const viewport = pdfPage.getViewport({ scale: scaleImg });

    let cleanup = null;
    if (options.convertBlackText) {
      cleanup = setupTextInterception(tempCtx, tempMaskCtx, tempExcludeMaskCtx, options);
    }

    const renderContext = {
      canvasContext: tempCtx,
      viewport: viewport,
      transform: [1, 0, 0, 1, dx, dy]
    };

    await pdfPage.render(renderContext).promise;

    if (cleanup) cleanup();

    if (gray) {
      tempCtx.save();
      applyGrayscaleToCanvas(tempCtx, tempCanvas.width, tempCanvas.height);
      tempCtx.restore();
    }

    ctx.drawImage(tempCanvas, targetX, targetY, targetW, targetH);

    if (options.maskCanvas && tempMaskCanvas) {
      const maskCtx = options.maskCanvas.getContext('2d');
      maskCtx.drawImage(tempMaskCanvas, targetX, targetY, targetW, targetH);
    }

    if (options.excludeMaskCanvas && tempExcludeMaskCanvas) {
      const excludeCtx = options.excludeMaskCanvas.getContext('2d');
      excludeCtx.drawImage(tempExcludeMaskCanvas, targetX, targetY, targetW, targetH);
    }
  }

  class SimpleCmykBdfBuilder {
    constructor() {
      this.buffer = [];
      this.offset = 0;
      this.offsets = {};
    }
    
    write(str) {
      const bytes = new TextEncoder().encode(str);
      this.buffer.push(bytes);
      this.offset += bytes.length;
    }
    
    writeBytes(bytes) {
      this.buffer.push(bytes);
      this.offset += bytes.length;
    }
    
    startObj(id) {
      this.offsets[id] = this.offset;
      this.write(`${id} 0 obj\n`);
    }
    
    endObj() {
      this.write(`endobj\n`);
    }
    
    build() {
      return new Blob(this.buffer, { type: 'application/pdf' });
    }
  }

  async function compressCMYKBytes(bytes) {
    const stream = new Response(bytes).body.pipeThrough(new CompressionStream('deflate'));
    const compressedBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(compressedBuffer);
  }

  async function compileCmykPdf(pages, docW, docH) {
    const builder = new SimpleCmykBdfBuilder();
    const N = pages.length;
    
    const wPt = docW * 72 / MM_PER_INCH;
    const hPt = docH * 72 / MM_PER_INCH;
    
    // Header
    builder.write("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    
    // Object 1: Catalog
    builder.startObj(1);
    builder.write("<< /Type /Catalog /Pages 2 0 R >>\n");
    builder.endObj();
    
    // Object 2: Pages
    builder.startObj(2);
    let kids = [];
    for (let i = 0; i < N; i++) {
      kids.push(`${3 + i * 3} 0 R`);
    }
    builder.write(`<< /Type /Pages /Kids [ ${kids.join(' ')} ] /Count ${N} >>\n`);
    builder.endObj();
    
    // Objects for each page
    for (let i = 0; i < N; i++) {
      const page = pages[i];
      const pageObjId = 3 + i * 3;
      const imgObjId = 4 + i * 3;
      const contentObjId = 5 + i * 3;
      
      // Page Object
      builder.startObj(pageObjId);
      builder.write(`<< /Type /Page\n   /Parent 2 0 R\n   /Resources <<\n     /XObject << /Im1 ${imgObjId} 0 R >>\n   >>\n   /MediaBox [ 0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)} ]\n   /Contents ${contentObjId} 0 R\n>>\n`);
      builder.endObj();
      
      // Compress CMYK bytes
      showBookletLoading(true, `جاري ضغط ومعالجة صفحة ${i + 1} من ${N}…`);
      const compressedBytes = await compressCMYKBytes(page.cmykBytes);
      
      // Image Object
      builder.startObj(imgObjId);
      builder.write(`<< /Type /XObject\n   /Subtype /Image\n   /Width ${page.width}\n   /Height ${page.height}\n   /ColorSpace /DeviceCMYK\n   /BitsPerComponent 8\n   /Filter /FlateDecode\n   /Length ${compressedBytes.length}\n>>\nstream\n`);
      builder.writeBytes(compressedBytes);
      builder.write("\nendstream\n");
      builder.endObj();
      
      // Content Object
      const contentText = `q\n${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm\n/Im1 Do\nQ\n`;
      builder.startObj(contentObjId);
      builder.write(`<< /Length ${contentText.length} >>\nstream\n${contentText}endstream\n`);
      builder.endObj();
      updateProgressBar(0.7 + ((i + 1) / N) * 0.3);
    }
    
    // XRef Offset
    const startXref = builder.offset;
    
    // XRef Table
    builder.write("xref\n");
    builder.write(`0 ${3 + N * 3}\n`);
    builder.write("0000000000 65535 f \n");
    for (let id = 1; id <= 2 + N * 3; id++) {
      const offsetStr = String(builder.offsets[id]).padStart(10, '0');
      builder.write(`${offsetStr} 00000 n \n`);
    }
    
    // Trailer
    builder.write("trailer\n");
    builder.write(`<< /Size ${3 + N * 3}\n   /Root 1 0 R\n>>\n`);
    builder.write("startxref\n");
    builder.write(`${startXref}\n`);
    builder.write("%%EOF\n");
    
    return builder.build();
  }

  async function renderImposedSpreadForCmykExport(spread, options) {
    const openW  = state.openBook.w;   // mm
    const openH  = state.openBook.h;   // mm
    const bVal = state.marks.bleed ? 3 : 0;
    const MARK_SPACE = (state.marks.crop || state.marks.registration || state.marks.bleed) ? 10 : 0;

    const docW = openW + bVal * 2 + MARK_SPACE * 2;
    const docH = openH + bVal * 2 + MARK_SPACE * 2;

    const pxW = Math.round(mmToPx(docW, DPI_PRINT));
    const pxH = Math.round(mmToPx(docH, DPI_PRINT));

    const visualCanvas = document.createElement('canvas');
    visualCanvas.width = pxW;
    visualCanvas.height = pxH;
    const visualCtx = visualCanvas.getContext('2d');
    visualCtx.fillStyle = '#ffffff';
    visualCtx.fillRect(0, 0, pxW, pxH);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = pxW;
    maskCanvas.height = pxH;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, pxW, pxH);

    const excludeMaskCanvas = document.createElement('canvas');
    excludeMaskCanvas.width = pxW;
    excludeMaskCanvas.height = pxH;
    const excludeMaskCtx = excludeMaskCanvas.getContext('2d');
    excludeMaskCtx.fillStyle = '#000000';
    excludeMaskCtx.fillRect(0, 0, pxW, pxH);

    const scale = pxH / docH; // scale mm to pixels

    const leftW_mm = (openW / 2) + bVal;
    const rightW_mm = (openW / 2) + bVal;
    const pageH_mm = openH + bVal * 2;

    const pxW_left = Math.round(leftW_mm * scale);
    const pxW_right = Math.round(rightW_mm * scale);
    const pxH_total = Math.round(pageH_mm * scale);

    const leftOC = renderPageToOffscreenCanvas(spread.left, pxW_left, pxH_total, state.grayscale, 'left', state.marks.bleed);
    const leftMaskCanvas = document.createElement('canvas');
    leftMaskCanvas.width = pxW_left;
    leftMaskCanvas.height = pxH_total;
    const leftMaskCtx = leftMaskCanvas.getContext('2d');
    leftMaskCtx.fillStyle = '#000000';
    leftMaskCtx.fillRect(0, 0, pxW_left, pxH_total);

    const leftExcludeMaskCanvas = document.createElement('canvas');
    leftExcludeMaskCanvas.width = pxW_left;
    leftExcludeMaskCanvas.height = pxH_total;
    const leftExcludeMaskCtx = leftExcludeMaskCanvas.getContext('2d');
    leftExcludeMaskCtx.fillStyle = '#000000';
    leftExcludeMaskCtx.fillRect(0, 0, pxW_left, pxH_total);

    if (state.inputMode === 'pdf' && state.pdfDoc && spread.left && !spread.left.isBlank) {
      const pdfPage = await state.pdfDoc.getPage(spread.left.pdfPageIndex);
      await renderHighResPdfPageOverCanvas(pdfPage, leftOC, state.grayscale, 'left', state.marks.bleed, {
        ...options,
        maskCanvas: leftMaskCanvas,
        excludeMaskCanvas: leftExcludeMaskCanvas
      });
    }

    const rightOC = renderPageToOffscreenCanvas(spread.right, pxW_right, pxH_total, state.grayscale, 'right', state.marks.bleed);
    const rightMaskCanvas = document.createElement('canvas');
    rightMaskCanvas.width = pxW_right;
    rightMaskCanvas.height = pxH_total;
    const rightMaskCtx = rightMaskCanvas.getContext('2d');
    rightMaskCtx.fillStyle = '#000000';
    rightMaskCtx.fillRect(0, 0, pxW_right, pxH_total);

    const rightExcludeMaskCanvas = document.createElement('canvas');
    rightExcludeMaskCanvas.width = pxW_right;
    rightExcludeMaskCanvas.height = pxH_total;
    const rightExcludeMaskCtx = rightExcludeMaskCanvas.getContext('2d');
    rightExcludeMaskCtx.fillStyle = '#000000';
    rightExcludeMaskCtx.fillRect(0, 0, pxW_right, pxH_total);

    if (state.inputMode === 'pdf' && state.pdfDoc && spread.right && !spread.right.isBlank) {
      const pdfPage = await state.pdfDoc.getPage(spread.right.pdfPageIndex);
      await renderHighResPdfPageOverCanvas(pdfPage, rightOC, state.grayscale, 'right', state.marks.bleed, {
        ...options,
        maskCanvas: rightMaskCanvas,
        excludeMaskCanvas: rightExcludeMaskCanvas
      });
    }

    const trimX = MARK_SPACE + bVal;
    const trimY = MARK_SPACE + bVal;
    const trimW = openW;
    const trimH = openH;

    const bleedX = MARK_SPACE;
    const bleedY = MARK_SPACE;
    const bleedW = openW + bVal * 2;
    const bleedH = openH + bVal * 2;

    const lx = bleedX * scale;
    const ly = bleedY * scale;
    visualCtx.drawImage(leftOC, lx, ly, leftW_mm * scale, pageH_mm * scale);

    const rx = (trimX + openW / 2) * scale;
    visualCtx.drawImage(rightOC, rx, ly, rightW_mm * scale, pageH_mm * scale);

    maskCtx.drawImage(leftMaskCanvas, lx, ly, leftW_mm * scale, pageH_mm * scale);
    maskCtx.drawImage(rightMaskCanvas, rx, ly, rightW_mm * scale, pageH_mm * scale);

    excludeMaskCtx.drawImage(leftExcludeMaskCanvas, lx, ly, leftW_mm * scale, pageH_mm * scale);
    excludeMaskCtx.drawImage(rightExcludeMaskCanvas, rx, ly, rightW_mm * scale, pageH_mm * scale);

    if (state.marks.crop) {
      drawCropMarksOnPrint(visualCtx, trimX * scale, trimY * scale, trimW * scale, trimH * scale, MARK_SPACE * scale);
    }

    if (state.marks.bleed) {
      drawBleedMarksOnPrint(visualCtx, bleedX * scale, bleedY * scale, bleedW * scale, bleedH * scale, MARK_SPACE * scale);
    }

    if (state.marks.registration) {
      visualCtx.save();
      visualCtx.strokeStyle = '#000000'; // Black 100%
      visualCtx.lineWidth = 0.5 * (DPI_PRINT / 72); // solid black tick
      visualCtx.setLineDash([]);
      
      const cx = (trimX + openW / 2) * scale;
      visualCtx.beginPath();
      visualCtx.moveTo(cx, (trimY - 5) * scale);
      visualCtx.lineTo(cx, (trimY + 2) * scale);
      visualCtx.stroke();
      
      visualCtx.beginPath();
      visualCtx.moveTo(cx, (trimY + openH - 2) * scale);
      visualCtx.lineTo(cx, (trimY + openH + 5) * scale);
      visualCtx.stroke();
      visualCtx.restore();
    }

    if (state.marks.safeArea) {
      const mt = state.margins.top * scale;
      const mb = state.margins.bottom * scale;
      const ml = state.margins.left * scale;
      const mr = state.margins.right * scale;
      const mg = state.margins.gutter * scale;

      visualCtx.save();
      visualCtx.strokeStyle = 'rgba(0, 200, 200, 0.7)';
      visualCtx.lineWidth = 0.25 * scale;
      visualCtx.setLineDash([2 * scale, 2 * scale]);

      visualCtx.strokeRect((trimX + ml) * scale, (trimY + mt) * scale, (openW / 2 - ml - mg / 2) * scale, (openH - mt - mb) * scale);
      visualCtx.strokeRect((trimX + openW / 2 + mg / 2) * scale, (trimY + mt) * scale, (openW / 2 - mr - mg / 2) * scale, (openH - mt - mb) * scale);
      visualCtx.restore();
    }

    return { visualCanvas, maskCanvas, excludeMaskCanvas };
  }

  function convertSpreadToCmykBytes(visualCanvas, maskCanvas, excludeMaskCanvas, threshold, report) {
    const w = visualCanvas.width;
    const h = visualCanvas.height;
    const visualCtx = visualCanvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    const excludeCtx = excludeMaskCanvas.getContext('2d');
    
    const visualData = visualCtx.getImageData(0, 0, w, h);
    const maskData = maskCtx.getImageData(0, 0, w, h);
    const excludeData = excludeCtx.getImageData(0, 0, w, h);
    
    const totalPixels = w * h;
    const cmykBytes = new Uint8Array(totalPixels * 4);
    
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const r = visualData.data[idx];
      const g = visualData.data[idx + 1];
      const b = visualData.data[idx + 2];

      const maskVal    = maskData.data[idx];
      const excludeVal = excludeData.data[idx];

      let c, m, y, k;

      // In image mode excludeVal=0 → isTextOrVector=true for all pixels
      const isTextOrVector = maskVal > 128 || (excludeVal <= 128);
      // Near-black: all channels <= threshold
      const isNearBlack = (r <= threshold && g <= threshold && b <= threshold);
      // Near-white: all channels near 255 (pure background)
      const isNearWhite = (r >= 240 && g >= 240 && b >= 240);
      // Gray/neutral: small chroma range, not too bright
      const isGrayText  = !isNearBlack && !isNearWhite &&
                          (Math.max(r, g, b) - Math.min(r, g, b) <= 25 && Math.max(r, g, b) <= 200);

      if (isNearBlack) {
        // ✅ Force ALL near-black pixels to pure 100% K — no shading, sharp text
        c = 0; m = 0; y = 0; k = 255;
        report.detectedBlackText++;
        report.convertedToPureBlack++;
        if (r > 0 || g > 0 || b > 0) report.richBlackTextConverted++;

      } else if (isNearWhite) {
        // ✅ Force near-white pixels to pure white (C=M=Y=K=0) — no ink on background
        c = 0; m = 0; y = 0; k = 0;

      } else if (isGrayText && isTextOrVector) {
        // Gray text / vector: K-only (no colour ink)
        c = 0; m = 0; y = 0;
        k = Math.max(0, Math.min(255, Math.round(255 - (r + g + b) / 3)));
        report.detectedBlackText++;
        report.convertedToPureBlack++;

      } else {
        // Standard RGB → CMYK for photos and coloured areas
        const rf = r / 255, gf = g / 255, bf = b / 255;
        const kf = 1 - Math.max(rf, gf, bf);
        if (kf >= 1 - 1 / 255) {
          c = 0; m = 0; y = 0; k = 255;
        } else {
          const d = 1 - kf;
          c = Math.round(((1 - rf - kf) / d) * 255);
          m = Math.round(((1 - gf - kf) / d) * 255);
          y = Math.round(((1 - bf - kf) / d) * 255);
          k = Math.round(kf * 255);
        }
        if (maskVal > 128 && !isNearBlack && !isGrayText) report.coloredTextPreserved++;
      }

      cmykBytes[idx]     = c;
      cmykBytes[idx + 1] = m;
      cmykBytes[idx + 2] = y;
      cmykBytes[idx + 3] = k;
    }

    return cmykBytes;
  }

  /* ─────────────────────────────────────────────────────
     PACKBITS COMPRESSION (for CMYK TIFF)
  ───────────────────────────────────────────────────── */
  function packBitsEncode(data) {
    const result = [];
    let i = 0;
    const n = data.length;
    while (i < n) {
      // Try run-length: same byte repeated
      let runLen = 1;
      while (i + runLen < n && runLen < 128 && data[i + runLen] === data[i]) runLen++;
      if (runLen >= 2) {
        result.push(((1 - runLen) + 256) & 0xFF); // signed: -(runLen-1)
        result.push(data[i]);
        i += runLen;
        continue;
      }
      // Literal run: collect bytes until we see ≥2 repeating ahead
      let litEnd = i + 1;
      while (litEnd < n && litEnd - i < 128) {
        let ahead = 0;
        while (litEnd + ahead < n && ahead < 3 && data[litEnd + ahead] === data[litEnd]) ahead++;
        if (ahead >= 2) break;
        litEnd++;
      }
      const litLen = litEnd - i;
      result.push(litLen - 1);
      for (let j = i; j < litEnd; j++) result.push(data[j]);
      i = litEnd;
    }
    return new Uint8Array(result);
  }

  /* ─────────────────────────────────────────────────────
     CMYK TIFF BUILDER — PackBits compressed, DeviceCMYK
     Produces files readable by Photoshop, InDesign, RIPs
  ───────────────────────────────────────────────────── */
  function buildCmykTiff(cmykBytes, width, height, dpi) {
    // Encode each row separately with PackBits
    const rowStride    = width * 4;
    const encodedRows  = new Array(height);
    let   totalEncoded = 0;
    for (let r = 0; r < height; r++) {
      encodedRows[r]  = packBitsEncode(cmykBytes.subarray(r * rowStride, r * rowStride + rowStride));
      totalEncoded   += encodedRows[r].length;
    }

    // Memory layout:
    // [0..7]         TIFF header (8 bytes)
    // [8..ifdEnd]    IFD (13 tags × 12 bytes + count + next = 162 bytes)
    // extraBase..    extra IFD data: BitsPerSample(8B) XRes(8B) YRes(8B)
    //                RowOffsets(h×4B) RowCounts(h×4B)
    // imageDataOff.. PackBits image data
    const numTags       = 13;
    const ifdOffset     = 8;
    const ifdSize       = 2 + numTags * 12 + 4;
    const extraBase     = ifdOffset + ifdSize;
    const bpsOff        = extraBase;                     // 8 bytes
    const xResOff       = bpsOff + 8;                    // 8 bytes
    const yResOff       = xResOff + 8;                   // 8 bytes
    const rowOffsetsOff = yResOff + 8;                   // height × 4 bytes
    const rowCountsOff  = rowOffsetsOff + height * 4;    // height × 4 bytes
    const imageDataOff  = rowCountsOff  + height * 4;
    const totalSize     = imageDataOff + totalEncoded;

    const buf  = new ArrayBuffer(totalSize);
    const u8   = new Uint8Array(buf);
    const view = new DataView(buf);

    // ── TIFF header ──────────────────────────────────────
    u8[0] = 0x49; u8[1] = 0x49;           // 'II' little-endian
    view.setUint16(2, 42, true);           // magic
    view.setUint32(4, ifdOffset, true);    // IFD offset

    // ── IFD ──────────────────────────────────────────────
    let p = ifdOffset;
    view.setUint16(p, numTags, true); p += 2;

    function ifdTag(id, type, count, val) {
      view.setUint16(p,   id,    true);
      view.setUint16(p+2, type,  true);
      view.setUint32(p+4, count, true);
      if (type === 3 && count === 1) {      // SHORT fits in value field
        view.setUint16(p+8, val, true);
        view.setUint16(p+10, 0,  true);
      } else {
        view.setUint32(p+8, val, true);    // LONG or offset
      }
      p += 12;
    }

    ifdTag(256, 4, 1,       width);           // ImageWidth
    ifdTag(257, 4, 1,       height);          // ImageLength
    ifdTag(258, 3, 4,       bpsOff);          // BitsPerSample [8,8,8,8]
    ifdTag(259, 3, 1,       32773);           // Compression = PackBits
    ifdTag(262, 3, 1,       5);               // PhotometricInterpretation = CMYK
    ifdTag(273, 4, height,  rowOffsetsOff);   // StripOffsets (one per row)
    ifdTag(277, 3, 1,       4);               // SamplesPerPixel = 4
    ifdTag(278, 4, 1,       1);               // RowsPerStrip = 1
    ifdTag(279, 4, height,  rowCountsOff);    // StripByteCounts
    ifdTag(282, 5, 1,       xResOff);         // XResolution
    ifdTag(283, 5, 1,       yResOff);         // YResolution
    ifdTag(284, 3, 1,       1);               // PlanarConfiguration = chunky
    ifdTag(296, 3, 1,       2);               // ResolutionUnit = inch
    view.setUint32(p, 0, true);               // NextIFD = 0

    // ── Extra data ────────────────────────────────────────
    view.setUint16(bpsOff,   8, true);
    view.setUint16(bpsOff+2, 8, true);
    view.setUint16(bpsOff+4, 8, true);
    view.setUint16(bpsOff+6, 8, true);
    view.setUint32(xResOff,   dpi, true); view.setUint32(xResOff+4, 1, true);
    view.setUint32(yResOff,   dpi, true); view.setUint32(yResOff+4, 1, true);

    // ── Row offsets, counts and data ─────────────────────
    let imgCursor = imageDataOff;
    for (let r = 0; r < height; r++) {
      view.setUint32(rowOffsetsOff + r * 4, imgCursor,              true);
      view.setUint32(rowCountsOff  + r * 4, encodedRows[r].length,  true);
      u8.set(encodedRows[r], imgCursor);
      imgCursor += encodedRows[r].length;
    }

    return new Blob([buf], { type: 'image/tiff' });
  }

  function showOptimizationReport(report) {
    const detected = Math.max(0, Math.round(report.detectedBlackText / 120)) || (report.detectedBlackText > 0 ? 1 : 0);
    const converted = Math.max(0, Math.round(report.convertedToPureBlack / 120)) || (report.convertedToPureBlack > 0 ? 1 : 0);
    const rich = Math.max(0, Math.round(report.richBlackTextConverted / 120)) || (report.richBlackTextConverted > 0 ? 1 : 0);
    const preserved = report.coloredTextPreserved > 0 ? report.coloredTextPreserved : Math.max(0, Math.round(report.coloredTextPreserved / 120));

    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.style.zIndex = '99999';
    modal.innerHTML = `
      <div class="modal-card" style="max-width: 450px; direction: rtl; text-align: right; font-family: 'Cairo', 'IBM Plex Sans Arabic', sans-serif;">
        <div class="modal-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 16px;">
          <h3 style="margin: 0; color: var(--color-primary-600); display: flex; align-items: center; gap: 8px;">
            ✨ تقرير تحسين الطباعة الفنية (Prepress)
          </h3>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 16px; font-size: 0.9rem; color: var(--text-primary);">
          <p style="margin: 0; line-height: 1.5; color: var(--text-secondary);">
            تم تصدير ملف الـ PDF بنجاح مع تطبيق فلاتر Prepress الذكية لضمان طباعة نصوص سوداء حادة وخالية من الهالات الملونة أو الاهتزاز أثناء الطباعة التجارية.
          </p>
          
          <div style="background: var(--bg-hover); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed var(--border-color); padding-bottom: 8px;">
              <span>النصوص السوداء المكتشفة:</span>
              <strong style="color: var(--color-primary-600);">${detected}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed var(--border-color); padding-bottom: 8px;">
              <span>تم تحويلها لأسود خالص (100% K):</span>
              <strong style="color: #16a34a;">${converted}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed var(--border-color); padding-bottom: 8px;">
              <span>نصوص أسود غني (Rich Black) تم تصحيحها:</span>
              <strong style="color: #ea580c;">${rich}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding-bottom: 4px;">
              <span>نصوص ملونة تم الاحتفاظ بها:</span>
              <strong style="color: var(--text-primary);">${preserved}</strong>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="margin-top: 20px; display: flex; justify-content: flex-end; border-top: 1px solid var(--border-color); padding-top: 12px;">
          <button class="btn btn-primary" id="btn-close-prepress-report" style="padding: 8px 24px;">إغلاق التقرير</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.querySelector('#btn-close-prepress-report').addEventListener('click', () => {
      modal.remove();
    });
  }

  /* ─────────────────────────────────────────────────────
     EXPORT — PRINT / IMPOSITION PDF
     ───────────────────────────────────────────────────── */
  async function exportPrintPdf() {
    if (state.pages.length === 0) {
      showToast('لا توجد صفحات للتصدير', 'error');
      return;
    }

    showBookletLoading(true, 'جاري إنشاء PDF الطباعة (تناوب)…');

    // Prepress Report configuration
    const pdfReport = {
      detectedBlackText: 0,
      convertedToPureBlack: 0,
      coloredTextPreserved: 0,
      richBlackTextConverted: 0
    };
    const convertBlackText = document.getElementById('booklet-opt-pure-black')?.checked || false;
    const threshold = parseInt(document.getElementById('booklet-opt-threshold')?.value) || 30;
    const convertRichBlack = document.getElementById('booklet-opt-rich-black')?.checked || false;
    const onlySmallText = document.getElementById('booklet-opt-small-text')?.checked || false;
    const smallTextMaxSize = parseFloat(document.getElementById('booklet-opt-small-size')?.value) || 12;
    const prepressOptions = {
      convertBlackText,
      threshold,
      convertRichBlack,
      onlySmallText,
      smallTextMaxSize,
      report: pdfReport
    };

    if (convertBlackText) {
      // ────────── CMYK PDF EXPORT FLOW ──────────
      try {
        const openW  = state.openBook.w;   // mm (full spread)
        const openH  = state.openBook.h;   // mm

        const bVal = state.marks.bleed ? 3 : 0; // 3mm bleed area on each side
        const MARK_SPACE = (state.marks.crop || state.marks.registration || state.marks.bleed) ? 10 : 0; // space for marks

        const docW = openW + bVal * 2 + MARK_SPACE * 2;
        const docH = openH + bVal * 2 + MARK_SPACE * 2;

        const totalSides = state.imposedSheets.length * 2;
        let sideCount = 0;

        const cmykPages = [];

        for (const sheet of state.imposedSheets) {
          for (const spread of [sheet.front, sheet.back]) {
            // Render the high-resolution visual spread and its text mask canvas
            const { visualCanvas, maskCanvas, excludeMaskCanvas } = await renderImposedSpreadForCmykExport(spread, prepressOptions);

            // Convert pixels to CMYK color space using prepress filters
            const cmykBytes = convertSpreadToCmykBytes(visualCanvas, maskCanvas, excludeMaskCanvas, threshold, pdfReport);

            cmykPages.push({
              width: visualCanvas.width,
              height: visualCanvas.height,
              cmykBytes: cmykBytes
            });

            sideCount++;
            updateProgressBar((sideCount / totalSides) * 0.7); // 70% of progress is rendering/scanning
          }
        }

        // Compile to final PDF with CMYK pages
        const pdfBlob = await compileCmykPdf(cmykPages, docW, docH);

        const link = document.createElement('a');
        link.href = URL.createObjectURL(pdfBlob);
        link.download = `كتيب-طباعة-CMYK-${Date.now()}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showBookletLoading(false);
        showToast('تم تصدير PDF الطباعة (CMYK) بنجاح ✓ جاهز للمطبعة', 'success');

        // Show prepress report
        showOptimizationReport(pdfReport);
      } catch (err) {
        console.error('CMYK PDF export error:', err);
        showBookletLoading(false);
        showToast('فشل التصدير — حاول مجدداً', 'error');
      }
    } else {
      // ────────── STANDARD RGB PDF EXPORT FLOW (jsPDF) ──────────
      try {
        const { jsPDF } = window.jspdf;
        const openW  = state.openBook.w;   // mm (full spread)
        const openH  = state.openBook.h;   // mm

        const bVal = state.marks.bleed ? 3 : 0; // 3mm bleed area on each side
        const MARK_SPACE = (state.marks.crop || state.marks.registration || state.marks.bleed) ? 10 : 0; // space for marks

        const docW = openW + bVal * 2 + MARK_SPACE * 2;
        const docH = openH + bVal * 2 + MARK_SPACE * 2;

        const doc = new jsPDF({
          orientation: docW > docH ? 'landscape' : 'portrait',
          unit: 'mm',
          format: [docW, docH],
          compress: true,
        });

        const leftW_mm = (openW / 2) + bVal;
        const rightW_mm = (openW / 2) + bVal;
        const pageH_mm = openH + bVal * 2;

        const pxW_left = Math.round(mmToPx(leftW_mm, DPI_PRINT));
        const pxW_right = Math.round(mmToPx(rightW_mm, DPI_PRINT));
        const pxH_total = Math.round(mmToPx(pageH_mm, DPI_PRINT));

        const totalSides = state.imposedSheets.length * 2;
        let sideCount = 0;

        const trimX = MARK_SPACE + bVal;
        const trimY = MARK_SPACE + bVal;
        const trimW = openW;
        const trimH = openH;

        const bleedX = MARK_SPACE;
        const bleedY = MARK_SPACE;
        const bleedW = openW + bVal * 2;
        const bleedH = openH + bVal * 2;

        for (const sheet of state.imposedSheets) {
          for (const spread of [sheet.front, sheet.back]) {
            if (sideCount > 0) doc.addPage([docW, docH], docW > docH ? 'landscape' : 'portrait');

            const leftOC  = renderPageToOffscreenCanvas(spread.left,  pxW_left,  pxH_total, state.grayscale, 'left',  state.marks.bleed);
            if (state.inputMode === 'pdf' && state.pdfDoc && spread.left && !spread.left.isBlank) {
              const pdfPage = await state.pdfDoc.getPage(spread.left.pdfPageIndex);
              await renderHighResPdfPageOverCanvas(pdfPage, leftOC, state.grayscale, 'left', state.marks.bleed, prepressOptions);
            }

            const rightOC = renderPageToOffscreenCanvas(spread.right, pxW_right, pxH_total, state.grayscale, 'right', state.marks.bleed);
            if (state.inputMode === 'pdf' && state.pdfDoc && spread.right && !spread.right.isBlank) {
              const pdfPage = await state.pdfDoc.getPage(spread.right.pdfPageIndex);
              await renderHighResPdfPageOverCanvas(pdfPage, rightOC, state.grayscale, 'right', state.marks.bleed, prepressOptions);
            }

            // Place LEFT page (starts at bleed left boundary)
            const lx = bleedX;
            const ly = bleedY;
            doc.addImage(leftOC.toDataURL('image/jpeg', 0.95),  'JPEG', lx, ly, leftW_mm, pageH_mm, '', 'FAST');

            // Place RIGHT page (starts at center fold line)
            const rx = trimX + openW / 2;
            doc.addImage(rightOC.toDataURL('image/jpeg', 0.95), 'JPEG', rx, ly, rightW_mm, pageH_mm, '', 'FAST');

            // Trim/Crop marks
            if (state.marks.crop) {
              addCropMarksToPdf(doc, trimX, trimY, trimW, trimH, MARK_SPACE);
            }

            // Bleed marks
            if (state.marks.bleed) {
              addBleedMarksToPdf(doc, bleedX, bleedY, bleedW, bleedH, MARK_SPACE);
            }

            // Center fold tick marks (Black 100%) - replacing registration marks
            if (state.marks.registration) {
              doc.setDrawColor(0, 0, 0); // Black 100%
              doc.setLineWidth(0.2); // ~0.5pt thickness
              
              // Top center mark
              doc.line(trimX + openW / 2, trimY - 5, trimX + openW / 2, trimY + 2);
              
              // Bottom center mark
              doc.line(trimX + openW / 2, trimY + openH - 2, trimX + openW / 2, trimY + openH + 5);
            }

            // Safe area guides (margin limits)
            if (state.marks.safeArea) {
              const mt = state.margins.top;
              const mb = state.margins.bottom;
              const ml = state.margins.left;
              const mr = state.margins.right;
              const mg = state.margins.gutter;

              doc.setDrawColor(0, 200, 200);
              doc.setLineWidth(0.15);
              doc.setLineDashPattern([1, 1], 0);

              // Left Page Safe Area
              doc.rect(trimX + ml, trimY + mt, openW / 2 - ml - mg / 2, openH - mt - mb);
              // Right Page Safe Area
              doc.rect(trimX + openW / 2 + mg / 2, trimY + mt, openW / 2 - mr - mg / 2, openH - mt - mb);
              doc.setLineDashPattern([], 0);
            }

            sideCount++;
            updateProgressBar(sideCount / totalSides);
          }
        }

        doc.save(`كتيب-طباعة-${Date.now()}.pdf`);
        showBookletLoading(false);
        showToast('تم تصدير PDF الطباعة بنجاح ✓ جاهز للمطبعة', 'success');
      } catch (err) {
        console.error('Print PDF export error:', err);
        showBookletLoading(false);
        showToast('فشل التصدير — حاول مجدداً', 'error');
      }
    }
  }

  function addBleedMarksToPdf(doc, x, y, w, h, space) {
    const len = space * 0.5;
    const gap = 1;
    doc.setDrawColor(128, 128, 128);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1.5, 1], 0);
    const corners = [
      // top-left
      [[x - gap - len, y], [x - gap, y]],
      [[x, y - gap - len], [x, y - gap]],
      // top-right
      [[x + w + gap, y], [x + w + gap + len, y]],
      [[x + w, y - gap - len], [x + w, y - gap]],
      // bottom-left
      [[x - gap - len, y + h], [x - gap, y + h]],
      [[x, y + h + gap], [x, y + h + gap + len]],
      // bottom-right
      [[x + w + gap, y + h], [x + w + gap + len, y + h]],
      [[x + w, y + h + gap], [x + w, y + h + gap + len]],
    ];
    corners.forEach(([[x1, y1], [x2, y2]]) => doc.line(x1, y1, x2, y2));
    doc.setLineDashPattern([], 0);
  }

  function addCropMarksToPdf(doc, x, y, w, h, space) {
    const len = space * 0.7;
    const gap = 2;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([], 0);
    const corners = [
      // top-left
      [[x - gap - len, y], [x - gap, y]],
      [[x, y - gap - len], [x, y - gap]],
      // top-right
      [[x + w + gap, y], [x + w + gap + len, y]],
      [[x + w, y - gap - len], [x + w, y - gap]],
      // bottom-left
      [[x - gap - len, y + h], [x - gap, y + h]],
      [[x, y + h + gap], [x, y + h + gap + len]],
      // bottom-right
      [[x + w + gap, y + h], [x + w + gap + len, y + h]],
      [[x + w, y + h + gap], [x + w, y + h + gap + len]],
    ];
    corners.forEach(([[x1, y1], [x2, y2]]) => doc.line(x1, y1, x2, y2));
  }

  function addRegistrationMarkToPdf(doc, cx, cy, r) {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.circle(cx, cy, r);
    doc.line(cx - r - 1, cy, cx + r + 1, cy);
    doc.line(cx, cy - r - 1, cx, cy + r + 1);
  }

  /* ─────────────────────────────────────────────────────
     SETTINGS CHANGE HANDLERS
  ───────────────────────────────────────────────────── */
  function onSizePreset(preset) {
    const [w, h] = OPEN_BOOK_SIZES[preset];
    state.openBook.preset = preset;
    state.openBook.w = w;
    state.openBook.h = h;
    if (dom.customW) dom.customW.value = convertMmToActiveUnit(w);
    if (dom.customH) dom.customH.value = convertMmToActiveUnit(h);
    updateSizePresetButtons(preset);
    updateIndividualPageInfo();
    renderPreview();
  }

  function updateSizePresetButtons(active) {
    dom.root.querySelectorAll('.size-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === active);
    });
  }

  function updateIndividualPageInfo() {
    if (!dom.individualPageInfo) return;
    const unitLabel = getActiveUnitLabel();
    const pw = convertMmToActiveUnit(state.openBook.w / 2);
    const ph = convertMmToActiveUnit(state.openBook.h);
    const prec = (pw % 1 === 0 && ph % 1 === 0) ? 0 : 2;
    dom.individualPageInfo.querySelector('.page-size-text').textContent =
      `حجم الصفحة الواحدة: ${pw.toFixed(prec)} × ${ph.toFixed(prec)} ${unitLabel}`;
  }

  /* ─────────────────────────────────────────────────────
     ACCORDION
  ───────────────────────────────────────────────────── */
  function setupAccordion(headerEl) {
    headerEl.addEventListener('click', () => {
      const bodyEl = headerEl.nextElementSibling;
      const collapsed = bodyEl.classList.toggle('collapsed');
      headerEl.classList.toggle('collapsed', collapsed);
    });
  }

  /* ─────────────────────────────────────────────────────
     INIT — BUILD DOM
  ───────────────────────────────────────────────────── */
  function buildUI(tabPanel) {
    tabPanel.innerHTML = `
      <!-- EXPORT BAR -->
      <div class="booklet-export-bar" id="booklet-export-bar" style="display:none;margin-bottom:var(--space-lg)">
        <div class="export-info">
          <div class="info-title">📖 الكتيب جاهز للتصدير</div>
          <div class="info-sub" id="booklet-page-summary">—</div>
        </div>
        <button class="btn btn-export-reading" id="btn-booklet-export-reading" title="تصدير جميع الصفحات كصور JPG في ملف ZIP مضغوط">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          تصدير JPG (ZIP) 📦
        </button>
        <button class="btn btn-export-print" id="btn-booklet-export-print">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          تصدير PDF طباعة 🖨️
        </button>
      </div>

      <!-- MAIN BOOKLET LAYOUT -->
      <div class="booklet-layout">

        <!-- ===== LEFT: SETTINGS PANEL ===== -->
        <div class="booklet-settings-panel">

          <!-- INPUT MODE -->
          <div class="booklet-settings-card">
            <div class="booklet-settings-header" id="bsh-input">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <h3>مصدر الصفحات</h3>
              <span class="toggle-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </span>
            </div>
            <div class="booklet-settings-body" id="bsb-input">
              <div class="input-mode-toggle">
                <button class="input-mode-btn active" id="btn-mode-images">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  صور
                </button>
                <button class="input-mode-btn" id="btn-mode-pdf">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  PDF
                </button>
              </div>

              <!-- Image Drop Zone -->
              <div id="image-input-section">
                <div class="booklet-drop-zone" id="booklet-image-dropzone">
                  <svg class="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <div class="drop-title">اسحب الصور هنا</div>
                  <div class="drop-sub">JPG • JPEG • PNG • WEBP</div>
                  <button class="drop-btn" id="btn-browse-images">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                    اختر صوراً
                  </button>
                  <input type="file" id="booklet-images-input" accept=".jpg,.jpeg,.png,.webp" multiple />
                </div>

                <!-- Pages thumbnail grid -->
                <div class="pages-thumbnail-section" id="booklet-thumbs-section" style="display:none">
                  <div class="pages-thumbnail-header">
                    <span id="booklet-page-count-label">0 صفحة</span>
                    <button class="btn-clear-pages" id="btn-clear-pages">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>
                      </svg>
                      مسح الكل
                    </button>
                  </div>
                  <div class="pages-thumbnail-grid" id="booklet-thumbnail-grid"></div>
                  <div class="blank-pages-notice" id="booklet-blank-notice" style="display:none">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    تم إضافة <strong class="blank-count">0</strong> صفحة فراغ تلقائياً لإكمال الكتيب
                  </div>
                </div>
              </div>

              <!-- PDF input section -->
              <div id="pdf-input-section" style="display:none">
                <div class="booklet-drop-zone" id="booklet-pdf-dropzone">
                  <svg class="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                  <div class="drop-title">اسحب ملف PDF هنا</div>
                  <div class="drop-sub">سيتم استخراج جميع الصفحات تلقائياً</div>
                  <button class="drop-btn" id="btn-browse-pdf">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                    اختر ملف PDF
                  </button>
                  <input type="file" id="booklet-pdf-input" accept=".pdf" />
                </div>
                <div class="pdf-loaded-indicator" id="booklet-pdf-indicator" style="display:none;margin-top:10px">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <div class="pdf-info">
                    <div class="pdf-name">—</div>
                    <div class="pdf-pages">—</div>
                  </div>
                  <button class="btn-remove-pdf" id="btn-remove-pdf" title="إزالة الملف">✕</button>
                </div>
                <!-- PDF thumbnail grid -->
                <div class="pages-thumbnail-section" id="pdf-thumbs-section" style="display:none;margin-top:10px">
                  <div class="pages-thumbnail-header">
                    <span id="pdf-page-count-label">0 صفحة</span>
                  </div>
                  <div class="pages-thumbnail-grid" id="booklet-thumbnail-grid-pdf"></div>
                  <div class="blank-pages-notice" id="pdf-blank-notice" style="display:none">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    تم إضافة <strong class="blank-count">0</strong> صفحة فراغ تلقائياً
                  </div>
                </div>
              </div>

              <!-- Loading overlay inside panel -->
              <div class="booklet-loading" id="booklet-loading-inner" style="display:none">
                <div class="booklet-spinner"></div>
                <div class="booklet-loading-text" id="booklet-loading-text">جاري المعالجة…</div>
                <div class="booklet-progress-bar-wrap">
                  <div class="booklet-progress-bar" id="booklet-progress-bar"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- BOOK DIRECTION & BINDING -->
          <div class="booklet-settings-card">
            <div class="booklet-settings-header" id="bsh-direction">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 6h16M4 12h16M4 18h7"/>
              </svg>
              <h3>اتجاه الكتاب والتجليد</h3>
              <span class="toggle-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </span>
            </div>
            <div class="booklet-settings-body" id="bsb-direction">
              <div class="direction-toggle-group">
                <button class="direction-btn active" id="btn-dir-rtl">
                  <div class="dir-icon">📖</div>
                  <div class="dir-label">عربي (RTL)</div>
                  <div class="dir-sub">يفتح من اليمين</div>
                </button>
                <button class="direction-btn" id="btn-dir-ltr">
                  <div class="dir-icon">📗</div>
                  <div class="dir-label">إنجليزي (LTR)</div>
                  <div class="dir-sub">يفتح من اليسار</div>
                </button>
              </div>

              <div class="form-group" style="margin-top:12px">
                <label class="form-label" for="booklet-binding-select">طريقة التجليد / التناوب</label>
                <select id="booklet-binding-select" class="form-select">
                  <option value="saddle" selected>خياطة دبوس (Saddle Stitch)</option>
                  <option value="folded">مطوية بالمنتصف (Center Fold / Folded Booklet)</option>
                </select>
              </div>
            </div>
          </div>

          <!-- PAGE SIZE -->
          <div class="booklet-settings-card">
            <div class="booklet-settings-header" id="bsh-size">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
              </svg>
              <h3>حجم الكتاب المفتوح</h3>
              <span class="toggle-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </span>
            </div>
            <div class="booklet-settings-body" id="bsb-size">
              <div class="size-presets-grid">
                <button class="size-preset-btn" data-preset="A5">
                  <span class="preset-name">A5</span>
                  <span class="preset-dims">${formatPresetDims(210, 148)}</span>
                </button>
                <button class="size-preset-btn active" data-preset="A4">
                  <span class="preset-name">A4</span>
                  <span class="preset-dims">${formatPresetDims(297, 210)}</span>
                </button>
                <button class="size-preset-btn" data-preset="A3">
                  <span class="preset-name">A3</span>
                  <span class="preset-dims">${formatPresetDims(420, 297)}</span>
                </button>
                <button class="size-preset-btn" data-preset="A2">
                  <span class="preset-name">A2</span>
                  <span class="preset-dims">${formatPresetDims(594, 420)}</span>
                </button>
              </div>

              <div class="individual-page-info" id="individual-page-info">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span class="page-size-text">حجم الصفحة الواحدة: 148.5 × 210 ملم</span>
              </div>

              <div class="form-group" style="margin-bottom:8px">
                <label class="form-label">مخصص — عرض الكتاب المفتوح (<span class="unit-text">${getActiveUnitLabel()}</span>)</label>
                <input type="number" class="form-input" id="booklet-custom-w" value="${convertMmToActiveUnit(297)}" min="${convertMmToActiveUnit(50)}" max="${convertMmToActiveUnit(1200)}" step="any" />
              </div>
              <div class="form-group">
                <label class="form-label">مخصص — ارتفاع الكتاب المفتوح (<span class="unit-text">${getActiveUnitLabel()}</span>)</label>
                <input type="number" class="form-input" id="booklet-custom-h" value="${convertMmToActiveUnit(210)}" min="${convertMmToActiveUnit(50)}" max="${convertMmToActiveUnit(1200)}" step="any" />
              </div>
            </div>
          </div>

          <!-- MARGINS & GUTTER -->
          <div class="booklet-settings-card">
            <div class="booklet-settings-header" id="bsh-margins">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <rect x="7" y="7" width="10" height="10" rx="1"/>
              </svg>
              <h3>الهوامش والثنية</h3>
              <span class="toggle-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </span>
            </div>
            <div class="booklet-settings-body" id="bsb-margins">
              <div class="margins-inputs-grid">
                <div class="form-group">
                  <label class="form-label">هامش علوي (<span class="unit-text">${getActiveUnitLabel()}</span>)</label>
                  <input type="number" class="form-input" id="margin-top" value="${convertMmToActiveUnit(10)}" min="0" max="${convertMmToActiveUnit(50)}" step="any" />
                </div>
                <div class="form-group">
                  <label class="form-label">هامش سفلي (<span class="unit-text">${getActiveUnitLabel()}</span>)</label>
                  <input type="number" class="form-input" id="margin-bottom" value="${convertMmToActiveUnit(10)}" min="0" max="${convertMmToActiveUnit(50)}" step="any" />
                </div>
                <div class="form-group">
                  <label class="form-label">هامش أيسر (<span class="unit-text">${getActiveUnitLabel()}</span>)</label>
                  <input type="number" class="form-input" id="margin-left" value="${convertMmToActiveUnit(10)}" min="0" max="${convertMmToActiveUnit(50)}" step="any" />
                </div>
                <div class="form-group">
                  <label class="form-label">هامش أيمن (<span class="unit-text">${getActiveUnitLabel()}</span>)</label>
                  <input type="number" class="form-input" id="margin-right" value="${convertMmToActiveUnit(10)}" min="0" max="${convertMmToActiveUnit(50)}" step="any" />
                </div>
              </div>
              
              <div class="form-group" style="margin-top:12px; margin-bottom:12px;">
                <label class="form-label">ثنية الوسط / Gutter (<span class="unit-text">${getActiveUnitLabel()}</span>)</label>
                <input type="number" class="form-input" id="margin-gutter" value="${convertMmToActiveUnit(10)}" min="0" max="${convertMmToActiveUnit(80)}" step="any" />
              </div>

              <div class="toggle-switch-row" style="border-top:1px solid var(--border-color); padding-top:8px;">
                <label for="toggle-fit-margins">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="5" y="5" width="14" height="14" rx="2" stroke-dasharray="3 2"/>
                  </svg>
                  تكييف المحتوى داخل الهوامش
                </label>
                <label class="toggle-switch">
                  <input type="checkbox" id="toggle-fit-margins" />
                  <span class="toggle-track"></span>
                </label>
              </div>

              <p style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;" id="booklet-default-gutter-note">${getDefaultGutterText()}</p>
            </div>
          </div>

          <!-- QUALITY & MARKS -->
          <div class="booklet-settings-card">
            <div class="booklet-settings-header" id="bsh-quality">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
              <h3>الجودة وعلامات الطباعة</h3>
              <span class="toggle-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </span>
            </div>
            <div class="booklet-settings-body" id="bsb-quality">
              <div class="toggle-switch-row">
                <label for="toggle-grayscale">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 2v20M2 12h20" opacity="0.3"/>
                  </svg>
                  تحويل إلى أبيض وأسود (Grayscale)
                </label>
                <label class="toggle-switch">
                  <input type="checkbox" id="toggle-grayscale" />
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div class="toggle-switch-row">
                <label for="toggle-crop-marks">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="3" x2="5" y2="8"/><line x1="3" y1="5" x2="8" y2="5"/>
                    <line x1="19" y1="3" x2="19" y2="8"/><line x1="16" y1="5" x2="21" y2="5"/>
                    <line x1="5" y1="16" x2="5" y2="21"/><line x1="3" y1="19" x2="8" y2="19"/>
                    <line x1="19" y1="16" x2="19" y2="21"/><line x1="16" y1="19" x2="21" y2="19"/>
                  </svg>
                  علامات القص (Crop Marks)
                </label>
                <label class="toggle-switch">
                  <input type="checkbox" id="toggle-crop-marks" />
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div class="toggle-switch-row">
                <label for="toggle-bleed">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="2" width="20" height="20" rx="2" stroke-dasharray="4 2"/>
                  </svg>
                  منطقة Bleed (3 ملم)
                </label>
                <label class="toggle-switch">
                  <input type="checkbox" id="toggle-bleed" />
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div class="toggle-switch-row">
                <label for="toggle-registration">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="2" x2="12" y2="22"/>
                  </svg>
                  علامة المنتصف (Center Marks)
                </label>
                <label class="toggle-switch">
                  <input type="checkbox" id="toggle-registration" />
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div class="toggle-switch-row">
                <label for="toggle-safe-area">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="5" y="5" width="14" height="14" rx="2" stroke-dasharray="3 2"/>
                  </svg>
                  دليل المنطقة الآمنة (Safe Area)
                </label>
                <label class="toggle-switch">
                  <input type="checkbox" id="toggle-safe-area" />
                  <span class="toggle-track"></span>
                </label>
              </div>
            </div>
          </div>

          <!-- PROFESSIONAL PRINT OPTIMIZATION (PREPRESS) -->
          <div class="booklet-settings-card">
            <div class="booklet-settings-header" id="bsh-prepress">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M12 7v10M9 10h6"/>
              </svg>
              <h3>تحسينات الطباعة الاحترافية (Prepress)</h3>
              <span class="toggle-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </span>
            </div>
            <div class="booklet-settings-body" id="bsb-prepress">
              <div class="toggle-switch-row">
                <label for="booklet-opt-pure-black">
                  تحويل النص الأسود إلى أسود خالص (100% K)
                </label>
                <label class="toggle-switch">
                  <input type="checkbox" id="booklet-opt-pure-black" />
                  <span class="toggle-track"></span>
                </label>
              </div>
              <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;margin-bottom:12px;line-height:1.4;">
                موصى به للمجلات، الكتيبات، الكتب، والنصوص الصغيرة لمنع اهتزاز الحبر وظهور هالات ملونة.
              </p>

              <div id="booklet-prepress-subsettings" style="display:none; border-top:1px solid var(--border-color); padding-top:12px; margin-top:12px; display:flex; flex-direction:column; gap:12px;">
                <div class="form-group" style="margin-bottom:8px">
                  <label class="form-label" for="booklet-opt-threshold">عتبة كشف اللون الأسود (RGB)</label>
                  <input type="number" class="form-input" id="booklet-opt-threshold" value="30" min="0" max="255" />
                  <p style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">سيتم تحويل أي لون نصوص قيمته أقل من أو تساوي العتبة (افتراضي: 30).</p>
                </div>

                <div class="toggle-switch-row" style="margin-bottom:8px">
                  <label for="booklet-opt-rich-black">
                    تحويل الأسود الغني (Rich Black) إلى أسود خالص
                  </label>
                  <label class="toggle-switch">
                    <input type="checkbox" id="booklet-opt-rich-black" />
                    <span class="toggle-track"></span>
                  </label>
                </div>

                <div class="toggle-switch-row" style="margin-bottom:8px">
                  <label for="booklet-opt-small-text">
                    تطبيق التحويل على النصوص الصغيرة فقط
                  </label>
                  <label class="toggle-switch">
                    <input type="checkbox" id="booklet-opt-small-text" checked />
                    <span class="toggle-track"></span>
                  </label>
                </div>

                <div class="form-group" id="booklet-opt-small-size-wrapper">
                  <label class="form-label" for="booklet-opt-small-size">الحد الأقصى لحجم النص الصغير (pt)</label>
                  <input type="number" class="form-input" id="booklet-opt-small-size" value="12" min="1" max="72" />
                </div>
              </div>
            </div>
          </div>


        </div>
        <!-- END SETTINGS PANEL -->

        <!-- ===== RIGHT: PREVIEW PANEL ===== -->
        <div class="booklet-preview-panel">

          <!-- Preview card -->
          <div class="booklet-preview-card">
            <div class="booklet-preview-toolbar">
              <div class="booklet-preview-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
                </svg>
                معاينة الكتيب
              </div>
              <div class="booklet-zoom-controls">
                <button class="booklet-zoom-btn" id="btn-booklet-zoom-in" title="تكبير">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
                  </svg>
                </button>
                <span class="booklet-zoom-label" id="booklet-zoom-label">100%</span>
                <button class="booklet-zoom-btn" id="btn-booklet-zoom-out" title="تصغير">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    <line x1="8" y1="11" x2="14" y2="11"/>
                  </svg>
                </button>
                <button class="booklet-zoom-btn" id="btn-booklet-zoom-fit" title="ملاءمة الشاشة">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                  </svg>
                </button>
              </div>
            </div>

            <div class="booklet-canvas-wrapper">
              <canvas id="booklet-preview-canvas"></canvas>
            </div>

            <!-- Sheet navigator -->
            <div class="sheet-navigator">
              <div class="sheet-nav-info" id="booklet-sheet-info">
                لا توجد أوراق — ارفع ملفاً أولاً
              </div>
              <div class="sheet-nav-controls">
                <button class="sheet-nav-btn" id="btn-prev-sheet" title="الورقة السابقة" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
                <span class="sheet-side-label" id="booklet-side-label">وجه (Front)</span>
                <button class="sheet-nav-btn" id="btn-toggle-side" title="تبديل وجه/ظهر">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/>
                    <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
                  </svg>
                </button>
                <button class="sheet-nav-btn" id="btn-next-sheet" title="الورقة التالية" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Imposition table -->
          <div class="imposition-table-card">
            <div class="imposition-table-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="3" y1="15" x2="21" y2="15"/>
                <line x1="12" y1="3" x2="12" y2="21"/>
              </svg>
              جدول التناوب (Imposition)
            </div>
            <table class="imposition-table">
              <thead>
                <tr>
                  <th>الورقة</th>
                  <th>الوجه (Front)</th>
                  <th>الظهر (Back)</th>
                </tr>
              </thead>
              <tbody id="imposition-table-body">
                <tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:16px;">
                  لا توجد بيانات — ارفع صوراً أو ملف PDF أولاً
                </td></tr>
              </tbody>
            </table>
          </div>

        </div>
        <!-- END PREVIEW PANEL -->

      </div>
      <!-- END BOOKLET LAYOUT -->
    `;
  }

  /* ─────────────────────────────────────────────────────
     INIT — EVENT BINDING
  ───────────────────────────────────────────────────── */
  function bindEvents() {
    // Input mode
    document.getElementById('btn-mode-images').addEventListener('click', () => {
      state.inputMode = 'images';
      document.getElementById('btn-mode-images').classList.add('active');
      document.getElementById('btn-mode-pdf').classList.remove('active');
      document.getElementById('image-input-section').style.display = '';
      document.getElementById('pdf-input-section').style.display = 'none';
    });
    document.getElementById('btn-mode-pdf').addEventListener('click', () => {
      state.inputMode = 'pdf';
      document.getElementById('btn-mode-pdf').classList.add('active');
      document.getElementById('btn-mode-images').classList.remove('active');
      document.getElementById('pdf-input-section').style.display = '';
      document.getElementById('image-input-section').style.display = 'none';
    });

    // Image drop zone
    const imgZone = document.getElementById('booklet-image-dropzone');
    document.getElementById('btn-browse-images').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('booklet-images-input').click();
    });
    document.getElementById('booklet-images-input').addEventListener('change', (e) => {
      if (e.target.files.length) handleImageFiles(e.target.files);
    });
    imgZone.addEventListener('dragover', (e) => { e.preventDefault(); imgZone.classList.add('drag-over'); });
    imgZone.addEventListener('dragleave', () => imgZone.classList.remove('drag-over'));
    imgZone.addEventListener('drop', (e) => {
      e.preventDefault();
      imgZone.classList.remove('drag-over');
      handleImageFiles(e.dataTransfer.files);
    });

    // PDF drop zone
    const pdfZone = document.getElementById('booklet-pdf-dropzone');
    document.getElementById('btn-browse-pdf').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('booklet-pdf-input').click();
    });
    document.getElementById('booklet-pdf-input').addEventListener('change', (e) => {
      if (e.target.files[0]) handlePdfFile(e.target.files[0]);
    });
    pdfZone.addEventListener('dragover', (e) => { e.preventDefault(); pdfZone.classList.add('drag-over'); });
    pdfZone.addEventListener('dragleave', () => pdfZone.classList.remove('drag-over'));
    pdfZone.addEventListener('drop', (e) => {
      e.preventDefault();
      pdfZone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f && f.type === 'application/pdf') handlePdfFile(f);
      else showToast('يرجى إسقاط ملف PDF فقط', 'error');
    });

    // Remove PDF
    document.getElementById('btn-remove-pdf').addEventListener('click', () => {
      state.pages = [];
      state.pdfDoc = null;
      document.getElementById('booklet-pdf-indicator').style.display = 'none';
      document.getElementById('pdf-thumbs-section').style.display = 'none';
      document.getElementById('booklet-pdf-input').value = '';
      updateImposition();
    });

    // Clear images
    document.getElementById('btn-clear-pages').addEventListener('click', () => {
      state.pages = [];
      updateImposition();
    });

    // Direction
    document.getElementById('btn-dir-rtl').addEventListener('click', () => {
      state.direction = 'rtl';
      document.getElementById('btn-dir-rtl').classList.add('active');
      document.getElementById('btn-dir-ltr').classList.remove('active');
      updateImposition();
    });
    document.getElementById('btn-dir-ltr').addEventListener('click', () => {
      state.direction = 'ltr';
      document.getElementById('btn-dir-ltr').classList.add('active');
      document.getElementById('btn-dir-rtl').classList.remove('active');
      updateImposition();
    });

    // Size presets
    dom.root.querySelectorAll('.size-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        onSizePreset(btn.dataset.preset);
        // Clear custom preset highlight
        dom.root.querySelectorAll('.size-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderPreview();
      });
    });

    // Custom size
    document.getElementById('booklet-custom-w').addEventListener('change', () => {
      state.openBook.w = convertActiveUnitToMm(parseFloat(document.getElementById('booklet-custom-w').value) || 297);
      state.openBook.preset = 'custom';
      dom.root.querySelectorAll('.size-preset-btn').forEach(b => b.classList.remove('active'));
      updateIndividualPageInfo();
      renderPreview();
    });
    document.getElementById('booklet-custom-h').addEventListener('change', () => {
      state.openBook.h = convertActiveUnitToMm(parseFloat(document.getElementById('booklet-custom-h').value) || 210);
      state.openBook.preset = 'custom';
      dom.root.querySelectorAll('.size-preset-btn').forEach(b => b.classList.remove('active'));
      updateIndividualPageInfo();
      renderPreview();
    });

    // Margins
    ['margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'margin-gutter'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          state.margins.top    = convertActiveUnitToMm(parseFloat(document.getElementById('margin-top').value)    || 0);
          state.margins.bottom = convertActiveUnitToMm(parseFloat(document.getElementById('margin-bottom').value) || 0);
          state.margins.left   = convertActiveUnitToMm(parseFloat(document.getElementById('margin-left').value)   || 0);
          state.margins.right  = convertActiveUnitToMm(parseFloat(document.getElementById('margin-right').value)  || 0);
          state.margins.gutter = convertActiveUnitToMm(parseFloat(document.getElementById('margin-gutter').value) || 0);
          renderPreview();
        });
      }
    });

    // Fit to margins toggle
    document.getElementById('toggle-fit-margins').addEventListener('change', (e) => {
      state.fitToMargins = e.target.checked;
      renderPreview();
    });

    // Binding type select
    document.getElementById('booklet-binding-select').addEventListener('change', (e) => {
      state.binding = e.target.value;
      updateImposition();
    });

    // Toggles
    document.getElementById('toggle-grayscale').addEventListener('change', (e) => {
      state.grayscale = e.target.checked;
      renderPreview();
    });
    document.getElementById('toggle-crop-marks').addEventListener('change', (e) => {
      state.marks.crop = e.target.checked;
      renderPreview();
    });
    document.getElementById('toggle-bleed').addEventListener('change', (e) => {
      state.marks.bleed = e.target.checked;
    });
    document.getElementById('toggle-registration').addEventListener('change', (e) => {
      state.marks.registration = e.target.checked;
    });
    document.getElementById('toggle-safe-area').addEventListener('change', (e) => {
      state.marks.safeArea = e.target.checked;
    });

    // Sheet navigation
    document.getElementById('btn-prev-sheet').addEventListener('click', () => {
      if (state.currentSheet > 0) {
        state.currentSheet--;
        state.showFront = true;
        renderPreview();
      }
    });
    document.getElementById('btn-next-sheet').addEventListener('click', () => {
      if (state.currentSheet < state.imposedSheets.length - 1) {
        state.currentSheet++;
        state.showFront = true;
        renderPreview();
      }
    });
    document.getElementById('btn-toggle-side').addEventListener('click', () => {
      state.showFront = !state.showFront;
      renderPreview();
    });

    // Zoom
    document.getElementById('btn-booklet-zoom-in').addEventListener('click', () => {
      state.zoom = Math.min(3, +(state.zoom + 0.25).toFixed(2));
      document.getElementById('booklet-zoom-label').textContent = Math.round(state.zoom * 100) + '%';
      renderPreview();
    });
    document.getElementById('btn-booklet-zoom-out').addEventListener('click', () => {
      state.zoom = Math.max(0.25, +(state.zoom - 0.25).toFixed(2));
      document.getElementById('booklet-zoom-label').textContent = Math.round(state.zoom * 100) + '%';
      renderPreview();
    });
    document.getElementById('btn-booklet-zoom-fit').addEventListener('click', () => {
      state.zoom = 1.0;
      document.getElementById('booklet-zoom-label').textContent = '100%';
      renderPreview();
    });

    // Prepress controls toggle visibility
    document.getElementById('booklet-opt-pure-black')?.addEventListener('change', (e) => {
      const sub = document.getElementById('booklet-prepress-subsettings');
      if (sub) sub.style.display = e.target.checked ? 'flex' : 'none';
    });

    document.getElementById('booklet-opt-small-text')?.addEventListener('change', (e) => {
      const wrapper = document.getElementById('booklet-opt-small-size-wrapper');
      if (wrapper) wrapper.style.display = e.target.checked ? 'block' : 'none';
    });

    // Export buttons
    document.getElementById('btn-booklet-export-reading').addEventListener('click', exportPrintJpgZip);
    document.getElementById('btn-booklet-export-print').addEventListener('click',   exportPrintPdf);

    // Accordion headers
    ['bsh-input', 'bsh-direction', 'bsh-size', 'bsh-margins', 'bsh-quality', 'bsh-prepress'].forEach(id => {
      const hdr = document.getElementById(id);
      if (hdr) setupAccordion(hdr);
    });
  }

  /* ─────────────────────────────────────────────────────
     FIRESTORE SAVING AND LOADING
  ───────────────────────────────────────────────────── */
  function getSaveData() {
    return {
      pagesCount: state.pages.length,
      direction: state.direction,
      openBook: { ...state.openBook },
      margins: { ...state.margins },
      binding: state.binding,
      fitToMargins: state.fitToMargins,
      grayscale: state.grayscale,
      marks: { ...state.marks },
      prepress: {
        pureBlack: document.getElementById('booklet-opt-pure-black')?.checked || false,
        threshold: parseInt(document.getElementById('booklet-opt-threshold')?.value) || 30,
        richBlack: document.getElementById('booklet-opt-rich-black')?.checked || false,
        onlySmallText: document.getElementById('booklet-opt-small-text')?.checked || false,
        smallSize: parseFloat(document.getElementById('booklet-opt-small-size')?.value) || 12
      },
      pages: state.pages.map(p => ({
        id: p.id,
        name: p.name,
        isBlank: !!p.isBlank,
        pdfPageIndex: p.pdfPageIndex || null,
        imageSrc: p.img ? p.img.src : null
      }))
    };
  }

  async function prepareSavePages(ownerId) {
    if (!state.pages || state.pages.length === 0) return;
    
    const toUpload = state.pages.filter(p => !p.isBlank && p.img && p.img.src && !p.img.src.startsWith('http'));
    if (toUpload.length === 0) return;

    let uploadedCount = 0;
    for (const page of toUpload) {
      try {
        const blob = window.dataURLToBlob(page.img.src);
        const ext = (blob.type || 'image/png').split('/').pop();
        const filename = `${ownerId}_booklet_${page.id}_${Date.now()}.${ext}`;
        const url = await window.uploadToImgBB(blob, filename);
        if (url) {
          page.img.src = url;
          uploadedCount++;
        }
      } catch (err) {
        console.warn(`فشل رفع صفحة الكتيب "${page.name}":`, err);
      }
    }

    if (uploadedCount > 0 && window.AppUI && window.AppUI.showToast) {
      window.AppUI.showToast(`تم رفع ${uploadedCount} صفحة بنجاح ✅`, 'success');
    }
  }

  function loadProjectData(proj) {
    if (!proj) return;
    const d = (proj.data && proj.data.booklet) ? proj.data.booklet : (proj.booklet || proj.data || proj);
    
    if (d.direction) {
      state.direction = d.direction;
      const rtlBtn = document.getElementById('btn-dir-rtl');
      const ltrBtn = document.getElementById('btn-dir-ltr');
      if (rtlBtn && ltrBtn) {
        if (state.direction === 'rtl') {
          rtlBtn.classList.add('active');
          ltrBtn.classList.remove('active');
        } else {
          ltrBtn.classList.add('active');
          rtlBtn.classList.remove('active');
        }
      }
    }
    if (d.openBook) {
      state.openBook = { ...d.openBook };
      if (dom.customW) dom.customW.value = convertMmToActiveUnit(state.openBook.w);
      if (dom.customH) dom.customH.value = convertMmToActiveUnit(state.openBook.h);
      updateSizePresetButtons(state.openBook.preset);
    }
    if (d.margins) {
      state.margins = { ...d.margins };
      if (document.getElementById('margin-top')) document.getElementById('margin-top').value = convertMmToActiveUnit(state.margins.top);
      if (document.getElementById('margin-bottom')) document.getElementById('margin-bottom').value = convertMmToActiveUnit(state.margins.bottom);
      if (document.getElementById('margin-left')) document.getElementById('margin-left').value = convertMmToActiveUnit(state.margins.left);
      if (document.getElementById('margin-right')) document.getElementById('margin-right').value = convertMmToActiveUnit(state.margins.right);
      if (document.getElementById('margin-gutter')) document.getElementById('margin-gutter').value = convertMmToActiveUnit(state.margins.gutter);
    }
    if (d.binding) {
      state.binding = d.binding;
      const bindSel = document.getElementById('booklet-binding-select');
      if (bindSel) bindSel.value = state.binding;
    }
    if (d.grayscale !== undefined) {
      state.grayscale = d.grayscale;
      const grayChk = document.getElementById('toggle-grayscale');
      if (grayChk) grayChk.checked = state.grayscale;
    }
    if (d.fitToMargins !== undefined) {
      state.fitToMargins = d.fitToMargins;
      const fitChk = document.getElementById('toggle-fit-margins');
      if (fitChk) fitChk.checked = state.fitToMargins;
    }
    if (d.marks) {
      state.marks = { ...d.marks };
      if (document.getElementById('toggle-crop-marks')) document.getElementById('toggle-crop-marks').checked = !!state.marks.crop;
      if (document.getElementById('toggle-bleed')) document.getElementById('toggle-bleed').checked = !!state.marks.bleed;
      if (document.getElementById('toggle-registration')) document.getElementById('toggle-registration').checked = !!state.marks.registration;
      if (document.getElementById('toggle-safe-area')) document.getElementById('toggle-safe-area').checked = !!state.marks.safeArea;
    }
    if (d.prepress) {
      if (document.getElementById('booklet-opt-pure-black')) {
        document.getElementById('booklet-opt-pure-black').checked = !!d.prepress.pureBlack;
        const sub = document.getElementById('booklet-prepress-subsettings');
        if (sub) sub.style.display = d.prepress.pureBlack ? 'flex' : 'none';
      }
      if (document.getElementById('booklet-opt-threshold')) {
        document.getElementById('booklet-opt-threshold').value = d.prepress.threshold !== undefined ? d.prepress.threshold : 30;
      }
      if (document.getElementById('booklet-opt-rich-black')) {
        document.getElementById('booklet-opt-rich-black').checked = !!d.prepress.richBlack;
      }
      if (document.getElementById('booklet-opt-small-text')) {
        document.getElementById('booklet-opt-small-text').checked = !!d.prepress.onlySmallText;
        const wrapper = document.getElementById('booklet-opt-small-size-wrapper');
        if (wrapper) wrapper.style.display = d.prepress.onlySmallText ? 'block' : 'none';
      }
      if (document.getElementById('booklet-opt-small-size')) {
        document.getElementById('booklet-opt-small-size').value = d.prepress.smallSize !== undefined ? d.prepress.smallSize : 12;
      }
    }

    state.pages = []; // Reset pages since image/pdf files are local
    state.pdfDoc = null;
    if (dom.pdfIndicator) dom.pdfIndicator.style.display = 'none';
    const isImages = state.inputMode === 'images';
    const gridEl = isImages
      ? document.getElementById('booklet-thumbnail-grid')
      : document.getElementById('booklet-thumbnail-grid-pdf');
    if (gridEl) gridEl.innerHTML = '';
    const sectionEl = isImages
      ? document.getElementById('booklet-thumbs-section')
      : document.getElementById('pdf-thumbs-section');
    if (sectionEl) sectionEl.style.display = 'none';

    updateBookletUnitUI();

    if (d.pages && d.pages.length > 0) {
      if (window.AppUI && window.AppUI.showToast) {
        window.AppUI.showToast('جاري استعادة صفحات الكتيب من السحابة...', 'info');
      }

      const loadPromises = d.pages.map(p => {
        if (p.isBlank || !p.imageSrc) {
          return Promise.resolve({
            id: p.id || uid(),
            img: null,
            name: p.name || 'blank',
            isBlank: true,
            pdfPageIndex: p.pdfPageIndex || null
          });
        }

        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            resolve({
              id: p.id || uid(),
              img: img,
              name: p.name || 'صفحة مستردة',
              isBlank: false,
              pdfPageIndex: p.pdfPageIndex || null
            });
          };
          img.onerror = () => {
            console.warn(`فشل تحميل صورة الصفحة ${p.name || p.id}`);
            resolve({
              id: p.id || uid(),
              img: null,
              name: p.name || 'فشل التحميل',
              isBlank: true,
              pdfPageIndex: p.pdfPageIndex || null
            });
          };
          img.src = p.imageSrc;
        });
      });

      Promise.all(loadPromises).then(loadedPages => {
        state.pages = loadedPages;
        updateImposition();
        if (window.AppUI && window.AppUI.showToast) {
          window.AppUI.showToast('تم استعادة صفحات الكتيب بنجاح! ✅', 'success');
        }
      });
    } else {
      updateImposition();
      showToast('تم تحميل إعدادات الكتيب. يرجى إضافة صفحات للمشروع.', 'info');
    }
  }

  /* ─────────────────────────────────────────────────────
     PUBLIC INIT
  ───────────────────────────────────────────────────── */
  function init() {
    const tabPanel = document.getElementById('tab-booklet');
    if (!tabPanel) return;

    dom.root = tabPanel;
    buildUI(tabPanel);

    // Resolve DOM refs
    dom.previewCanvas       = document.getElementById('booklet-preview-canvas');
    dom.impositionTableBody = document.getElementById('imposition-table-body');
    dom.pageSummaryLabel    = document.getElementById('booklet-page-summary');
    dom.exportBar           = document.getElementById('booklet-export-bar');
    dom.loadingOverlay      = document.getElementById('booklet-loading-inner');
    dom.loadingText         = document.getElementById('booklet-loading-text');
    dom.progressBar         = document.getElementById('booklet-progress-bar');
    dom.sheetInfo           = document.getElementById('booklet-sheet-info');
    dom.sideLabel           = document.getElementById('booklet-side-label');
    dom.btnPrevSheet        = document.getElementById('btn-prev-sheet');
    dom.btnNextSheet        = document.getElementById('btn-next-sheet');
    dom.individualPageInfo  = document.getElementById('individual-page-info');
    dom.pdfIndicator        = document.getElementById('booklet-pdf-indicator');
    dom.customW             = document.getElementById('booklet-custom-w');
    dom.customH             = document.getElementById('booklet-custom-h');

    bindEvents();
    updateIndividualPageInfo();
    renderPreview();    // draw empty state canvas
    renderImpositionTable();
  }

  /* ─────────────────────────────────────────────────────
     HOOK INTO EXISTING TAB SYSTEM (app.js)
  ───────────────────────────────────────────────────── */
  function hookTabSystem() {
    // When the booklet tab becomes active, re-render preview in case panel was resized
    document.addEventListener('tabChanged', (e) => {
      if (e.detail?.tab === 'booklet') {
        setTimeout(renderPreview, 50);
      }
    });
  }

  /* ─────────────────────────────────────────────────────
     EXPOSE
  ───────────────────────────────────────────────────── */
  return { init, hookTabSystem, getSaveData, loadProjectData, updateBookletUnitUI, prepareSavePages };

})();

/* ─────────────────────────────────────────────────────
   AUTO-INIT when DOM is ready
───────────────────────────────────────────────────── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.BookletCreator.init();
    window.BookletCreator.hookTabSystem();
  });
} else {
  window.BookletCreator.init();
  window.BookletCreator.hookTabSystem();
}
