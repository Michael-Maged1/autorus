/**
 * اوتو رص - محرك الرص الاحترافي
 * Auto Rass - Professional Nesting Engine
 *
 * خوارزميات:
 * - Simple Grid (الشبكة البسيطة - أفضل لمنتج واحد)
 * - MaxRects (أفضل للمنتجات المختلطة)
 * - Guillotine Cutting
 * - Shelf Algorithm
 */

'use strict';

const PackingEngine = (() => {

  // ========================
  // هياكل البيانات
  // ========================

  class Rect {
    constructor(x, y, w, h) {
      this.x = x; this.y = y; this.w = w; this.h = h;
    }
    get right()  { return this.x + this.w; }
    get bottom() { return this.y + this.h; }
    get area()   { return this.w * this.h; }
    clone()      { return new Rect(this.x, this.y, this.w, this.h); }
  }

  class PackedItem {
    constructor(item, x, y, w, h, rotated = false) {
      this.item    = item;      // المنتج الأصلي
      this.x       = x;
      this.y       = y;
      this.w       = w;         // عرض الـ slot (يشمل bleed+gutter)
      this.h       = h;         // ارتفاع الـ slot
      this.rotated = rotated;
      // أبعاد التصميم الفعلية للرسم
      this.origW   = item.origW || item.w;
      this.origH   = item.origH || item.h;
      this.bleed   = item.bleed || 0;
    }
    get rect() { return new Rect(this.x, this.y, this.w, this.h); }
  }

  // ========================
  // دوال مساعدة
  // ========================

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sortByArea(items)      { return [...items].sort((a, b) => (b.w * b.h) - (a.w * a.h)); }
  function sortByHeight(items)    { return [...items].sort((a, b) => b.h - a.h); }
  function sortByWidth(items)     { return [...items].sort((a, b) => b.w - a.w); }
  function sortByPerimeter(items) { return [...items].sort((a, b) => (b.w + b.h) - (a.w + a.h)); }

  // ========================
  // ① Simple Grid Algorithm
  // أفضل خوارزمية لمنتج واحد أو منتجات بنفس المقاس
  // ========================

  function gridPack(binW, binH, items) {
    if (items.length === 0) return [];

    // نأخذ المنتج الأول كأساس للشبكة
    const ref = items[0];
    const iw  = ref.w;
    const ih  = ref.h;

    // تجربة الاتجاه الأصلي
    const cols1 = Math.floor(binW / iw);
    const rows1 = Math.floor(binH / ih);
    const fit1  = cols1 * rows1;

    // تجربة التدوير 90°
    let cols2 = 0, rows2 = 0, fit2 = 0;
    if (ref.canRotate && Math.abs(iw - ih) > 0.001) {
      cols2 = Math.floor(binW / ih);
      rows2 = Math.floor(binH / iw);
      fit2  = cols2 * rows2;
    }

    // اختيار الأفضل
    const useRotated = fit2 > fit1;
    const cols   = useRotated ? cols2 : cols1;
    const rows   = useRotated ? rows2 : rows1;
    const cellW  = useRotated ? ih : iw;
    const cellH  = useRotated ? iw : ih;
    const rotated = useRotated;

    const placed = [];
    let itemIdx = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (itemIdx >= items.length) break;
        const item = items[itemIdx % items.length]; // تكرار
        placed.push(new PackedItem(
          item,
          c * cellW,
          r * cellH,
          cellW,
          cellH,
          rotated
        ));
        itemIdx++;
      }
    }

    return placed;
  }

  // ========================
  // ② Guillotine Algorithm
  // ========================

  function guillotinePack(binW, binH, items) {
    const placed    = [];
    let freeRects   = [new Rect(0, 0, binW, binH)];

    for (const item of items) {
      let bestScore  = Infinity;
      let bestFit    = null;
      let bestRect   = null;
      let bestRotated = false;

      const orientations = item.canRotate
        ? [[item.w, item.h, false], [item.h, item.w, true]]
        : [[item.w, item.h, false]];

      for (const freeRect of freeRects) {
        for (const [iw, ih, rot] of orientations) {
          if (iw <= freeRect.w && ih <= freeRect.h) {
            const shortside = Math.min(freeRect.w - iw, freeRect.h - ih);
            if (shortside < bestScore) {
              bestScore   = shortside;
              bestFit     = freeRect;
              bestRect    = { iw, ih };
              bestRotated = rot;
            }
          }
        }
      }

      if (!bestFit) continue;

      placed.push(new PackedItem(item, bestFit.x, bestFit.y, bestRect.iw, bestRect.ih, bestRotated));

      const newRects = splitGuillotine(bestFit, bestRect.iw, bestRect.ih);
      freeRects = freeRects.filter(r => r !== bestFit);
      freeRects.push(...newRects);
      freeRects = pruneRects(freeRects);
    }

    return placed;
  }

  function splitGuillotine(freeRect, usedW, usedH) {
    const results = [];
    const rightW  = freeRect.w - usedW;
    const topH    = freeRect.h - usedH;

    if (rightW > topH) {
      if (rightW > 0) results.push(new Rect(freeRect.x + usedW, freeRect.y, rightW, freeRect.h));
      if (topH   > 0) results.push(new Rect(freeRect.x, freeRect.y + usedH, usedW, topH));
    } else {
      if (topH   > 0) results.push(new Rect(freeRect.x, freeRect.y + usedH, freeRect.w, topH));
      if (rightW > 0) results.push(new Rect(freeRect.x + usedW, freeRect.y, rightW, usedH));
    }
    return results;
  }

  function pruneRects(rects) {
    const result = [];
    for (let i = 0; i < rects.length; i++) {
      let dominated = false;
      for (let j = 0; j < rects.length; j++) {
        if (i === j) continue;
        const a = rects[i], b = rects[j];
        if (b.x <= a.x && b.y <= a.y && b.right >= a.right && b.bottom >= a.bottom) {
          dominated = true;
          break;
        }
      }
      if (!dominated) result.push(rects[i]);
    }
    return result;
  }

  // ========================
  // ③ MaxRects Algorithm
  // ========================

  function maxRectsPack(binW, binH, items) {
    const placed    = [];
    let freeRects   = [new Rect(0, 0, binW, binH)];

    for (const item of items) {
      let bestScore  = Infinity;
      let bestFit    = null;
      let bestFreeIdx = -1;
      let bestRotated = false;
      let bestIW = item.w, bestIH = item.h;

      const orientations = item.canRotate
        ? [[item.w, item.h, false], [item.h, item.w, true]]
        : [[item.w, item.h, false]];

      for (let ri = 0; ri < freeRects.length; ri++) {
        const freeRect = freeRects[ri];
        for (const [iw, ih, rot] of orientations) {
          if (iw <= freeRect.w && ih <= freeRect.h) {
            const areaFit  = freeRect.area - iw * ih;
            const shortside = Math.min(freeRect.w - iw, freeRect.h - ih);
            const score    = areaFit * 10000 + shortside;
            if (score < bestScore) {
              bestScore   = score;
              bestFit     = freeRect;
              bestFreeIdx = ri;
              bestRotated = rot;
              bestIW = iw; bestIH = ih;
            }
          }
        }
      }

      if (!bestFit) continue;

      placed.push(new PackedItem(item, bestFit.x, bestFit.y, bestIW, bestIH, bestRotated));

      const usedRect    = new Rect(bestFit.x, bestFit.y, bestIW, bestIH);
      const newFreeRects = [];

      for (const fr of freeRects) {
        if (rectOverlaps(usedRect, fr)) {
          newFreeRects.push(...splitFreeRect(fr, usedRect));
        } else {
          newFreeRects.push(fr);
        }
      }

      freeRects = pruneMaxRects(newFreeRects);
    }

    return placed;
  }

  function rectOverlaps(a, b) {
    return !(b.right <= a.x || b.x >= a.right || b.bottom <= a.y || b.y >= a.bottom);
  }

  function splitFreeRect(freeRect, usedRect) {
    const splits = [];
    if (usedRect.x > freeRect.x && usedRect.x < freeRect.right) {
      const r = new Rect(freeRect.x, freeRect.y, usedRect.x - freeRect.x, freeRect.h);
      if (r.w > 0 && r.h > 0) splits.push(r);
    }
    if (usedRect.right < freeRect.right && usedRect.right > freeRect.x) {
      const r = new Rect(usedRect.right, freeRect.y, freeRect.right - usedRect.right, freeRect.h);
      if (r.w > 0 && r.h > 0) splits.push(r);
    }
    if (usedRect.y > freeRect.y && usedRect.y < freeRect.bottom) {
      const r = new Rect(freeRect.x, freeRect.y, freeRect.w, usedRect.y - freeRect.y);
      if (r.w > 0 && r.h > 0) splits.push(r);
    }
    if (usedRect.bottom < freeRect.bottom && usedRect.bottom > freeRect.y) {
      const r = new Rect(freeRect.x, usedRect.bottom, freeRect.w, freeRect.bottom - usedRect.bottom);
      if (r.w > 0 && r.h > 0) splits.push(r);
    }
    return splits;
  }

  function pruneMaxRects(rects) {
    const result = [];
    for (let i = 0; i < rects.length; i++) {
      let dominated = false;
      for (let j = 0; j < rects.length; j++) {
        if (i === j) continue;
        const a = rects[i], b = rects[j];
        if (b.x <= a.x && b.y <= a.y && b.right >= a.right && b.bottom >= a.bottom) {
          dominated = true;
          break;
        }
      }
      if (!dominated && rects[i].w > 0.001 && rects[i].h > 0.001) result.push(rects[i]);
    }
    return result;
  }

  // ========================
  // ④ Shelf Algorithm
  // ========================

  function shelfPack(binW, binH, items) {
    const placed  = [];
    const shelves = [{ x: 0, y: 0, h: 0, remW: binW }];

    for (const item of items) {
      let bestShelf = null, bestScore = Infinity;
      let bestIW = item.w, bestIH = item.h, bestRot = false;

      const orientations = item.canRotate
        ? [[item.w, item.h, false], [item.h, item.w, true]]
        : [[item.w, item.h, false]];

      for (const shelf of shelves) {
        for (const [iw, ih, rot] of orientations) {
          if (iw <= shelf.remW && (shelf.h === 0 || ih <= shelf.h + 5)) {
            const score = Math.abs(ih - (shelf.h || ih));
            if (score < bestScore) {
              bestScore = score;
              bestShelf = shelf;
              bestIW = iw; bestIH = ih; bestRot = rot;
            }
          }
        }
      }

      if (!bestShelf) {
        const lastShelf = shelves[shelves.length - 1];
        const newY = lastShelf.y + lastShelf.h;
        if (newY + Math.min(item.w, item.h) > binH) continue;
        const orient = (item.canRotate && item.h < item.w)
          ? [item.h, item.w, true]
          : [item.w, item.h, false];
        const [iw, ih, rot] = orient;
        if (newY + ih > binH || iw > binW) continue;
        const newShelf = { x: 0, y: newY, h: ih, remW: binW };
        shelves.push(newShelf);
        placed.push(new PackedItem(item, newShelf.x, newShelf.y, iw, ih, rot));
        newShelf.x += iw;
        newShelf.remW -= iw;
        newShelf.h = Math.max(newShelf.h, ih);
        continue;
      }

      placed.push(new PackedItem(item, bestShelf.x, bestShelf.y, bestIW, bestIH, bestRot));
      bestShelf.x += bestIW;
      bestShelf.remW -= bestIW;
      bestShelf.h = Math.max(bestShelf.h, bestIH);
    }

    return placed;
  }

  // ========================
  // حساب خطوط القص
  // ========================

  function calculateCutOrder(packedItems, paperW, paperH, unit = 'سم') {
    if (packedItems.length === 0) return [];

    const xPositions = [...new Set(packedItems.map(p => Math.round(p.x * 1000) / 1000))].sort((a, b) => a - b);
    const yPositions = [...new Set(packedItems.map(p => Math.round(p.y * 1000) / 1000))].sort((a, b) => a - b);

    const steps = [];

    let prevY = 0;
    for (const y of yPositions) {
      if (y > prevY + 0.001) {
        steps.push({ type: 'horizontal', position: y, label: `قطع أفقي عند ${y.toFixed(1)} ${unit}`, dir: 'H' });
      }
      prevY = y;
    }

    let prevX = 0;
    for (const x of xPositions) {
      if (x > prevX + 0.001) {
        steps.push({ type: 'vertical', position: x, label: `قطع رأسي عند ${x.toFixed(1)} ${unit}`, dir: 'V' });
      }
      prevX = x;
    }

    return steps;
  }

  // ========================
  // الدالة الرئيسية للرص على فرخة واحدة
  // ========================

  async function pack(config, items) {
    const {
      paperW, paperH,
      bleed       = 0,
      gutter      = 0,
      safeMargin  = 0,
      paperMargin = 0,
      algorithm   = 'auto',
      iterations  = 500,
      unit        = 'سم'
    } = config;

    const margin  = paperMargin;
    const usableW = paperW - 2 * margin;
    const usableH = paperH - 2 * margin;

    if (usableW <= 0 || usableH <= 0) {
      return { error: 'الهوامش أكبر من حجم الورقة' };
    }

    // تجهيز العناصر مع Bleed و Gutter
    const preparedItems = [];
    for (const item of items) {
      const itemBleed = (item.bleedOverride != null) ? item.bleedOverride : bleed;
      // حجم الـ slot الكامل لكل عنصر (يشمل bleed على الجانبين + gutter)
      const slotW = item.w + 2 * itemBleed + gutter;
      const slotH = item.h + 2 * itemBleed + gutter;

      // إذا كان المنتج أكبر من المساحة المتاحة
      const fitsNormal  = slotW <= usableW && slotH <= usableH;
      const fitsRotated = item.canRotate !== false && slotH <= usableW && slotW <= usableH;
      if (!fitsNormal && !fitsRotated) continue;

      preparedItems.push({
        ...item,
        origW:  item.w,          // العرض الأصلي للتصميم
        origH:  item.h,          // الارتفاع الأصلي للتصميم
        w:      slotW,           // عرض الـ slot
        h:      slotH,           // ارتفاع الـ slot
        bleed:  itemBleed,
        gutter: gutter,
        canRotate: item.canRotate !== false,
      });
    }

    if (preparedItems.length === 0) {
      return { error: 'المنتجات أكبر من الورقة' };
    }

    // تحديد الخوارزميات المستخدمة (استبعاد MaxRects إذا كان نمط القص المستقيم مفعلاً)
    let algos = [];
    if (algorithm === 'auto') {
      if (config.guillotineMode) {
        algos = ['grid', 'guillotine', 'shelf'];
      } else {
        algos = ['grid', 'maxrects', 'guillotine', 'shelf'];
      }
    } else {
      algos = (algorithm === 'grid' ? ['grid'] : [algorithm, 'grid']);
    }

    const sortMethods = [
      sortByArea, sortByHeight, sortByWidth, sortByPerimeter,
      arr => [...arr].reverse(),
      arr => shuffle(arr)
    ];

    let bestResult    = null;
    let bestEfficiency = -1;

    const maxIter = Math.min(iterations, 2000);

    for (const algo of algos) {
      if (algo === 'grid') {
        // Grid لا يحتاج تكرار، نجربه مرة واحدة
        const packed = gridPack(usableW, usableH, preparedItems);
        if (packed.length > 0) {
          const totalArea = packed.reduce((sum, p) => sum + p.w * p.h, 0);
          const eff = totalArea / (usableW * usableH);
          if (eff > bestEfficiency) {
            bestEfficiency = eff;
            bestResult = { packed, algo: 'grid' };
          }
        }
        continue;
      }

      const itersPerAlgo = Math.ceil(maxIter / (algos.filter(a => a !== 'grid').length * sortMethods.length));

      for (const sortFn of sortMethods) {
        for (let iter = 0; iter < itersPerAlgo; iter++) {
          // Yield to event loop periodically to keep UI alive
          if (iter % 100 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }

          let sortedItems = sortFn(preparedItems);
          if (iter > 0) sortedItems = shufflePartial(sortedItems, iter);

          let packed;
          switch (algo) {
            case 'guillotine': packed = guillotinePack(usableW, usableH, sortedItems); break;
            case 'shelf':      packed = shelfPack(usableW, usableH, sortedItems);      break;
            case 'maxrects':
            default:           packed = maxRectsPack(usableW, usableH, sortedItems);   break;
          }

          const totalArea = packed.reduce((sum, p) => sum + p.w * p.h, 0);
          const eff = totalArea / (usableW * usableH);

          if (eff > bestEfficiency) {
            bestEfficiency = eff;
            bestResult = { packed, algo };
          }

          if (bestEfficiency >= 0.9999) break;
        }
        if (bestEfficiency >= 0.9999) break;
      }
      if (bestEfficiency >= 0.9999) break;
    }

    if (!bestResult || bestResult.packed.length === 0) {
      return { error: 'تعذر رص أي عنصر في الورقة' };
    }

    const { packed } = bestResult;

    // إضافة هامش الورقة لكل موضع
    const adjustedPacked = packed.map(p => new PackedItem(
      p.item,
      p.x + margin,
      p.y + margin,
      p.w,
      p.h,
      p.rotated
    ));

    // حساب الإحصائيات
    // المساحة المستخدمة = مجموع مساحات التصاميم الأصلية فقط (بدون gutter)
    const usedArea   = adjustedPacked.reduce((sum, p) => {
      const ow = p.rotated ? (p.item.origH || p.item.w) : (p.item.origW || p.item.w);
      const oh = p.rotated ? (p.item.origW || p.item.h) : (p.item.origH || p.item.h);
      return sum + ow * oh;
    }, 0);
    const paperArea   = paperW * paperH;
    const efficiencyPct = (usedArea / paperArea) * 100;
    const wastePct      = 100 - efficiencyPct;

    const cutOrder = calculateCutOrder(adjustedPacked, paperW, paperH, unit);

    return {
      packed:    adjustedPacked,
      paperW,
      paperH,
      usableW,
      usableH,
      margin,
      bleed,
      gutter,
      efficiency: efficiencyPct,
      waste:      wastePct,
      itemCount:  adjustedPacked.length,
      algorithm:  bestResult.algo,
      cutOrder,
      unit
    };
  }

  function shufflePartial(arr, seed) {
    const a = [...arr];
    const n = Math.max(1, Math.floor(a.length * 0.3));
    for (let i = 0; i < n; i++) {
      const j = (i + seed * 7) % a.length;
      const k = (i * seed + 3) % a.length;
      if (j !== k) [a[j], a[k]] = [a[k], a[j]];
    }
    return a;
  }

  // ========================
  // رص لكمية معينة (متعدد الأوراق)
  // ========================

  async function packQuantity(config, items) {
    const {
      paperW, paperH,
      bleed       = 0,
      gutter      = 0,
      paperMargin = 0,
      autoRepeat  = true
    } = config;

    const margin  = paperMargin;
    const usableW = paperW - 2 * margin;
    const usableH = paperH - 2 * margin;

    if (usableW <= 0 || usableH <= 0) {
      return { error: 'الهوامش أكبر من حجم الورقة' };
    }

    // 1. حساب أبعاد الـ slot والحد الأقصى لكل منتج على فرخة واحدة
    const itemsWithSlots = items.map(item => {
      const itemBleed = (item.bleedOverride != null) ? item.bleedOverride : bleed;
      const slotW = item.w + 2 * itemBleed + gutter;
      const slotH = item.h + 2 * itemBleed + gutter;

      const cols1 = Math.floor(usableW / slotW);
      const rows1 = Math.floor(usableH / slotH);
      const cols2 = (item.canRotate !== false) ? Math.floor(usableW / slotH) : 0;
      const rows2 = (item.canRotate !== false) ? Math.floor(usableH / slotW) : 0;
      const baseFit = Math.max(cols1 * rows1, cols2 * rows2, 1);
      const maxFit = (item.canRotate !== false) ? Math.ceil(baseFit * 1.5) + 6 : baseFit;

      return {
        ...item,
        slotW,
        slotH,
        maxFit
      };
    });

    // 2. تمديد قائمة القطع الإجمالية المطلوب رصها بناءً على الكميات
    let remainingPieces = [];
    for (const item of itemsWithSlots) {
      const qty = item.qty || 1;
      for (let q = 0; q < qty; q++) {
        remainingPieces.push({ ...item });
      }
    }

    if (remainingPieces.length === 0) {
      return { error: 'المنتجات أكبر من الورقة' };
    }

    const pages = [];

    // 3. رص القطع في أوراق متتالية حتى تنتهي جميع القطع المطلوبة
    while (remainingPieces.length > 0) {
      let currentPageItems = [...remainingPieces];

      // إذا كان التكرار مفعلاً، نكرر القطع المتبقية لملء الفراغ على الفرخة
      if (autoRepeat !== false) {
        const uniqueRemaining = [];
        const seen = new Set();
        for (const p of remainingPieces) {
          if (!seen.has(p.id)) {
            seen.add(p.id);
            uniqueRemaining.push(p);
          }
        }

        const totalCapacityNeeded = uniqueRemaining.reduce((sum, p) => sum + p.maxFit, 0);

        let idx = 0;
        while (currentPageItems.length < totalCapacityNeeded && uniqueRemaining.length > 0) {
          currentPageItems.push({ ...uniqueRemaining[idx % uniqueRemaining.length] });
          idx++;
        }
      }

      const pageResult = await pack(config, currentPageItems);

      // Yield control to prevent page freeze between page generations
      await new Promise(resolve => setTimeout(resolve, 0));

      if (pageResult.error || !pageResult.packed || pageResult.packed.length === 0) {
        // لتفادي الدخول في حلقة لا نهائية إذا كان أحد العناصر كبيراً جداً ولا يمكن رصه
        break;
      }

      // إزالة العناصر التي تم رصها بنجاح من القائمة المتبقية
      const packedCounts = {};
      for (const pi of pageResult.packed) {
        const id = pi.item.id;
        packedCounts[id] = (packedCounts[id] || 0) + 1;
      }

      const nextRemaining = [];
      const tempCount = { ...packedCounts };
      for (const piece of remainingPieces) {
        const id = piece.id;
        if (tempCount[id] > 0) {
          tempCount[id]--;
        } else {
          nextRemaining.push(piece);
        }
      }
      remainingPieces = nextRemaining;

      pages.push(pageResult);
    }

    if (pages.length === 0) {
      return { error: 'تعذر رص أي عنصر في الورقة' };
    }

    // حساب متوسط الكفاءة والهالك الإجمالي
    const totalEfficiency = pages.reduce((sum, p) => sum + p.efficiency, 0) / pages.length;
    const totalWaste = pages.reduce((sum, p) => sum + p.waste, 0) / pages.length;

    return {
      ...pages[0], // إرجاع كفاءة ومحتوى الصفحة الأولى كافتراضي
      sheetsNeeded: pages.length,
      efficiency: totalEfficiency,
      waste: totalWaste,
      itemCount: pages[0].itemCount, // عدد العناصر بالصفحة الأولى
      pages: pages,
      unit: config.unit || 'سم'
    };
  }

  // ========================
  // مقارنة أحجام الورق
  // ========================

  async function comparePaperSizes(config, items) {
    const activeUnit = config.unit || 'cm';
    // المقاسات دائماً بالسم
    const sizes = [
      { name: 'تمن فرخ',   w: 25,   h: 35   },
      { name: 'ربع فرخ',   w: 50,   h: 35   },
      { name: 'نصف فرخ',   w: 50,   h: 70   },
      { name: 'فرخ كامل',  w: 100,  h: 70   },
      { name: 'A4',         w: 21,   h: 29.7 },
      { name: 'A3',         w: 29.7, h: 42   },
      { name: 'A2',         w: 42,   h: 59.4 },
    ];

    // تحويل المقاسات إلى وحدة المستخدم
    let factor = 1;
    if (activeUnit === 'mm')   factor = 10;
    else if (activeUnit === 'inch') factor = 1 / 2.54;

    const results = [];
    for (const s of sizes) {
      const size = { name: s.name, w: s.w * factor, h: s.h * factor };
      const result = await packQuantity({ ...config, paperW: size.w, paperH: size.h }, items);
      
      // Yield control between paper size packing tests
      await new Promise(resolve => setTimeout(resolve, 0));

      if (!result.error) {
        results.push({
          ...size,
          efficiency:    result.efficiency,
          waste:         result.waste,
          itemCount:     result.itemCount,
          sheetsNeeded:  result.sheetsNeeded,
          piecesPerSheet: result.piecesPerSheet
        });
      }
    }

    results.sort((a, b) => b.efficiency - a.efficiency);
    if (results.length > 0) results[0].best = true;
    return results;
  }

  // ========================
  // API
  // ========================

  return {
    pack,
    packQuantity,
    comparePaperSizes,
    gridPack,
    guillotinePack,
    maxRectsPack,
    shelfPack,
    Rect,
    PackedItem
  };

})();

window.PackingEngine = PackingEngine;
