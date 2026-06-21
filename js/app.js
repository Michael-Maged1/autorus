/**
 * اوتو رص - التطبيق الرئيسي
 * Auto Rass - Main Application
 *
 * يربط جميع الأجزاء معاً ويدير واجهة المستخدم
 */

'use strict';

// ========================
// البيانات العامة
// ========================

let products = [];
let nextProductId = 1;
let currentResult = null;
let currentComparisonResults = null;
let editingProductId = null;
let currentProjectId = null;

// ألوان المنتجات المقترحة
const PRODUCT_COLORS = [
  '#4A90D9', '#7B68EE', '#50C878', '#FF6B6B',
  '#FFA500', '#00CED1', '#FF69B4', '#9C27B0',
  '#009688', '#FF5722', '#607D8B', '#E91E63'
];

// منتجات جاهزة
const PRESET_PRODUCTS = [
  { name: 'كرت شخصي قياسي', w: 9.0, h: 5.5, icon: '💼', color: '#4A90D9' },
  { name: 'كرت شخصي مربع', w: 8.5, h: 8.5, icon: '💼', color: '#7B68EE' },
  { name: 'فلاير A5', w: 14.8, h: 21.0, icon: '📄', color: '#50C878' },
  { name: 'فلاير A6', w: 10.5, h: 14.8, icon: '📄', color: '#FF6B6B' },
  { name: 'بروشور A4', w: 21.0, h: 29.7, icon: '📋', color: '#FFA500' },
  { name: 'بروشور ثلثي', w: 9.9, h: 21.0, icon: '📋', color: '#00CED1' },
  { name: 'ستيكر دائري 5سم', w: 5.0, h: 5.0, icon: '🏷️', color: '#FF69B4' },
  { name: 'ستيكر مستطيل', w: 10.0, h: 6.0, icon: '🏷️', color: '#9C27B0' },
  { name: 'بطاقة تهنئة', w: 15.0, h: 10.0, icon: '🎉', color: '#009688' },
  { name: 'راية Roll-up', w: 85.0, h: 200.0, icon: '🚩', color: '#FF5722' },
  { name: 'كرت هدية', w: 8.5, h: 5.5, icon: '🎁', color: '#E91E63' },
  { name: 'ملصق CD', w: 11.6, h: 11.6, icon: '💿', color: '#607D8B' },
];

// ========================
// تهيئة التطبيق
// ========================

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNav();
  initSidebar();
  initCanvas();
  updateUILabels();

  // Defer non-critical initialization blocks to requestIdleCallback / setTimeout
  const deferInit = () => {
    initProductModal();
    initPresetProducts();
    initBulkResize();
    initBulkRotate();
    initPaperPresets();
    if (window.applyPaperPresets) {
      window.applyPaperPresets();
    }
    initFormEvents();
    initProjectsUI();
    initSettingsUI();
    initSectionToggles();
    initFileUpload();
    loadAutoSave();
    renderProducts();
    renderProjects();

    // تفعيل نظام الحماية والتراخيص والاشتراك
    if (window.ProtectionSystem) {
      window.ProtectionSystem.init();
    }

    // تفعيل وحدة البيانات المتغيرة VDP
    if (window.VDPManager) {
      window.VDPManager.init();
    }

    // تفعيل وحدة رص الوجه والظهر Duplex
    if (window.DuplexManager) {
      window.DuplexManager.init();
    }

    // تفعيل تثبيت التطبيق PWA
    initPWAInstall();
  };

  if (window.requestIdleCallback) {
    window.requestIdleCallback(() => deferInit());
  } else {
    setTimeout(deferInit, 1);
  }
});

// ========================
// تثبيت التطبيق PWA
// ========================
function initPWAInstall() {
  // Let the browser handle PWA installation prompt automatically.
}

// ========================
// الثيم (وضع ليلي/نهاري)
// ========================

function initTheme() {
  const settings = ProjectsManager.getSettings();
  const theme = settings.theme || 'light';
  applyTheme(theme);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const isDark = document.body.classList.contains('dark-mode');
    applyTheme(isDark ? 'light' : 'dark');
  });
}

function applyTheme(theme) {
  const body = document.body;
  body.classList.remove('light-mode', 'dark-mode');
  body.classList.add(theme === 'dark' ? 'dark-mode' : 'light-mode');
  localStorage.setItem('theme', theme);

  const settings = ProjectsManager.getSettings();
  ProjectsManager.saveSettings({ ...settings, theme });
}

// ========================
// التنقل بين التبات
// ========================
function initNav() {
  const navBtns = document.querySelectorAll('.nav-btn[data-tab]');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });


}

function switchTab(tabName) {
  // تحديث أزرار التنقل
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // تحديث لوحات المحتوى
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === 'tab-' + tabName);
  });

  // التحكم في عرض القائمة الجانبية للشاشة الكبيرة
  const body = document.body;
  if (body) {
    body.classList.toggle('has-sidebar', tabName === 'calculator' || tabName === 'duplex');
  }

  // إغلاق القائمة الجانبية في الهواتف عند تغيير التب
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('show');

  if (tabName === 'projects') renderProjects();

  // Notify sub-modules about tab change
  document.dispatchEvent(new CustomEvent('tabChanged', { detail: { tab: tabName } }));
}

// ========================
// Sidebar (موبايل)
// ========================

function initSidebar() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');

  // إنشاء overlay
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.id = 'sidebar-overlay';
  document.body.appendChild(overlay);

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });

  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
}

// ========================
// Canvas
// ========================

function initCanvas() {
  const canvasEl = document.getElementById('packing-canvas');
  const wrapperEl = document.getElementById('canvas-wrapper');
  const tooltipEl = document.getElementById('canvas-tooltip');

  CanvasRenderer.init(canvasEl, wrapperEl, tooltipEl);

  document.getElementById('canvas-zoom-in').addEventListener('click', () => CanvasRenderer.zoomIn());
  document.getElementById('canvas-zoom-out').addEventListener('click', () => CanvasRenderer.zoomOut());
  document.getElementById('canvas-reset-view').addEventListener('click', () => CanvasRenderer.resetView());

  document.getElementById('btn-export-png').addEventListener('click', () => {
    if (window.ProtectionSystem && !window.ProtectionSystem.verifyAccess()) return;
    ExportSystem.exportPNG(canvasEl, 'auto-rass-preview.png');
  });

  document.getElementById('btn-export-pdf').addEventListener('click', () => {
    if (window.ProtectionSystem && !window.ProtectionSystem.verifyAccess()) return;
    const config = getPackingConfig();
    ExportSystem.exportPrintReadyPDF(currentResult, config, 'auto-rass-print-ready.pdf');
  });

  document.getElementById('btn-export-print')?.addEventListener('click', () => {
    if (window.ProtectionSystem && !window.ProtectionSystem.verifyAccess()) return;
    ExportSystem.exportPrintReady('auto-rass-print-ready.jpg', 'jpeg');
  });
}

// ========================
// طي/فتح أقسام الـ Sidebar
// ========================

function initSectionToggles() {
  document.querySelectorAll('.section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const body = document.getElementById(targetId);
      if (body) {
        body.classList.toggle('collapsed');
        btn.classList.toggle('collapsed');
      }
    });
  });
}

// ========================
// المنتجات
// ========================

function addDefaultProducts() {
  // كرت شخصي مثال
  products.push({
    id: nextProductId++,
    name: 'كرت شخصي',
    w: 9, h: 5.5,
    qty: 1000,
    canRotate: true,
    color: PRODUCT_COLORS[0],
    bleedOverride: null
  });
  renderProducts();
}

function renderProducts() {
  const list = document.getElementById('products-list');
  const empty = document.getElementById('products-empty');
  const count = document.getElementById('products-count');

  count.textContent = products.length + ' ' + (products.length === 1 ? 'منتج' : 'منتجات');

  if (products.length === 0) {
    if (empty) empty.style.display = 'flex';
    // مسح أي بطاقات قديمة
    list.querySelectorAll('.product-item').forEach(el => el.remove());
    return;
  }

  if (empty) empty.style.display = 'none';

  // مسح البطاقات القديمة
  list.querySelectorAll('.product-item').forEach(el => el.remove());

  products.forEach(product => {
    // تحميل صورة المنتج إذا كان مخزناً Base64 وليس عنصراً Image
    if (product.imageSrc && !product.image) {
      const img = new Image();
      img.onload = () => {
        product.image = img;
        if (currentResult) CanvasRenderer.render();
      };
      img.src = product.imageSrc;
    }

    const item = createProductItemEl(product);
    list.appendChild(item);
  });
}

function createProductItemEl(product) {
  const div = document.createElement('div');
  div.className = 'product-item';
  div.dataset.id = product.id;

  div.innerHTML = `
    <div class="product-image-container" onclick="triggerProductImageUpload(${product.id})" title="اضغط لرفع تصميم لهذا المنتج">
      ${product.imageSrc 
        ? `<img src="${product.imageSrc}" class="product-thumbnail" />` 
        : `<div class="product-color-dot" style="background:${product.color}"></div>`
      }
      <div class="product-image-overlay">🖼️</div>
    </div>
    <input type="file" id="product-file-${product.id}" accept="image/*,.pdf" style="display:none" onchange="handleProductImageUpload(${product.id}, this)" />
    <div class="product-info">
      <div class="product-name">${escapeHTML(product.name)}</div>
      <div class="product-details">
        <span class="product-detail">
          📐 <span dir="ltr">${product.w} × ${product.h} <span class="unit-text">${getUnitText()}</span></span>
        </span>
        <span class="product-detail">🔢 الكمية: ${product.qty || 1}</span>
        ${product.canRotate ? '<span class="product-detail">🔄 تدوير</span>' : ''}
      </div>
    </div>
    <div class="product-actions">
      <button class="product-action-btn" onclick="editProduct(${product.id})" title="تعديل">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="product-action-btn" onclick="duplicateProduct(${product.id})" title="نسخ">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      </button>
      <button class="product-action-btn danger" onclick="deleteProduct(${product.id})" title="حذف">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
      </button>
    </div>
  `;

  return div;
}

function editProduct(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  editingProductId = id;
  openProductModal(product);
}

function duplicateProduct(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  const newProduct = {
    ...product,
    id: nextProductId++,
    name: product.name + ' (نسخة)',
    color: PRODUCT_COLORS[products.length % PRODUCT_COLORS.length]
  };
  products.push(newProduct);
  renderProducts();
  showToast('تم نسخ المنتج', 'success');
  autoSave();
}

function deleteProduct(id) {
  products = products.filter(p => p.id !== id);
  renderProducts();
  showToast('تم حذف المنتج', 'info');
  autoSave();
}

// ========================
// Modal المنتج
// ========================

function initProductModal() {
  document.getElementById('btn-add-product').addEventListener('click', () => {
    editingProductId = null;
    openProductModal(null);
  });

  document.getElementById('btn-save-product').addEventListener('click', saveProduct);

  // أنواع المنتجات
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const w = btn.dataset.w;
      const h = btn.dataset.h;
      if (w) document.getElementById('product-width').value = w;
      if (h) document.getElementById('product-height').value = h;
      if (btn.dataset.type !== 'custom') {
        document.getElementById('product-name').value = btn.textContent.trim();
      }
    });
  });

  // Bleed مخصص
  document.getElementById('product-bleed-individual').addEventListener('change', (e) => {
    document.getElementById('product-bleed-row').style.display =
      e.target.checked ? 'flex' : 'none';
  });

  // إغلاق Modal
  initModalClose();
}

function openProductModal(product) {
  const modal = document.getElementById('modal-product');
  const title = document.getElementById('modal-product-title');

  title.textContent = product ? 'تعديل المنتج' : 'إضافة منتج';

  if (product) {
    document.getElementById('product-name').value = product.name || '';
    document.getElementById('product-width').value = product.w || '';
    document.getElementById('product-height').value = product.h || '';
    document.getElementById('product-qty').value = product.qty || 1;
    document.getElementById('product-rotate').checked = product.canRotate !== false;
  } else {
    document.getElementById('product-name').value = '';
    document.getElementById('product-width').value = '9';
    document.getElementById('product-height').value = '5.5';
    document.getElementById('product-qty').value = '1000';
    document.getElementById('product-rotate').checked = true;

    // تفعيل "كرت شخصي" كنوع افتراضي
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    const businessBtn = document.querySelector('.type-btn[data-type="business"]');
    if (businessBtn) businessBtn.classList.add('active');
  }

  openModal('modal-product');
}

function saveProduct() {
  const name = document.getElementById('product-name').value.trim();
  const w = parseFloat(document.getElementById('product-width').value);
  const h = parseFloat(document.getElementById('product-height').value);
  const qty = parseInt(document.getElementById('product-qty').value) || 1;
  const editingProduct = editingProductId ? products.find(p => p.id === editingProductId) : null;
  const color = editingProduct ? (editingProduct.color || PRODUCT_COLORS[products.length % PRODUCT_COLORS.length]) : PRODUCT_COLORS[products.length % PRODUCT_COLORS.length];
  const canRotate = document.getElementById('product-rotate').checked;
  const hasCustomBleed = document.getElementById('product-bleed-individual').checked;
  const bleedOverride = hasCustomBleed
    ? parseFloat(document.getElementById('product-bleed').value)
    : null;

  if (!name) { showToast('أدخل اسم المنتج', 'warning'); return; }
  if (!w || !h || w <= 0 || h <= 0) { showToast('أدخل مقاسات صحيحة', 'warning'); return; }

  if (editingProductId) {
    const idx = products.findIndex(p => p.id === editingProductId);
    if (idx !== -1) {
      products[idx] = { ...products[idx], name, w, h, qty, color, canRotate, bleedOverride };
    }
    showToast('تم تحديث المنتج', 'success');
  } else {
    products.push({
      id: nextProductId++,
      name, w, h, qty, color, canRotate, bleedOverride
    });
    showToast('تمت إضافة المنتج', 'success');
  }

  closeModal('modal-product');
  renderProducts();
  autoSave();
}

// ========================
// المنتجات الجاهزة
// ========================

function initPresetProducts() {
  document.getElementById('btn-add-preset-product').addEventListener('click', () => {
    renderPresetProductsModal();
    openModal('modal-preset-products');
  });
}

function initBulkResize() {
  const btn = document.getElementById('btn-bulk-resize');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (products.length === 0) {
      showToast('القائمة فارغة. أضف أو ارفع بعض المنتجات أولاً.', 'warning');
      return;
    }
    // Pre-fill with the first product's dimensions
    document.getElementById('bulk-width').value = products[0].w;
    document.getElementById('bulk-height').value = products[0].h;
    openModal('modal-bulk-resize');
  });

  document.getElementById('btn-confirm-bulk-resize')?.addEventListener('click', () => {
    const newW = parseFloat(document.getElementById('bulk-width').value);
    const newH = parseFloat(document.getElementById('bulk-height').value);

    if (isNaN(newW) || isNaN(newH) || newW <= 0 || newH <= 0) {
      showToast('يرجى إدخال مقاسات صحيحة أكبر من الصفر', 'warning');
      return;
    }

    // Apply to all products
    products.forEach(product => {
      product.w = newW;
      product.h = newH;
    });

    renderProducts();
    debouncedCalculatePacking(150);
    closeModal('modal-bulk-resize');
    showToast(`تم تعديل مقاس جميع المنتجات (${newW} × ${newH}) بنجاح!`, 'success');
    autoSave();
  });
}

function initBulkRotate() {
  const btn = document.getElementById('btn-bulk-rotate');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (products.length === 0) {
      showToast('القائمة فارغة. أضف أو ارفع بعض المنتجات أولاً.', 'warning');
      return;
    }
    // Pre-fill the checkbox state: check if all products currently allow rotation
    const allCanRotate = products.every(product => product.canRotate !== false);
    document.getElementById('bulk-rotate-checkbox').checked = allCanRotate;
    openModal('modal-bulk-rotate');
  });

  document.getElementById('btn-confirm-bulk-rotate')?.addEventListener('click', () => {
    const allowed = document.getElementById('bulk-rotate-checkbox').checked;

    // Apply to all products
    products.forEach(product => {
      product.canRotate = allowed;
    });

    renderProducts();
    debouncedCalculatePacking(150);
    closeModal('modal-bulk-rotate');
    showToast(allowed ? 'تم تفعيل التدوير لجميع المنتجات بنجاح!' : 'تم إيقاف التدوير لجميع المنتجات بنجاح!', 'success');
    autoSave();
  });
}

function renderPresetProductsModal() {
  const grid = document.getElementById('preset-products-grid');
  grid.innerHTML = PRESET_PRODUCTS.map((p, i) => `
    <div class="preset-product-card" onclick="addPresetProduct(${i})">
      <div class="preset-product-icon" style="background:${p.color}22">${p.icon}</div>
      <div class="preset-product-name">${p.name}</div>
      <div class="preset-product-size" dir="ltr">${p.w} × ${p.h} <span class="unit-text">${getUnitText()}</span></div>
    </div>
  `).join('');
}

function addPresetProduct(idx) {
  const preset = PRESET_PRODUCTS[idx];
  products.push({
    id: nextProductId++,
    name: preset.name,
    w: preset.w,
    h: preset.h,
    qty: 1000,
    color: preset.color,
    canRotate: true,
    bleedOverride: null
  });
  closeModal('modal-preset-products');
  renderProducts();
  showToast('تمت إضافة ' + preset.name, 'success');
  autoSave();
}

// ========================
// مقاسات الورق
// ========================

const DEFAULT_PRESETS = [
  { name: 'A4', w: 21.0, h: 29.7 },
  { name: 'A3', w: 29.7, h: 42.0 },
  { name: 'A2', w: 42.0, h: 59.4 },
  { name: 'نصف فرخ', w: 50.0, h: 70.0 },
  { name: 'فرخ كامل', w: 100.0, h: 70.0 },
  { name: 'ربع فرخ', w: 50.0, h: 35.0 },
  { name: 'تمن فرخ', w: 25.0, h: 35.0 }
];

function getPresetLabel(name) {
  const labels = {
    'A4': 'A4',
    'A3': 'A3',
    'A2': 'A2',
    'نصف فرخ': '½ فرخ',
    'فرخ كامل': 'فرخ كامل',
    'ربع فرخ': '¼ فرخ',
    'تمن فرخ': '⅛ فرخ'
  };
  return labels[name] || name;
}

let saveSettingsTimeout = null;
function debouncedSaveSettings(updates, delay = 1000) {
  if (saveSettingsTimeout) clearTimeout(saveSettingsTimeout);
  saveSettingsTimeout = setTimeout(() => {
    if (typeof ProjectsManager !== 'undefined') {
      const current = ProjectsManager.getSettings();
      ProjectsManager.saveSettings({ ...current, ...updates });
    }
  }, delay);
}

function applyPaperPresets() {
  if (typeof ProjectsManager === 'undefined') return;
  const container = document.getElementById('paper-presets');
  if (!container) return;

  const settings = ProjectsManager.getSettings();
  const customPresets = settings.paperPresets || {};
  const currentUnit = settings.unit || 'cm';

  // Remember active preset name before rendering
  const activeBtn = container.querySelector('.preset-btn.active');
  const activeName = activeBtn ? activeBtn.dataset.name : 'نصف فرخ';

  let html = '';

  // 1. Render default presets
  DEFAULT_PRESETS.forEach(p => {
    let w = p.w;
    let h = p.h;
    
    // Convert to current unit for display
    let dispW = w;
    let dispH = h;
    if (currentUnit === 'mm') {
      dispW = w * 10;
      dispH = h * 10;
    } else if (currentUnit === 'inch') {
      dispW = w / 2.54;
      dispH = h / 2.54;
    }
    
    const wStr = dispW.toFixed(1).replace(/\.0+$/, '');
    const hStr = dispH.toFixed(1).replace(/\.0+$/, '');
    const isActive = p.name === activeName ? 'active' : '';

    html += `<button class="preset-btn ${isActive}" data-w="${wStr}" data-h="${hStr}" data-name="${p.name}">${getPresetLabel(p.name)} (${wStr}×${hStr})</button>`;
  });

  // 2. Render user custom presets
  const defaultNames = DEFAULT_PRESETS.map(p => p.name);
  for (const name in customPresets) {
    if (!defaultNames.includes(name)) {
      let { w, h } = customPresets[name];
      
      // Convert to current unit for display
      let dispW = w;
      let dispH = h;
      if (currentUnit === 'mm') {
        dispW = w * 10;
        dispH = h * 10;
      } else if (currentUnit === 'inch') {
        dispW = w / 2.54;
        dispH = h / 2.54;
      }
      
      const wStr = dispW.toFixed(1).replace(/\.0+$/, '');
      const hStr = dispH.toFixed(1).replace(/\.0+$/, '');
      const isActive = name === activeName ? 'active' : '';

      html += `<button class="preset-btn ${isActive} custom-preset" data-w="${wStr}" data-h="${hStr}" data-name="${name}">✨ ${name} (${wStr}×${hStr})</button>`;
    }
  }

  // 3. Render "+" Add button
  html += `<button class="preset-btn add-btn" id="btn-add-custom-preset" style="background:var(--color-primary-50); color:var(--color-primary-600); border-color:var(--color-primary-200); font-weight:bold;" title="إضافة المقاس الحالي كمقاس جاهز">＋ إضافة مقاس</button>`;

  container.innerHTML = html;

  // Re-attach event listeners
  initPaperPresetsEvents();
}
window.applyPaperPresets = applyPaperPresets;

function deleteCustomPreset(name) {
  if (typeof ProjectsManager !== 'undefined') {
    const settings = ProjectsManager.getSettings();
    const paperPresets = settings.paperPresets ? { ...settings.paperPresets } : {};
    delete paperPresets[name];
    
    ProjectsManager.saveSettings({ paperPresets });
    showToast(`تم حذف المقاس "${name}"`, 'info');
    
    // Select default 'نصف فرخ'
    setTimeout(() => {
      const defaultBtn = document.querySelector('#paper-presets .preset-btn[data-name="نصف فرخ"]');
      if (defaultBtn) defaultBtn.click();
    }, 50);
  }
}

function initPaperPresetsEvents() {
  const container = document.getElementById('paper-presets');
  if (!container) return;

  // Click handler for presets
  container.querySelectorAll('.preset-btn:not(.add-btn)').forEach(btn => {
    btn.addEventListener('click', () => {
      const isAlreadyActive = btn.classList.contains('active');
      const name = btn.dataset.name;
      const defaultNames = DEFAULT_PRESETS.map(p => p.name);

      if (isAlreadyActive && !defaultNames.includes(name)) {
        if (confirm(`هل تريد حذف المقاس المخصص "${name}"؟`)) {
          deleteCustomPreset(name);
          return;
        }
      }

      container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const w = btn.dataset.w;
      const h = btn.dataset.h;
      if (w) document.getElementById('paper-width').value = w;
      if (h) document.getElementById('paper-height').value = h;
    });
  });

  // Click handler for Add button
  container.querySelector('#btn-add-custom-preset')?.addEventListener('click', () => {
    const wVal = parseFloat(document.getElementById('paper-width').value) || 0;
    const hVal = parseFloat(document.getElementById('paper-height').value) || 0;

    if (wVal <= 0 || hVal <= 0) {
      showToast('يرجى إدخال أبعاد صحيحة أولاً', 'warning');
      return;
    }

    // فتح Modal مخصص بدلاً من prompt() القديم
    const modal = document.getElementById('modal-custom-preset');
    const nameInput = document.getElementById('custom-preset-name-input');
    const errorEl = document.getElementById('custom-preset-error');
    const confirmBtn = document.getElementById('btn-confirm-custom-preset');
    const cancelBtn = document.getElementById('btn-cancel-custom-preset');

    if (!modal) {
      // احتياطي: استخدام prompt إذا لم يُوجد Modal
      const name = prompt("أدخل اسماً لهذا المقاس المخصص:");
      if (!name) return;
      _saveCustomPreset(name.trim(), wVal, hVal, container);
      return;
    }

    // إزالة المستمعين القديمة ثم إضافة جديدة (لمنع التكرار)
    const newConfirm = confirmBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);
    const newNameInput = nameInput.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    nameInput.parentNode.replaceChild(newNameInput, nameInput);

    // الحصول على المراجع الجديدة بعد استبدالها في الـ DOM
    const nameInputRef = document.getElementById('custom-preset-name-input');
    const confirmBtnRef = document.getElementById('btn-confirm-custom-preset');
    const cancelBtnRef = document.getElementById('btn-cancel-custom-preset');

    nameInputRef.value = '';
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    modal.style.display = 'flex';
    setTimeout(() => nameInputRef.focus(), 100);

    const doSave = () => {
      const cleanName = nameInputRef.value.trim();
      const defaultNames = DEFAULT_PRESETS.map(p => p.name);
      if (!cleanName) {
        errorEl.textContent = 'يرجى إدخال اسم للمقاس';
        errorEl.style.display = 'block';
        return;
      }
      if (defaultNames.includes(cleanName)) {
        errorEl.textContent = 'هذا الاسم محجوز للمقاسات الافتراضية';
        errorEl.style.display = 'block';
        return;
      }
      modal.style.display = 'none';
      _saveCustomPreset(cleanName, wVal, hVal, container);
    };

    const doCancel = () => { modal.style.display = 'none'; };

    confirmBtnRef.addEventListener('click', doSave);
    cancelBtnRef.addEventListener('click', doCancel);
    nameInputRef.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSave();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        doCancel();
      }
    });
  });
}

// دالة مساعدة لحفظ المقاس المخصص
function _saveCustomPreset(cleanName, wVal, hVal, container) {
    if (typeof ProjectsManager !== 'undefined') {
      const settings = ProjectsManager.getSettings();
      const currentUnit = settings.unit || 'cm';
      let wCm = wVal;
      let hCm = hVal;
      if (currentUnit === 'mm') {
        wCm = wCm / 10;
        hCm = hCm / 10;
      } else if (currentUnit === 'inch') {
        wCm = wCm * 2.54;
        hCm = hCm * 2.54;
      }

      const paperPresets = settings.paperPresets ? { ...settings.paperPresets } : {};
      paperPresets[cleanName] = { w: wCm, h: hCm };
      
      ProjectsManager.saveSettings({ paperPresets });
      showToast(`تمت إضافة المقاس "${cleanName}" بنجاح!`, 'success');
      
      setTimeout(() => {
        const buttons = container.querySelectorAll('.preset-btn');
        buttons.forEach(b => {
          if (b.dataset.name === cleanName) {
            b.click();
          }
        });
      }, 50);
    }
}

function initPaperPresets() {
  applyPaperPresets();

  const updateActivePreset = () => {
    const activeBtn = document.querySelector('#paper-presets .preset-btn.active');
    if (!activeBtn) return;
    
    const name = activeBtn.dataset.name;
    const defaultNames = DEFAULT_PRESETS.map(p => p.name);
    
    // إذا كان مقاساً افتراضياً ثابتاً، نقوم بإلغاء التحديد ولا نعدل عليه
    if (defaultNames.includes(name)) {
      activeBtn.classList.remove('active');
      return;
    }
    
    const wVal = parseFloat(document.getElementById('paper-width').value) || 0;
    const hVal = parseFloat(document.getElementById('paper-height').value) || 0;
    
    if (wVal > 0 && hVal > 0) {
      const w = wVal.toFixed(1).replace(/\.0+$/, '');
      const h = hVal.toFixed(1).replace(/\.0+$/, '');
      
      activeBtn.dataset.w = w;
      activeBtn.dataset.h = h;
      
      const isCustom = activeBtn.classList.contains('custom-preset');
      activeBtn.textContent = `${isCustom ? '✨ ' : ''}${getPresetLabel(name)} (${w}×${h})`;
      
      if (typeof ProjectsManager !== 'undefined') {
        const settings = ProjectsManager.getSettings();
        const paperPresets = settings.paperPresets ? { ...settings.paperPresets } : {};
        
        const currentUnit = settings.unit || 'cm';
        let wCm = parseFloat(w);
        let hCm = parseFloat(h);
        if (currentUnit === 'mm') {
          wCm = wCm / 10;
          hCm = hCm / 10;
        } else if (currentUnit === 'inch') {
          wCm = wCm * 2.54;
          hCm = hCm * 2.54;
        }
        
        paperPresets[name] = { w: wCm, h: hCm };
        debouncedSaveSettings({ paperPresets }, 1000);
      }
    }
  };

  document.getElementById('paper-width').addEventListener('input', updateActivePreset);
  document.getElementById('paper-height').addEventListener('input', updateActivePreset);
}

// ========================
// أحداث النماذج
// ========================

function initFormEvents() {
  // حساب الرص
  document.getElementById('btn-calculate').addEventListener('click', calculatePacking);

  // مقارنة الأحجام
  document.getElementById('btn-compare-sizes').addEventListener('click', compareSizes);

  // إعادة تعيين
  document.getElementById('btn-reset').addEventListener('click', resetAll);

  // حفظ المشروع
  document.getElementById('btn-save-project').addEventListener('click', () => {
    openModal('modal-save-project');
    document.getElementById('project-name').focus();
  });

  document.getElementById('btn-confirm-save').addEventListener('click', saveCurrentProject);

  // إغلاق المساعد الذكي
  document.getElementById('close-advisor').addEventListener('click', () => {
    document.getElementById('ai-advisor').style.display = 'none';
  });

  // اتجاه الورقة
  document.getElementById('paper-orientation').addEventListener('change', (e) => {
    const w = parseFloat(document.getElementById('paper-width').value);
    const h = parseFloat(document.getElementById('paper-height').value);
    if (e.target.value === 'landscape' && h > w) {
      document.getElementById('paper-width').value = h;
      document.getElementById('paper-height').value = w;
    } else if (e.target.value === 'portrait' && w > h) {
      document.getElementById('paper-width').value = h;
      document.getElementById('paper-height').value = w;
    }
    
    // تحديث المقاس المخصص للزر النشط تلقائياً
    const activeBtn = document.querySelector('#paper-presets .preset-btn.active');
    if (activeBtn) {
      const name = activeBtn.dataset.name;
      const defaultNames = DEFAULT_PRESETS.map(p => p.name);
      
      // إذا كان مقاساً افتراضياً ثابتاً، نقوم بإلغاء التحديد ولا نعدل عليه
      if (defaultNames.includes(name)) {
        activeBtn.classList.remove('active');
        return;
      }
      
      const wVal = parseFloat(document.getElementById('paper-width').value) || 0;
      const hVal = parseFloat(document.getElementById('paper-height').value) || 0;
      if (wVal > 0 && hVal > 0) {
        const wStr = wVal.toFixed(1).replace(/\.0+$/, '');
        const hStr = hVal.toFixed(1).replace(/\.0+$/, '');
        activeBtn.dataset.w = wStr;
        activeBtn.dataset.h = hStr;
        const name = activeBtn.dataset.name;
        const isCustom = activeBtn.classList.contains('custom-preset');
        activeBtn.textContent = `${isCustom ? '✨ ' : ''}${getPresetLabel(name)} (${wStr}×${hStr})`;
        
        if (typeof ProjectsManager !== 'undefined') {
          const settings = ProjectsManager.getSettings();
          const paperPresets = settings.paperPresets ? { ...settings.paperPresets } : {};
          const currentUnit = settings.unit || 'cm';
          let wCm = parseFloat(wStr);
          let hCm = parseFloat(hStr);
          if (currentUnit === 'mm') { wCm = wCm / 10; hCm = hCm / 10; }
          else if (currentUnit === 'inch') { wCm = wCm * 2.54; hCm = hCm * 2.54; }
          paperPresets[name] = { w: wCm, h: hCm };
          debouncedSaveSettings({ paperPresets }, 1000);
        }
      }
    }
  });

  // مستمعات الأحداث لخيارات علامات القص ونمط القص المستقيم لتعمل بشكل فوري
  document.getElementById('crop-marks')?.addEventListener('change', (e) => {
    if (window.CanvasRenderer) {
      window.CanvasRenderer.setShowCropMarks(e.target.checked);
    }
  });

  document.getElementById('guillotine-mode')?.addEventListener('change', () => {
    debouncedCalculatePacking(150);
  });
}

// ========================
// الحساب الرئيسي
// ========================

let calcTimeout = null;
function debouncedCalculatePacking(delay = 150) {
  if (calcTimeout) clearTimeout(calcTimeout);
  calcTimeout = setTimeout(() => {
    calculatePacking();
  }, delay);
}

async function calculatePacking() {
  if (window.ProtectionSystem && !window.ProtectionSystem.verifyAccess()) {
    return;
  }
  if (products.length === 0) {
    showToast('أضف منتجاً واحداً على الأقل', 'warning');
    return;
  }

  const config = getPackingConfig();

  // تحقق من الإدخالات
  if (!config.paperW || !config.paperH || config.paperW <= 0 || config.paperH <= 0) {
    showToast('أدخل مقاسات الورقة', 'warning');
    return;
  }

  // عرض شاشة التحميل
  showLoading(true, 'جاري حساب الرص الأمثل...');

  try {
    // تشغيل الخوارزمية في setTimeout لإتاحة تحديث الـ UI
    await new Promise(resolve => setTimeout(resolve, 50));

    updateLoadingProgress(30, 'تحليل المنتجات...');
    await sleep(100);

    updateLoadingProgress(60, 'تطبيق خوارزمية الرص...');
    await sleep(100);

    const result = await PackingEngine.packQuantity(config, products);

    updateLoadingProgress(90, 'إنشاء المخطط...');
    await sleep(100);

    if (result.error) {
      showToast('خطأ: ' + result.error, 'error');
      showLoading(false);
      return;
    }

    currentResult = result;

    if (window.ProtectionSystem && window.ProtectionSystem.incrementLimit) {
      window.ProtectionSystem.incrementLimit('nestingOperations');
    }

    updateLoadingProgress(100, 'اكتمل!');
    await sleep(200);

    showLoading(false);

    // عرض النتائج
    showResults(result, config);

    // مساعد ذكي
    await sleep(300);
    await generateAIAdvice(result, config);

    autoSave();

  } catch (error) {
    console.error('خطأ في الحساب:', error);
    showLoading(false);
    showToast('حدث خطأ أثناء الحساب: ' + error.message, 'error');
  }
}

function getPackingConfig() {
  const settings = ProjectsManager.getSettings();
  return {
    paperW: parseFloat(document.getElementById('paper-width').value) || 50,
    paperH: parseFloat(document.getElementById('paper-height').value) || 70,
    bleed: parseFloat(document.getElementById('bleed').value) || 0,
    gutter: parseFloat(document.getElementById('gutter').value) || 0,
    safeMargin: parseFloat(document.getElementById('safe-margin').value) || 0,
    paperMargin: parseFloat(document.getElementById('paper-margin').value) || 0,
    guillotineMode: document.getElementById('guillotine-mode').checked,
    autoRepeat: document.getElementById('auto-repeat')?.checked !== false,
    algorithm: document.getElementById('algo-select')?.value || settings.algorithm || 'auto',
    iterations: parseInt(document.getElementById('iterations-select')?.value || settings.iterations || 500),
    unit: settings.unit || 'cm'
  };
}

function getCostConfig() {
  return {
    sheetCost: parseFloat(document.getElementById('cost-sheet').value) || 0,
    printCost: parseFloat(document.getElementById('cost-print').value) || 0,
    finishCost: parseFloat(document.getElementById('cost-finish').value) || 0,
    currency: document.getElementById('currency').value || 'ج.م'
  };
}

// ========================
// عرض النتائج
// ========================

function showResults(result, config) {
  const section = document.getElementById('results-section');
  section.style.display = 'block';

  // الإحصائيات
  animateCounter('stat-efficiency', result.efficiency, 1, '%');
  animateCounter('stat-waste', result.waste, 1, '%');
  document.getElementById('stat-pieces').textContent = result.itemCount;
  document.getElementById('stat-sheets').textContent = result.sheetsNeeded;

  // تلوين نسبة الاستغلال
  const effEl = document.getElementById('stat-efficiency');
  effEl.style.color = result.efficiency >= 70 ? '#4CAF50' :
                      result.efficiency >= 50 ? '#FF9800' : '#F44336';

  // التكلفة
  const costConfig = getCostConfig();
  const costResult = CostCalculator.calculate(result, costConfig, products);
  if (costResult && (costConfig.sheetCost > 0 || costConfig.printCost > 0)) {
    document.getElementById('cost-grid').innerHTML = CostCalculator.renderCostGrid(costResult);
    document.getElementById('cost-results').style.display = 'block';
  } else {
    document.getElementById('cost-results').style.display = 'none';
  }

  // Canvas
  CanvasRenderer.setResult(result);

  // خطوط القص
  renderCutSteps(result.cutOrder || []);

  // الورقات المتعددة
  if (result.pages && result.pages.length > 1) {
    renderPageTabs(result.pages);
  } else {
    const bar = document.getElementById('page-tabs-bar');
    if (bar) bar.style.display = 'none';
  }

  // تمرير للنتائج
  setTimeout(() => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
}

function renderCutSteps(cutOrder) {
  const container = document.getElementById('cut-steps');
  if (!cutOrder || cutOrder.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem">لا توجد خطوط قص محددة</p>';
    return;
  }

  container.innerHTML = cutOrder.map((step, idx) => `
    <div class="cut-step">
      <span class="cut-step-num">${idx + 1}</span>
      <span class="cut-step-dir ${step.type}">${step.type === 'horizontal' ? 'أفقي' : 'رأسي'}</span>
      <span>${step.label}</span>
    </div>
  `).join('');
}

function renderPageTabs(pages) {
  const bar = document.getElementById('page-tabs-bar');
  const tabs = document.getElementById('page-tabs');
  bar.style.display = 'flex';

  tabs.innerHTML = pages.map((page, idx) => `
    <button class="page-tab ${idx === 0 ? 'active' : ''}" onclick="switchPage(${idx})">
      ورقة ${idx + 1}
    </button>
  `).join('');
}

function switchPage(idx) {
  if (!currentResult?.pages?.[idx]) return;
  document.querySelectorAll('.page-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  CanvasRenderer.setResult(currentResult.pages[idx]);
}

// ========================
// مقارنة الأحجام
// ========================

async function compareSizes() {
  if (products.length === 0) {
    showToast('أضف منتجاً على الأقل', 'warning');
    return;
  }

  showLoading(true, 'جاري مقارنة أحجام الورق...');
  const config = getPackingConfig();

  await sleep(200);
  const results = await PackingEngine.comparePaperSizes(config, products);
  currentComparisonResults = results;

  if (window.ProtectionSystem && window.ProtectionSystem.incrementLimit) {
    window.ProtectionSystem.incrementLimit('nestingOperations');
  }

  showLoading(false);

  // عرض في Modal
  renderComparisonModal(results);
  openModal('modal-comparison');
}

function renderComparisonModal(results) {
  const content = document.getElementById('comparison-content');
  if (!results || results.length === 0) {
    content.innerHTML = '<p>لم يتم العثور على نتائج</p>';
    return;
  }

  content.innerHTML = `
    <div class="comparison-table-wrap">
      <table class="comparison-table">
        <thead>
          <tr>
            <th>حجم الورقة</th>
            <th>المقاسات</th>
            <th>نسبة الاستغلال</th>
            <th>نسبة الهالك</th>
            <th>قطعة/ورقة</th>
            <th>عدد الأوراق</th>
            <th>الأفضل</th>
          </tr>
        </thead>
        <tbody>
          ${results.map(r => `
            <tr class="${r.best ? 'best-row' : ''}">
              <td>${r.name}</td>
              <td dir="ltr">${r.w}×${r.h}</td>
              <td style="color:${r.efficiency >= 70 ? '#4CAF50' : '#FF9800'};font-weight:700">
                ${r.efficiency.toFixed(1)}%
              </td>
              <td>${r.waste.toFixed(1)}%</td>
              <td>${r.itemCount}</td>
              <td>${r.sheetsNeeded}</td>
              <td>${r.best ? '⭐ الأفضل' : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:16px;padding:12px;background:var(--bg-hover);border-radius:10px;font-size:0.875rem;color:var(--text-secondary)">
      💡 ${AIAdvisor.getBestSizeRecommendation(results) || ''}
    </div>
  `;
}

// ========================
// المساعد الذكي
// ========================

async function generateAIAdvice(result, config) {
  await sleep(500);
  const tips = await AIAdvisor.generateSuggestions(result, currentComparisonResults, products, config);
  if (tips.length === 0) return;

  const advisorEl = document.getElementById('ai-advisor');
  const suggestionsEl = document.getElementById('ai-suggestions');

  suggestionsEl.innerHTML = AIAdvisor.renderSuggestions(tips);
  advisorEl.style.display = 'block';
  advisorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ========================
// إدارة المشاريع
// ========================

function initProjectsUI() {
  document.getElementById('btn-new-project').addEventListener('click', () => {
    resetAll();
    switchTab('calculator');
    showToast('مشروع جديد - أضف منتجاتك', 'info');
  });
}

async function saveCurrentProject() {
  const name = document.getElementById('project-name').value.trim();
  if (!name) { showToast('أدخل اسم المشروع', 'warning'); return; }

  const activeTab = document.querySelector('.nav-btn.active')?.dataset.tab;
  const ownerId = ProjectsManager.getActiveOwnerId() || 'anonymous';

  if (activeTab === 'booklet') {
    if (window.BookletCreator && window.BookletCreator.getSaveData) {
      showLoading(true, 'جاري رفع صفحات الكتيب إلى السحابة...');
      if (window.BookletCreator.prepareSavePages) {
        await window.BookletCreator.prepareSavePages(ownerId);
      }
      showLoading(false);

      const bookletData = window.BookletCreator.getSaveData();
      const projectData = {
        name,
        client: document.getElementById('project-client').value.trim(),
        notes: document.getElementById('project-notes').value.trim(),
        projectType: 'booklet',
        pagesCount: bookletData.pagesCount,
        booklet: bookletData
      };

      if (currentProjectId) {
        ProjectsManager.updateProject(currentProjectId, projectData);
        showToast('تم تحديث مشروع الكتيب', 'success');
      } else {
        const proj = ProjectsManager.createProject(projectData);
        currentProjectId = proj.id;
        showToast('تم حفظ مشروع الكتيب بنجاح', 'success');
      }
    }
    closeModal('modal-save-project');
    renderProjects();
    return;
  }

  const config = getPackingConfig();
  const costConfig = getCostConfig();

  // رفع صور المنتجات الأصلية على imgBB قبل الحفظ
  let uploadedCount = 0;
  const totalToUpload = products.filter(p => p.imageSrc && !p.imageSrc.startsWith('http')).length;
  if (totalToUpload > 0) {
    showLoading(true, `جاري رفع ${totalToUpload} تصميم على السحابة...`);
    for (const product of products) {
      if (product.imageSrc && !product.imageSrc.startsWith('http')) {
        try {
          const blob = dataURLToBlob(product.imageSrc);
          const ext = (blob.type || 'image/png').split('/').pop();
          const suggestedName = `${ownerId}_product_${product.id}_${Date.now()}.${ext}`;
          const url = await uploadToImgBB(blob, suggestedName);
          if (url) {
            product.imageSrc = url;
            if (product.image) {
              product.image.src = url;
            }
            uploadedCount++;
          }
        } catch (e) {
          console.warn(`فشل رفع صورة المنتج "${product.name}":`, e);
        }
      }
    }
    showLoading(false);
  }
  if (uploadedCount > 0) {
    showToast(`تم رفع ${uploadedCount} تصميم بنجاح ✅`, 'success');
  }

  const projectData = {
    name,
    client: document.getElementById('project-client').value.trim(),
    notes: document.getElementById('project-notes').value.trim(),
    projectType: 'packing',
    paper: config,
    printSettings: {
      bleed: config.bleed,
      gutter: config.gutter,
      safeMargin: config.safeMargin,
      paperMargin: config.paperMargin,
      guillotineMode: config.guillotineMode
    },
    costSettings: costConfig,
    products: [...products],
    result: currentResult
  };

  if (currentProjectId) {
    ProjectsManager.updateProject(currentProjectId, projectData);
    showToast('تم تحديث المشروع', 'success');
  } else {
    const proj = ProjectsManager.createProject(projectData);
    currentProjectId = proj.id;
    showToast('تم حفظ المشروع بنجاح', 'success');
  }

  closeModal('modal-save-project');
  renderProjects();
}

function renderProjects() {
  const list = document.getElementById('projects-list');
  const projects = ProjectsManager.getProjects();

  if (projects.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
        <p>لا توجد مشاريع محفوظة</p>
        <small>احفظ مشروعك الحالي لتجده هنا لاحقاً</small>
      </div>
    `;
    return;
  }

  list.innerHTML = projects.map(proj => `
    <div class="project-card" onclick="loadProject('${proj.id}')">
      <div class="project-card-header">
        <div>
          <div class="project-card-title">${escapeHTML(proj.name)}</div>
          ${proj.client ? `<div class="project-card-client">👤 ${escapeHTML(proj.client)}</div>` : ''}
        </div>
        <div class="project-card-date">${ProjectsManager.formatDate(proj.updatedAt)}</div>
      </div>
      <div class="project-card-client">
        ${proj.projectType === 'booklet' 
          ? `📖 مشروع كتيب | ${proj.pagesCount || 0} صفحة` 
          : `📦 ${proj.products?.length || 0} منتجات | ${proj.result ? `✅ ${proj.result.efficiency?.toFixed(1) || 0}% استغلال` : '⏳ لم يُحسب'}`}
      </div>
      <div class="project-card-actions">
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();loadProject('${proj.id}')">فتح</button>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();exportProject('${proj.id}')">تصدير</button>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmDeleteProject('${proj.id}')">حذف</button>
      </div>
    </div>
  `).join('');
}

function loadProject(id) {
  const proj = ProjectsManager.getProject(id);
  if (!proj) { showToast('المشروع غير موجود', 'error'); return; }

  currentProjectId = id;

  if (proj.projectType === 'booklet') {
    switchTab('booklet');
    if (window.BookletCreator && window.BookletCreator.loadProjectData) {
      window.BookletCreator.loadProjectData(proj);
    }
    return;
  }

  // تحميل المنتجات
  products = proj.products ? [...proj.products] : [];
  nextProductId = Math.max(...products.map(p => p.id || 0), 0) + 1;

  // تحميل إعدادات الورق
  if (proj.paper) {
    setValue('paper-width', proj.paper.paperW);
    setValue('paper-height', proj.paper.paperH);
    setValue('bleed', proj.paper.bleed);
    setValue('gutter', proj.paper.gutter);
    setValue('safe-margin', proj.paper.safeMargin);
    setValue('paper-margin', proj.paper.paperMargin);
    setChecked('guillotine-mode', proj.paper.guillotineMode);
    setChecked('crop-marks', proj.printSettings?.cropMarks);
  }

  // تحميل التكلفة
  if (proj.costSettings) {
    setValue('cost-sheet', proj.costSettings.sheetCost);
    setValue('cost-print', proj.costSettings.printCost);
    setValue('cost-finish', proj.costSettings.finishCost);
    setValue('currency', proj.costSettings.currency);
  }

  // عرض النتائج السابقة إن وجدت
  if (proj.result) {
    currentResult = proj.result;
    showResults(proj.result, proj.paper);
  }

  renderProducts();
  switchTab('calculator');
  showToast(`تم تحميل مشروع: ${proj.name}`, 'success');
}

function exportProject(id) {
  const proj = ProjectsManager.getProject(id);
  if (!proj) return;
  ExportSystem.exportProject(proj, `${proj.name}.json`);
}

function confirmDeleteProject(id) {
  const proj = ProjectsManager.getProject(id);
  if (!proj) return;
  if (confirm(`هل تريد حذف مشروع "${proj.name}"؟`)) {
    ProjectsManager.deleteProject(id);
    if (currentProjectId === id) {
      currentProjectId = null;
    }
    renderProjects();
    showToast('تم حذف المشروع', 'info');
  }
}

// ========================
// إعدادات التطبيق
// ========================

function initSettingsUI() {
  const settings = ProjectsManager.getSettings();

  setValue('unit-select', settings.unit || 'cm');
  setValue('canvas-quality', settings.canvasQuality || 2);
  setValue('algo-select', settings.algorithm || 'auto');
  setValue('iterations-select', settings.iterations || 500);
  setValue('export-dpi', settings.exportDPI || 300);

  // ربط أحداث تعديل وحفظ بيانات الملف الشخصي تلقائياً
  const nameInput = document.getElementById('user-settings-name');
  const phoneInput = document.getElementById('user-settings-phone');
  
  const saveProfileChange = () => {
    const nameVal = nameInput ? nameInput.value.trim() : '';
    const phoneVal = phoneInput ? phoneInput.value.trim() : '';
    ProjectsManager.saveProfile({
      name: nameVal,
      phone: phoneVal
    });
  };

  nameInput?.addEventListener('change', saveProfileChange);
  nameInput?.addEventListener('blur', saveProfileChange);
  phoneInput?.addEventListener('change', saveProfileChange);
  phoneInput?.addEventListener('blur', saveProfileChange);

  document.getElementById('unit-select')?.addEventListener('change', (e) => {
    const oldSettings = ProjectsManager.getSettings();
    const oldUnit = oldSettings.unit || 'cm';
    const newUnit = e.target.value;
    saveSettings({ unit: newUnit });
    updateUILabels();
    convertValues(oldUnit, newUnit);
  });

  document.getElementById('canvas-quality')?.addEventListener('change', (e) => {
    const q = parseInt(e.target.value);
    CanvasRenderer.setQuality(q);
    saveSettings({ canvasQuality: q });
    if (currentResult) CanvasRenderer.render();
  });

  document.getElementById('algo-select')?.addEventListener('change', (e) => {
    saveSettings({ algorithm: e.target.value });
  });

  document.getElementById('iterations-select')?.addEventListener('change', (e) => {
    saveSettings({ iterations: parseInt(e.target.value) });
  });

  document.getElementById('btn-export-data')?.addEventListener('click', () => {
    const data = ProjectsManager.exportAll();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'autorass-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('تم تصدير البيانات', 'success');
  });

  document.getElementById('btn-import-data')?.addEventListener('click', () => {
    document.getElementById('import-data-file').click();
  });

  document.getElementById('import-data-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const result = ProjectsManager.importAll(text);
    if (result.error) {
      showToast('خطأ في الاستيراد: ' + result.error, 'error');
    } else {
      showToast(`تم استيراد ${result.count} مشروع`, 'success');
      renderProjects();
    }
    e.target.value = '';
  });

  document.getElementById('btn-clear-data')?.addEventListener('click', () => {
    if (confirm('هل أنت متأكد من مسح جميع البيانات؟ لا يمكن التراجع عن هذا.')) {
      ProjectsManager.clearAll();
      products = [];
      currentResult = null;
      currentProjectId = null;
      renderProducts();
      renderProjects();
      document.getElementById('results-section').style.display = 'none';
      showToast('تم مسح جميع البيانات', 'info');
    }
  });
}

function saveSettings(updates) {
  const current = ProjectsManager.getSettings();
  ProjectsManager.saveSettings({ ...current, ...updates });
}

// ========================
// رفع الملفات
// ========================

// دالة ضغط الصور لتوفير مساحة التخزين السحابي بكفاءة
function compressImageDataUrl(dataUrl, maxWidth = 400, maxHeight = 400, quality = 0.6) {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:image')) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      let width = img.naturalWidth;
      let height = img.naturalHeight;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
}

function initFileUpload() {
  const triggerUpload = () => {
    document.getElementById('file-upload').click();
  };

  document.getElementById('btn-import-file')?.addEventListener('click', triggerUpload);
  document.getElementById('btn-import-file-empty')?.addEventListener('click', triggerUpload);

  document.getElementById('file-upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    showLoading(true, 'جاري استخراج المقاسات (0%)...');

    const results = await FileReaderHelper.processFiles(files, (current, total) => {
      const percent = Math.round((current / total) * 100);
      updateLoadingProgress(percent, `جاري استخراج المقاسات (${percent}%) - معالجة ${current} من ${total}...`);
    });

    showLoading(false);

    let added = 0;
    for (const result of results) {
      if (result.w && result.h) {
        const settings = ProjectsManager.getSettings();
        const unit = settings.unit || 'cm';
        let w = result.w;
        let h = result.h;
        if (unit === 'cm') {
          w = w / 10;
          h = h / 10;
        } else if (unit === 'inch') {
          w = w / 25.4;
          h = h / 25.4;
        }

        const newProduct = {
          id: nextProductId++,
          name: result.name || 'منتج من ملف',
          w: w,
          h: h,
          qty: 1,
          color: PRODUCT_COLORS[products.length % PRODUCT_COLORS.length],
          canRotate: true,
          bleedOverride: null
        };

        if (result.imageSrc) {
          // تحميل الصورة الأصلية عالية الدقة للمعاينة والرسم محلياً
          const img = new Image();
          img.onload = () => {
            newProduct.image = img;
            if (currentResult) CanvasRenderer.render();
          };
          img.src = result.imageSrc;

          // ضغط الصورة المرفوعة لحفظها سحابياً بكفاءة وسرعة
          try {
            newProduct.imageSrc = await compressImageDataUrl(result.imageSrc);
          } catch (err) {
            newProduct.imageSrc = result.imageSrc;
          }
        }

        products.push(newProduct);
        added++;
        if (result.note) showToast(result.note, 'info');
      } else if (result.manualRequired) {
        showToast(`"${result.name}": ${result.error || 'يرجى إدخال المقاسات يدوياً'}`, 'warning');
      }
    }

    if (added > 0) {
      renderProducts();
      showToast(`تمت إضافة ${added} منتج من الملفات`, 'success');
      // Re-calculate packing automatically
      debouncedCalculatePacking(150);
    }

    e.target.value = '';
  });
}

// ========================
// Auto Save
// ========================

function autoSave() {
  const config = getPackingConfig();
  ProjectsManager.saveCurrent({
    products: [...products],
    config,
    costConfig: getCostConfig(),
    result: currentResult
  });
}

function loadAutoSave() {
  const saved = ProjectsManager.loadCurrent();
  if (!saved) return;

  const settings = ProjectsManager.getSettings();
  const currentUnit = settings.unit || 'cm';
  const savedUnit = saved.config?.unit || 'cm';

  let factor = 1;
  if (savedUnit !== currentUnit) {
    if (savedUnit === 'mm' && currentUnit === 'cm') factor = 0.1;
    else if (savedUnit === 'cm' && currentUnit === 'mm') factor = 10;
    else if (savedUnit === 'mm' && currentUnit === 'inch') factor = 1 / 25.4;
    else if (savedUnit === 'inch' && currentUnit === 'mm') factor = 25.4;
    else if (savedUnit === 'cm' && currentUnit === 'inch') factor = 1 / 2.54;
    else if (savedUnit === 'inch' && currentUnit === 'cm') factor = 2.54;
  }

  try {
    if (saved.products && saved.products.length > 0) {
      products = saved.products.map(p => {
        const newP = { ...p };
        if (factor !== 1) {
          newP.w = parseFloat((newP.w * factor).toFixed(1));
          newP.h = parseFloat((newP.h * factor).toFixed(1));
          if (newP.bleedOverride != null) {
            newP.bleedOverride = parseFloat((newP.bleedOverride * factor).toFixed(2));
          }
        }
        return newP;
      });
      nextProductId = Math.max(...products.map(p => p.id || 0), 0) + 1;
    }

    if (saved.config) {
      const scale = (val) => {
        if (val == null || isNaN(val)) return val;
        return parseFloat((val * factor).toFixed(2));
      };

      setValue('paper-width', scale(saved.config.paperW));
      setValue('paper-height', scale(saved.config.paperH));
      setValue('bleed', scale(saved.config.bleed));
      setValue('gutter', scale(saved.config.gutter));
      setValue('safe-margin', scale(saved.config.safeMargin));
      setValue('paper-margin', scale(saved.config.paperMargin));
    }

    if (saved.costConfig) {
      setValue('cost-sheet', saved.costConfig.sheetCost);
      setValue('cost-print', saved.costConfig.printCost);
      setValue('cost-finish', saved.costConfig.finishCost);
      setValue('currency', saved.costConfig.currency);
    }

    if (saved.result) {
      currentResult = saved.result;
      if (factor !== 1) {
        setTimeout(() => {
          debouncedCalculatePacking(50);
        }, 50);
      } else {
        setTimeout(() => {
          showResults(saved.result, saved.config || getPackingConfig());
        }, 50);
      }
    }
  } catch (e) {
    console.warn('خطأ في تحميل الحفظ التلقائي:', e);
  }
}

// ========================
// إعادة تعيين
// ========================

function resetAll() {
  products = [];
  currentResult = null;
  currentProjectId = null;
  nextProductId = 1;
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('ai-advisor').style.display = 'none';
  renderProducts();
  ProjectsManager.clearCurrent();
  showToast('تم إعادة التعيين', 'info');
}

// ========================
// Modals
// ========================

function initModalClose() {
  // إغلاق بزر الإغلاق
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // إغلاق بالنقر على الـ overlay
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // إغلاق بـ Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
    }
  });
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// ========================
// Toast Notifications
// ========================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${getToastIcon(type)}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function getToastIcon(type) {
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  return icons[type] || 'ℹ';
}

// تصدير showToast عالمياً
window.AppUI = { showToast };

// ========================
// Loading
// ========================

function showLoading(show, text = '') {
  const overlay = document.getElementById('loading-overlay');
  const textEl = document.getElementById('loading-text');
  overlay.style.display = show ? 'flex' : 'none';
  if (text && textEl) textEl.textContent = text;
  if (!show) updateLoadingProgress(0, '');
}

function updateLoadingProgress(percent, text) {
  const bar = document.getElementById('loading-bar');
  const textEl = document.getElementById('loading-text');
  if (bar) bar.style.width = percent + '%';
  if (text && textEl) textEl.textContent = text;
}

// ========================
// Animation Helpers
// ========================

function animateCounter(elementId, targetValue, decimals = 0, suffix = '') {
  const el = document.getElementById(elementId);
  if (!el) return;

  const start = 0;
  const duration = 800;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (targetValue - start) * eased;
    el.textContent = current.toFixed(decimals) + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

// ========================
// Utility Functions
// ========================

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el && value !== undefined && value !== null) {
    el.value = value;
  }
}

function setChecked(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getUnitText() {
  const settings = ProjectsManager.getSettings();
  const unit = settings.unit || 'cm';
  if (unit === 'mm') return 'مم';
  if (unit === 'cm') return 'سم';
  if (unit === 'inch') return 'بوصة';
  if (unit === 'px') return 'بكسل';
  return unit;
}

function updateUILabels() {
  const unitText = getUnitText();
  document.querySelectorAll('.unit-text').forEach(el => {
    el.textContent = unitText;
  });
}

function convertValues(oldUnit, newUnit) {
  let factor = 1;
  if (oldUnit === 'mm' && newUnit === 'cm') factor = 0.1;
  else if (oldUnit === 'cm' && newUnit === 'mm') factor = 10;
  else if (oldUnit === 'mm' && newUnit === 'inch') factor = 1 / 25.4;
  else if (oldUnit === 'inch' && newUnit === 'mm') factor = 25.4;
  else if (oldUnit === 'cm' && newUnit === 'inch') factor = 1 / 2.54;
  else if (oldUnit === 'inch' && newUnit === 'cm') factor = 2.54;

  if (factor === 1) return;

  // Convert inputs
  const inputIds = [
    'paper-width', 'paper-height',
    'bleed', 'gutter', 'safe-margin', 'paper-margin',
    'product-width', 'product-height', 'product-bleed',
    'booklet-custom-w', 'booklet-custom-h',
    'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'margin-gutter'
  ];
  inputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value) {
      const val = parseFloat(el.value);
      if (!isNaN(val)) {
        el.value = (val * factor).toFixed(id.includes('bleed') || id.includes('margin') || id.includes('gutter') ? 2 : 1).replace(/\.0+$/, '');
      }
    }
  });

  // Convert products
  products.forEach(p => {
    p.w = parseFloat((p.w * factor).toFixed(1));
    p.h = parseFloat((p.h * factor).toFixed(1));
    if (p.bleedOverride != null) {
      p.bleedOverride = parseFloat((p.bleedOverride * factor).toFixed(2));
    }
  });

  // Convert paper presets
  document.querySelectorAll('#paper-presets .preset-btn').forEach(btn => {
    const w = parseFloat(btn.dataset.w);
    const h = parseFloat(btn.dataset.h);
    if (!isNaN(w) && !isNaN(h)) {
      btn.dataset.w = (w * factor).toFixed(1).replace(/\.0+$/, '');
      btn.dataset.h = (h * factor).toFixed(1).replace(/\.0+$/, '');
    }
    const name = btn.dataset.name;
    btn.textContent = `${getPresetLabel(name)} (${btn.dataset.w}×${btn.dataset.h})`;
  });

  // Convert product presets
  PRESET_PRODUCTS.forEach(p => {
    p.w = parseFloat((p.w * factor).toFixed(1));
    p.h = parseFloat((p.h * factor).toFixed(1));
  });

  // Scale product types buttons
  document.querySelectorAll('#product-types .type-btn').forEach(btn => {
    const w = parseFloat(btn.dataset.w);
    const h = parseFloat(btn.dataset.h);
    if (!isNaN(w) && !isNaN(h)) {
      btn.dataset.w = (w * factor).toFixed(1).replace(/\.0+$/, '');
      btn.dataset.h = (h * factor).toFixed(1).replace(/\.0+$/, '');
    }
  });

  renderProducts();
  if (currentResult) {
    debouncedCalculatePacking(150);
  }

  // Update Booklet Creator UI units if active
  if (window.BookletCreator && window.BookletCreator.updateBookletUnitUI) {
    window.BookletCreator.updateBookletUnitUI();
  }
}

// تصدير الدوال عالمياً للاستخدام في HTML
window.products = products;
window.editProduct = editProduct;
window.duplicateProduct = duplicateProduct;
window.deleteProduct = deleteProduct;
window.addPresetProduct = addPresetProduct;
window.loadProject = loadProject;
window.exportProject = exportProject;
window.confirmDeleteProject = confirmDeleteProject;
window.switchPage = switchPage;

function triggerProductImageUpload(id) {
  const fileInput = document.getElementById(`product-file-${id}`);
  if (fileInput) fileInput.click();
}

function dataURLToBlob(dataURL) {
  const parts = dataURL.split(',');
  const matches = parts[0].match(/:(.*?);/);
  const mime = matches ? matches[1] : 'image/png';
  const binary = atob(parts[1]);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}
window.dataURLToBlob = dataURLToBlob;

// imgBB API Key
const IMGBB_API_KEY = '75eb4c6508b17a12ffd19143a12fc257';

async function uploadToImgBB(file, filename) {
  const formData = new FormData();
  if (filename) {
    formData.append('image', file, filename);
  } else {
    formData.append('image', file);
  }
  try {
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (data.success) {
      return data.data.url;
    } else {
      return null;
    }
  } catch (e) {
    console.warn('imgBB upload failed:', e);
    return null;
  }
}
window.uploadToImgBB = uploadToImgBB;

async function handleProductImageUpload(id, input) {
  const file = input.files[0];
  if (!file) return;

  showToast('جاري معالجة وتجهيز التصميم...', 'info');

  try {
    const result = await FileReaderHelper.processFile(file);
    const product = products.find(p => p.id === id);
    if (!product) return;

    if (!result.imageSrc) {
      showToast('تعذر استخراج صورة من هذا الملف', 'error');
      return;
    }

    // Set local imageSrc immediately for fast preview (compressed)
    try {
      product.imageSrc = await compressImageDataUrl(result.imageSrc);
    } catch (e) {
      product.imageSrc = result.imageSrc;
    }
    const img = new Image();
    img.onload = async function() {
      product.image = img;
      renderProducts();
      if (currentResult) CanvasRenderer.render();
      autoSave();

      // Ask user to adjust dimensions
      const settings = ProjectsManager.getSettings();
      const unit = settings.unit || 'cm';
      let w = result.w;
      let h = result.h;
      if (unit === 'cm') { w = w / 10; h = h / 10; }
      else if (unit === 'inch') { w = w / 25.4; h = h / 25.4; }

      // Round to 2 decimals
      w = parseFloat(w.toFixed(2));
      h = parseFloat(h.toFixed(2));

      if (Math.abs(product.w - w) > 0.01 || Math.abs(product.h - h) > 0.01) {
        if (confirm(`هل تريد تعديل أبعاد المنتج لتطابق أبعاد الملف المرفوع (${w} × ${h} ${getUnitText()})؟`)) {
          product.w = w;
          product.h = h;
          renderProducts();
          debouncedCalculatePacking(150);
        }
      }
    };
    img.src = result.imageSrc;

    // Optional upload to imgBB if it's an image file (jpg, png)
    if (file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg')) {
      showToast('جاري رفع التصميم إلى السحابة...', 'info');
      const ownerId = ProjectsManager.getActiveOwnerId() || 'anonymous';
      const ext = file.name.split('.').pop() || 'png';
      const safeName = `${ownerId}_product_${id}_${Date.now()}.${ext}`;
      const url = await uploadToImgBB(file, safeName);
      if (url) {
        product.imageSrc = url;
        const img2 = new Image();
        img2.crossOrigin = 'anonymous';
        img2.onload = function() {
          product.image = img2;
          renderProducts();
          if (currentResult) CanvasRenderer.render();
          autoSave();
        };
        img2.src = url;
        showToast('تم رفع التصميم على imgBB بنجاح! ✅', 'success');
      }
    }
  } catch (err) {
    console.error('Error in handleProductImageUpload:', err);
    showToast('خطأ أثناء تحميل الملف: ' + err.message, 'error');
  }
}

function applySuggestedSize(productId, newW, newH) {
  const idx = products.findIndex(p => p.id === productId);
  if (idx !== -1) {
    products[idx].w = parseFloat(newW);
    products[idx].h = parseFloat(newH);
    renderProducts();
    debouncedCalculatePacking(150);
    showToast('تم تطبيق المقاس المقترح بنجاح!', 'success');
  }
}

function applySuggestedPaperSize(name, w, h) {
  const widthInput = document.getElementById('paper-width');
  const heightInput = document.getElementById('paper-height');
  if (widthInput && heightInput) {
    widthInput.value = w;
    heightInput.value = h;
    
    // ضبط الاتجاه المناسب للورقة تلقائياً
    const orientationSelect = document.getElementById('paper-orientation');
    if (orientationSelect) {
      orientationSelect.value = w > h ? 'landscape' : 'portrait';
    }

    // تنشيط الزر المناسب للـ Preset إن وجد
    const presets = document.querySelectorAll('#paper-presets .preset-btn');
    presets.forEach(btn => {
      if (btn.dataset.name === name || btn.dataset.w === w.toString() && btn.dataset.h === h.toString()) {
        presets.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });

    debouncedCalculatePacking(150);
    showToast(`تم تغيير مقاس الورقة إلى ${name || (w + '×' + h)}`, 'success');
  }
}

function applySuggestedGutter(val) {
  const gutterInput = document.getElementById('gutter');
  if (gutterInput) {
    gutterInput.value = val;
    debouncedCalculatePacking(150);
    showToast('تم ضبط المسافة بين العناصر!', 'success');
  }
}

function applySuggestedBleed(val) {
  const bleedInput = document.getElementById('bleed');
  if (bleedInput) {
    bleedInput.value = val;
    debouncedCalculatePacking(150);
    showToast('تم ضبط مسافة الهامش (Bleed) بنجاح!', 'success');
  }
}
window.triggerProductImageUpload = triggerProductImageUpload;
window.handleProductImageUpload = handleProductImageUpload;
window.applySuggestedSize = applySuggestedSize;
window.applySuggestedPaperSize = applySuggestedPaperSize;
window.applySuggestedGutter = applySuggestedGutter;
window.applySuggestedBleed = applySuggestedBleed;
