/**
 * اوتو رص - المساعد الذكي
 * Auto Rass - AI Advisor
 *
 * يحلل نتائج الرص ويعطي اقتراحات ذكية
 */

'use strict';

const AIAdvisor = (() => {

  /**
   * توليد الاقتراحات الذكية
   * @param {object} result - نتيجة الرص الحالية
   * @param {Array} comparisonResults - مقارنة أحجام الورق
   * @param {Array} products - قائمة المنتجات
   * @param {object} config - الإعدادات الحالية
   */
  async function generateSuggestions(result, comparisonResults, products, config) {
    const tips = [];

    if (!result) return tips;

    const { efficiency, waste, itemCount, sheetsNeeded, packed } = result;
    const { paperW, paperH, unit = 'سم' } = config;

    // ========================
    // 1. تحليل نسبة الهالك
    // ========================
    if (waste > 40) {
      tips.push({
        icon: '⚠️',
        type: 'warning',
        text: `نسبة الهالك مرتفعة (${waste.toFixed(1)}%). جرّب تغيير حجم الورقة أو ترتيب مختلف للمنتجات.`
      });
    } else if (waste < 15) {
      tips.push({
        icon: '✅',
        type: 'success',
        text: `ممتاز! نسبة استغلال ${efficiency.toFixed(1)}% - هذا رص احترافي جداً.`
      });
    }

    // ========================
    // 2. اقتراح حجم ورقة أفضل (مع إصلاح خلل المقارنة)
    // ========================
    if (comparisonResults && comparisonResults.length > 0) {
      const best = comparisonResults[0];
      const currentEff = efficiency;

      // مقارنة المقاسات الفعلية بدقة بدلاً من الاسم
      const isSameSize = Math.abs(best.w - paperW) < 0.1 && Math.abs(best.h - paperH) < 0.1;

      if (!isSameSize && best.efficiency > currentEff + 3) {
        const savingNum = best.sheetsNeeded < sheetsNeeded
          ? `ستوفر ${Math.abs(sheetsNeeded - best.sheetsNeeded)} ورقة`
          : `نسبة استغلال أعلى بـ ${(best.efficiency - currentEff).toFixed(1)}%`;

        tips.push({
          icon: '💡',
          type: 'paper-suggestion',
          paperName: best.name,
          w: best.w,
          h: best.h,
          text: `بالتحويل إلى حجم الورق "${best.name}" (${best.w}×${best.h} ${unit})، ستحصل على استغلال ${best.efficiency.toFixed(1)}% — ${savingNum}.`
        });
      }
    }

    // ========================
    // 3. مقترح تعديل المقاسات الذكي (تصغير بنسبة طفيفة لزيادة القطع أو توفير الأوراق)
    // ========================
    if (products && products.length > 0 && packed && packed.length > 0) {
      for (const prod of products) {
        // Yield to event loop to prevent browser freeze
        await new Promise(resolve => setTimeout(resolve, 0));

        // حساب كم قطعة من هذا المنتج في المخطط حالياً
        const currentFit = packed.filter(p => p.item.id === prod.id).length;
        // إذا كان التكرار التلقائي مفعلاً والمنتج لا يظهر إطلاقاً، نتخطاه
        if (config.autoRepeat && currentFit === 0) continue;

        // خطوات التصغير الدقيقة من 0.5% إلى 10%
        const scaleFactors = [0.995, 0.99, 0.985, 0.98, 0.975, 0.97, 0.96, 0.95, 0.94, 0.93, 0.92, 0.91, 0.90];
        const candidates = [];

        for (const scale of scaleFactors) {
          // اختبار ثلاثة خيارات: تصغير العرض فقط، تصغير الارتفاع فقط، أو كلاهما
          const variations = [
            { type: 'width', w: prod.w * scale, h: prod.h },
            { type: 'height', w: prod.w, h: prod.h * scale },
            { type: 'both', w: prod.w * scale, h: prod.h * scale }
          ];

          for (const v of variations) {
            // استبدال المنتج المستهدف بالمقاس الافتراضي الجديد في قائمة المنتجات الكلية
            const testProducts = products.map(p => {
              if (p.id === prod.id) {
                return {
                  ...p,
                  w: v.w,
                  h: v.h
                };
              }
              return p;
            });

            // محاكاة الرص باستخدام محرك الرص الأصلي
            const testResult = await PackingEngine.packQuantity(config, testProducts);
            if (testResult && !testResult.error) {
              if (config.autoRepeat) {
                // في حالة التكرار التلقائي: نقيس الفائدة بزيادة القطع الممكن رصها لهذا المنتج بالتحديد
                const newFit = testResult.packed ? testResult.packed.filter(p => p.item.id === prod.id).length : 0;
                const benefit = newFit - currentFit;
                if (benefit > 0) {
                  candidates.push({
                    scale,
                    type: v.type,
                    w: v.w,
                    h: v.h,
                    benefit,
                    newFit,
                    currentFit
                  });
                }
              } else {
                // في حالة كميات محددة: نقيس الفائدة بعدد الأوراق الإجمالية التي سيتم توفيرها
                const currentSheets = sheetsNeeded;
                const newSheets = testResult.sheetsNeeded || 0;
                const benefit = currentSheets - newSheets;
                if (benefit > 0) {
                  candidates.push({
                    scale,
                    type: v.type,
                    w: v.w,
                    h: v.h,
                    benefit,
                    newSheets,
                    currentSheets
                  });
                }
              }
            }
          }
        }

        if (candidates.length > 0) {
          // ترتيب الخيارات بناءً على:
          // 1. الفائدة الأعلى (عدد قطع أكثر أو أوراق أقل)
          // 2. نسبة التقليص الأقل (أقرب لـ 100%)
          // 3. تفضيل تعديل بعد واحد (عرض أو ارتفاع) على البعدين معاً
          candidates.sort((a, b) => {
            if (a.benefit !== b.benefit) {
              return b.benefit - a.benefit;
            }
            if (a.scale !== b.scale) {
              return b.scale - a.scale;
            }
            const typeScore = { 'width': 2, 'height': 2, 'both': 1 };
            return typeScore[b.type] - typeScore[a.type];
          });

          const bestChoice = candidates[0];
          const suggestedW = parseFloat(bestChoice.w.toFixed(3));
          const suggestedH = parseFloat(bestChoice.h.toFixed(3));
          const scalePct = parseFloat(((1 - bestChoice.scale) * 100).toFixed(1)).toString().replace(/\.0+$/, '');

          let suggestionText = '';
          if (config.autoRepeat) {
            if (bestChoice.type === 'width') {
              suggestionText = `تقليص عرض "${prod.name}" فقط بنسبة ${scalePct}% ليصبح ${suggestedW} × ${suggestedH} ${unit} (مع ثبات الارتفاع) يزيد القطع في الورقة من ${bestChoice.currentFit} إلى ${bestChoice.newFit} قطعة (زيادة ${bestChoice.benefit} قطع).`;
            } else if (bestChoice.type === 'height') {
              suggestionText = `تقليص ارتفاع "${prod.name}" فقط بنسبة ${scalePct}% ليصبح ${suggestedW} × ${suggestedH} ${unit} (مع ثبات العرض) يزيد القطع في الورقة من ${bestChoice.currentFit} إلى ${bestChoice.newFit} قطعة (زيادة ${bestChoice.benefit} قطع).`;
            } else {
              suggestionText = `تقليص مقاس "${prod.name}" بنسبة ${scalePct}% ليصبح ${suggestedW} × ${suggestedH} ${unit} يزيد القطع في الورقة من ${bestChoice.currentFit} إلى ${bestChoice.newFit} قطعة (زيادة ${bestChoice.benefit} قطع).`;
            }
          } else {
            if (bestChoice.type === 'width') {
              suggestionText = `تقليص عرض "${prod.name}" فقط بنسبة ${scalePct}% ليصبح ${suggestedW} × ${suggestedH} ${unit} (مع ثبات الارتفاع) يقلل عدد الأوراق المطلوبة من ${bestChoice.currentSheets} إلى ${bestChoice.newSheets} ${bestChoice.newSheets === 1 ? 'ورقة' : 'أوراق'} (توفير ${bestChoice.benefit} ${bestChoice.benefit === 1 ? 'ورقة' : 'أوراق'}).`;
            } else if (bestChoice.type === 'height') {
              suggestionText = `تقليص ارتفاع "${prod.name}" فقط بنسبة ${scalePct}% ليصبح ${suggestedW} × ${suggestedH} ${unit} (مع ثبات العرض) يقلل عدد الأوراق المطلوبة من ${bestChoice.currentSheets} إلى ${bestChoice.newSheets} ${bestChoice.newSheets === 1 ? 'ورقة' : 'أوراق'} (توفير ${bestChoice.benefit} ${bestChoice.benefit === 1 ? 'ورقة' : 'أوراق'}).`;
            } else {
              suggestionText = `تقليص مقاس "${prod.name}" بنسبة ${scalePct}% ليصبح ${suggestedW} × ${suggestedH} ${unit} يقلل عدد الأوراق المطلوبة من ${bestChoice.currentSheets} إلى ${bestChoice.newSheets} ${bestChoice.newSheets === 1 ? 'ورقة' : 'أوراق'} (توفير ${bestChoice.benefit} ${bestChoice.benefit === 1 ? 'ورقة' : 'أوراق'}).`;
            }
          }

          tips.push({
            icon: '💡',
            type: 'resize-suggestion',
            productId: prod.id,
            suggestedW,
            suggestedH,
            resizeType: bestChoice.type,
            scalePct,
            text: suggestionText
          });
        }
      }
    }

    // ========================
    // 4. اقتراح تدوير المنتجات
    // ========================
    if (packed) {
      const rotatedCount = packed.filter(p => p.rotated).length;
      const nonRotated = packed.filter(p => !p.rotated && p.item.canRotate);

      if (rotatedCount > 0) {
        tips.push({
          icon: '🔄',
          type: 'info',
          text: `تم تدوير ${rotatedCount} قطعة 90° لتحسين الرص. هذا يساعد على تقليل الهالك.`
        });
      }
    }

    // ========================
    // 5. اقتراح دمج المنتجات
    // ========================
    if (products && products.length > 1) {
      const smallProducts = products.filter(p => p.w * p.h < 5000);
      if (smallProducts.length > 0) {
        tips.push({
          icon: '🔗',
          type: 'info',
          text: `يمكن دمج ${smallProducts[0].name} مع منتجات أخرى في نفس الفرخة لتحسين الاستغلال.`
        });
      }
    }

    // ========================
    // 6. اقتراح تعديل Gutter
    // ========================
    const gutterThreshold = unit === 'سم' ? 0.8 : (unit === 'inch' ? 0.3 : 8);
    const gutterTarget = unit === 'سم' ? 0.5 : (unit === 'inch' ? 0.2 : 5);
    if (config.gutter > gutterThreshold) {
      tips.push({
        icon: '📏',
        type: 'gutter-suggestion',
        targetVal: gutterTarget,
        unit,
        text: `المسافة بين العناصر (Gutter) كبيرة (${config.gutter} ${unit}). تقليلها إلى ${gutterTarget} ${unit} سيزيد عدد القطع.`
      });
    }

    // ========================
    // 7. اقتراح تعديل Bleed
    // ========================
    const bleedThreshold = unit === 'سم' ? 0.5 : (unit === 'inch' ? 0.2 : 5);
    const bleedTarget = unit === 'سم' ? 0.3 : (unit === 'inch' ? 0.1 : 3);
    if (config.bleed > bleedThreshold) {
      tips.push({
        icon: '🖨️',
        type: 'bleed-suggestion',
        targetVal: bleedTarget,
        unit,
        text: `Bleed = ${config.bleed} ${unit} مرتفع للكروت الصغيرة. للطباعة التجارية ${bleedTarget} ${unit} كافية.`
      });
    }

    // ========================
    // 8. عدد الأوراق
    // ========================
    if (sheetsNeeded > 100) {
      tips.push({
        icon: '📦',
        type: 'info',
        text: `هذا الطلب يحتاج ${sheetsNeeded} ورقة. تأكد من توفر الكمية في المخزن.`
      });
    }

    // ========================
    // 9. توصية القص
    // ========================
    if (result.cutOrder && result.cutOrder.length > 0) {
      const hCuts = result.cutOrder.filter(c => c.type === 'horizontal').length;
      const vCuts = result.cutOrder.filter(c => c.type === 'vertical').length;
      tips.push({
        icon: '✂️',
        type: 'info',
        text: `ترتيب القص المقترح: ${hCuts} قطعة أفقية ثم ${vCuts} قطعة رأسية — مناسب لماكينة القص المستقيم.`
      });
    }

    return tips.slice(0, 6); // أقصى 6 اقتراحات
  }

  /**
   * إنشاء HTML للاقتراحات مع أزرار تفاعلية بالكامل
   */
  function renderSuggestions(tips) {
    if (!tips || tips.length === 0) return '';

    return tips.map(tip => {
      if (tip.type === 'resize-suggestion') {
        let btnText = `تطبيق المقاس المقترح (${tip.suggestedW} × ${tip.suggestedH})`;
        if (tip.resizeType === 'width') {
          btnText = `تطبيق تقليص العرض فقط (${tip.suggestedW} × ${tip.suggestedH})`;
        } else if (tip.resizeType === 'height') {
          btnText = `تطبيق تقليص الارتفاع فقط (${tip.suggestedW} × ${tip.suggestedH})`;
        }
        return `
          <div class="ai-tip ai-tip-info" style="display:flex; flex-direction:column; align-items:flex-start; gap:8px; padding:12px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="ai-tip-icon">${tip.icon}</span>
              <span style="font-weight:500;">${tip.text}</span>
            </div>
            <button class="btn btn-sm btn-primary" style="margin-right:28px; padding: 4px 12px; font-size: 0.75rem;" onclick="applySuggestedSize(${tip.productId}, ${tip.suggestedW}, ${tip.suggestedH})">
              ${btnText}
            </button>
          </div>
        `;
      }
      
      if (tip.type === 'paper-suggestion') {
        return `
          <div class="ai-tip ai-tip-info" style="display:flex; flex-direction:column; align-items:flex-start; gap:8px; padding:12px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="ai-tip-icon">${tip.icon}</span>
              <span style="font-weight:500;">${tip.text}</span>
            </div>
            <button class="btn btn-sm btn-primary" style="margin-right:28px; padding: 4px 12px; font-size: 0.75rem;" onclick="applySuggestedPaperSize('${tip.paperName}', ${tip.w}, ${tip.h})">
              تغيير حجم الورقة إلى "${tip.paperName}" (${tip.w} × ${tip.h})
            </button>
          </div>
        `;
      }

      if (tip.type === 'gutter-suggestion') {
        return `
          <div class="ai-tip ai-tip-tip" style="display:flex; flex-direction:column; align-items:flex-start; gap:8px; padding:12px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="ai-tip-icon">${tip.icon}</span>
              <span style="font-weight:500;">${tip.text}</span>
            </div>
            <button class="btn btn-sm btn-secondary" style="margin-right:28px; padding: 4px 12px; font-size: 0.75rem;" onclick="applySuggestedGutter(${tip.targetVal})">
              تطبيق تقليل المسافة بين العناصر (${tip.targetVal} ${tip.unit})
            </button>
          </div>
        `;
      }

      if (tip.type === 'bleed-suggestion') {
        return `
          <div class="ai-tip ai-tip-tip" style="display:flex; flex-direction:column; align-items:flex-start; gap:8px; padding:12px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="ai-tip-icon">${tip.icon}</span>
              <span style="font-weight:500;">${tip.text}</span>
            </div>
            <button class="btn btn-sm btn-secondary" style="margin-right:28px; padding: 4px 12px; font-size: 0.75rem;" onclick="applySuggestedBleed(${tip.targetVal})">
              ضبط الهامش (Bleed) إلى ${tip.targetVal} ${tip.unit}
            </button>
          </div>
        `;
      }

      return `
        <div class="ai-tip ai-tip-${tip.type || 'info'}">
          <span class="ai-tip-icon">${tip.icon}</span>
          <span>${tip.text}</span>
        </div>
      `;
    }).join('');
  }

  /**
   * اقتراح نص وصفي لأفضل حجم
   */
  function getBestSizeRecommendation(comparisonResults) {
    if (!comparisonResults || comparisonResults.length === 0) return null;
    const best = comparisonResults[0];
    const second = comparisonResults[1];

    if (!second) {
      return `الحجم ${best.name} هو الأمثل لهذه المنتجات بنسبة استغلال ${best.efficiency.toFixed(1)}%.`;
    }

    const diff = best.efficiency - second.efficiency;
    return `الحجم ${best.name} أفضل بنسبة ${diff.toFixed(1)}% من ${second.name}.`;
  }

  return {
    generateSuggestions,
    renderSuggestions,
    getBestSizeRecommendation
  };

})();

window.AIAdvisor = AIAdvisor;
