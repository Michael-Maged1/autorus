/**
 * اوتو رص - حاسبة التكلفة
 * Auto Rass - Cost Calculator
 */

'use strict';

const CostCalculator = (() => {

  /**
   * حساب التكلفة الكاملة
   * @param {object} packResult - نتيجة الرص
   * @param {object} costConfig - إعدادات التكلفة
   * @param {Array} products - المنتجات
   */
  function calculate(packResult, costConfig, products) {
    if (!packResult || packResult.error) return null;

    const {
      sheetsNeeded = 1,
      itemCount = 0,
      efficiency = 0
    } = packResult;

    const {
      sheetCost = 0,      // سعر الفرخ
      printCost = 0,      // تكلفة الطباعة (ثابتة)
      finishCost = 0,     // تكلفة التشطيب (ثابتة)
      currency = 'ج.م'
    } = costConfig;

    // إجمالي الأوراق
    const totalSheets = sheetsNeeded;

    // تكلفة الورق
    const paperCostTotal = totalSheets * sheetCost;

    // تكلفة الهالك
    const wasteFraction = (100 - efficiency) / 100;
    const wasteCost = paperCostTotal * wasteFraction;

    // تكلفة الطباعة لكل ورقة
    const printCostTotal = printCost; // ثابتة للوظيفة كلها (setup cost)

    // تكلفة التشطيب
    const finishCostTotal = finishCost;

    // الإجمالي
    const grandTotal = paperCostTotal + printCostTotal + finishCostTotal;

    // حساب إجمالي القطع
    let totalPieces = 0;
    for (const prod of products) {
      totalPieces += (prod.qty || 1);
    }

    // تكلفة القطعة
    const costPerPiece = totalPieces > 0 ? grandTotal / totalPieces : 0;

    return {
      currency,
      totalSheets,
      totalPieces,
      paperCostTotal,
      printCostTotal,
      finishCostTotal,
      wasteCost,
      grandTotal,
      costPerPiece,
      efficiency,
      wastePercent: 100 - efficiency
    };
  }

  /**
   * تنسيق مبلغ مالي
   */
  function formatCurrency(amount, currency = 'ج.م') {
    const formatted = new Intl.NumberFormat('ar-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
    return `${formatted} ${currency}`;
  }

  /**
   * إنشاء HTML لبطاقات التكلفة
   */
  function renderCostGrid(costResult) {
    if (!costResult) return '';

    const { currency } = costResult;
    const fmt = (n) => formatCurrency(n, currency);

    const items = [
      {
        label: 'إجمالي التكلفة',
        value: fmt(costResult.grandTotal),
        highlight: true,
        icon: '💰'
      },
      {
        label: 'تكلفة القطعة',
        value: fmt(costResult.costPerPiece),
        icon: '🏷️'
      },
      {
        label: 'تكلفة الورق',
        value: fmt(costResult.paperCostTotal),
        sub: `${costResult.totalSheets} ورقة`,
        icon: '📄'
      },
      {
        label: 'تكلفة الطباعة',
        value: fmt(costResult.printCostTotal),
        icon: '🖨️'
      },
      {
        label: 'تكلفة التشطيب',
        value: fmt(costResult.finishCostTotal),
        icon: '✨'
      },
      {
        label: 'تكلفة الهالك',
        value: fmt(costResult.wasteCost),
        sub: `${costResult.wastePercent.toFixed(1)}% من الورق`,
        icon: '♻️',
        warning: costResult.wastePercent > 30
      }
    ];

    return items.map(item => `
      <div class="cost-item ${item.highlight ? 'highlight-card' : ''} ${item.warning ? 'warning-card' : ''}">
        <span class="cost-item-icon">${item.icon}</span>
        <span class="cost-item-label">${item.label}</span>
        <span class="cost-item-value ${item.highlight ? 'highlight' : ''}">${item.value}</span>
        ${item.sub ? `<span class="cost-item-sub">${item.sub}</span>` : ''}
      </div>
    `).join('');
  }

  return {
    calculate,
    formatCurrency,
    renderCostGrid
  };

})();

window.CostCalculator = CostCalculator;
