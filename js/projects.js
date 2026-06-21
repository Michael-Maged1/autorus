/**
 * اوتو رص - إدارة المشاريع سحابياً (Firebase Firestore)
 * Auto Rass - Projects Manager with Real-Time Firestore Sync
 */

'use strict';

const ProjectsManager = (() => {

  // ========================
  // ذاكرة التخزين المؤقت المحلية (Cache) والمستمعين
  // ========================

  let cachedProjects = [];
  let cachedSettings = getDefaultSettings();
  let cachedCurrent = null;
  
  let activeOwnerId = null;
  let activeOwnerType = null; // 'guest' | 'registered'
  
  let projectsUnsubscribe = null;
  let userDocUnsubscribe = null;
  let initialLoadDone = false;

  // ========================
  // الاتصال بقاعدة البيانات والتحقق
  // ========================

  function getDb() {
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
      return firebase.firestore();
    }
    return null;
  }

  function getAuth() {
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
      return firebase.auth();
    }
    return null;
  }

  // ========================
  // المزامنة الحية (onSnapshot)
  // ========================

  function startSync(ownerId, ownerType) {
    if (!ownerId || !ownerType) return;
    if (activeOwnerId === ownerId && activeOwnerType === ownerType) return;

    console.log(`[ProjectsManager] بدء المزامنة لـ ${ownerType}: ${ownerId}`);

    // إلغاء أي مستمعين سابقين لمنع تسرب البيانات وتكرارها
    if (projectsUnsubscribe) {
      projectsUnsubscribe();
      projectsUnsubscribe = null;
    }
    if (userDocUnsubscribe) {
      userDocUnsubscribe();
      userDocUnsubscribe = null;
    }

    activeOwnerId = ownerId;
    activeOwnerType = ownerType;
    initialLoadDone = false;

    const db = getDb();
    if (!db) {
      console.warn("[ProjectsManager] Firestore غير متوفر حالياً للمزامنة.");
      return;
    }

    // 1. مزامنة المشاريع التي يملكها هذا المستخدم أو الضيف
    if (ownerId) {
      projectsUnsubscribe = db.collection('projects')
        .where('ownerId', '==', ownerId)
        .onSnapshot(snapshot => {
          const newProjects = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            newProjects.push({
              id: doc.id,
              name: data.projectName || data.name || 'مشروع جديد',
              client: data.client || '',
              notes: data.notes || '',
              projectType: data.projectType || data.data?.projectType || 'packing',
              pagesCount: data.pagesCount || data.data?.pagesCount || 0,
              createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : new Date().toISOString(),
              updatedAt: data.updatedAt ? (data.updatedAt.toDate ? data.updatedAt.toDate().toISOString() : data.updatedAt) : new Date().toISOString(),
              paper: data.data?.paper || data.paper || {},
              printSettings: data.data?.printSettings || data.printSettings || {},
              costSettings: data.data?.costSettings || data.costSettings || {},
              products: data.data?.products || data.products || [],
              result: data.data?.result || data.result || null,
              booklet: data.data?.booklet || data.booklet || null
            });
          });

          // ترتيب المشاريع حسب تاريخ التعديل الأحدث
          newProjects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
          cachedProjects = newProjects;

          console.log(`[ProjectsManager] تم تحديث المشاريع سحابياً: ${cachedProjects.length} مشروع.`);

          // تحديث الواجهة تلقائياً
          if (window.renderProjects) {
            window.renderProjects();
          }
        }, err => {
          console.error("[ProjectsManager] خطأ أثناء تحديث المشاريع سحابياً:", err);
        });
    } else {
      cachedProjects = [];
      if (window.renderProjects) {
        window.renderProjects();
      }
    }

    // 2. مزامنة الإعدادات والحفظ التلقائي الحالي
    const collectionName = ownerType === 'registered' ? 'users' : 'guests';
    userDocUnsubscribe = db.collection(collectionName).doc(ownerId)
      .onSnapshot(doc => {
        if (doc.exists) {
          const data = doc.data();

          // تحديث بيانات الملف الشخصي في واجهة الإعدادات
          const nameInput = document.getElementById('user-settings-name');
          if (nameInput && data.name !== undefined && nameInput.value !== data.name) {
            nameInput.value = data.name || '';
          }
          const phoneInput = document.getElementById('user-settings-phone');
          if (phoneInput && data.phone !== undefined && phoneInput.value !== data.phone) {
            phoneInput.value = data.phone || '';
          }
          const emailInput = document.getElementById('user-settings-email');
          if (emailInput) {
            emailInput.value = data.email || (ownerType === 'registered' ? '' : 'زائر (بدون بريد)');
          }

          // الإعدادات والتفضيلات
          if (data.settings) {
            const oldUnit = cachedSettings.unit || 'cm';
            cachedSettings = { ...getDefaultSettings(), ...data.settings };
            const newUnit = cachedSettings.unit || 'cm';
            
            // تطبيق الثيم تلقائياً عند مزامنته
            if (cachedSettings.theme) {
              const body = document.body;
              if (body) {
                body.classList.remove('light-mode', 'dark-mode');
                body.classList.add(cachedSettings.theme === 'dark' ? 'dark-mode' : 'light-mode');
              }
              localStorage.setItem('theme', cachedSettings.theme);
            }

            // مزامنة حقول الإعدادات في لوحة التحكم إن كانت مفتوحة
            const unitSelect = document.getElementById('unit-select');
            if (unitSelect && unitSelect.value !== cachedSettings.unit) {
              unitSelect.value = cachedSettings.unit;
            }

            if (window.updateUILabels) {
              window.updateUILabels();
            }

            // تحويل قيم المدخلات الافتراضية إذا تغيرت وحدة القياس عند التحميل لأول مرة ولم يكن هناك حفظ تلقائي للمشروع
            if (oldUnit !== newUnit && !data.current && window.convertValues) {
              window.convertValues(oldUnit, newUnit);
            }

            const qualitySelect = document.getElementById('canvas-quality');
            if (qualitySelect && qualitySelect.value !== String(cachedSettings.canvasQuality)) {
              qualitySelect.value = String(cachedSettings.canvasQuality);
            }
            const algoSelect = document.getElementById('algo-select');
            if (algoSelect && algoSelect.value !== cachedSettings.algorithm) {
              algoSelect.value = cachedSettings.algorithm;
            }
            const iterationsSelect = document.getElementById('iterations-select');
            if (iterationsSelect && iterationsSelect.value !== String(cachedSettings.iterations)) {
              iterationsSelect.value = String(cachedSettings.iterations);
            }
            const exportDpi = document.getElementById('export-dpi');
            if (exportDpi && exportDpi.value !== String(cachedSettings.exportDPI)) {
              exportDpi.value = String(cachedSettings.exportDPI);
            }
            if (window.applyPaperPresets) {
              window.applyPaperPresets();
            }
          }

          // الحفظ التلقائي لمساحة العمل
          if (data.current) {
            cachedCurrent = data.current;
            // استرداد الحفظ التلقائي فقط في أول تحميل للصفحة
            if (!initialLoadDone) {
              initialLoadDone = true;
              if (window.loadAutoSave) {
                window.loadAutoSave();
              }
            }
          } else {
            cachedCurrent = null;
            initialLoadDone = true;
          }
        } else {
          initialLoadDone = true;
        }
      }, err => {
        console.error("[ProjectsManager] خطأ أثناء تحديث وثيقة العميل سحابياً:", err);
      });
  }

  // إعداد مستمع التغيرات في المصادقة
  function setupAuthListener() {
    const checkFirebaseAndAuth = () => {
      const auth = getAuth();
      if (auth) {
        auth.onAuthStateChanged(user => {
          if (user) {
            startSync(user.uid, 'registered');
          } else {
            let guestId = localStorage.getItem("guestId");
            if (guestId) {
              startSync(guestId, 'guest');
            } else {
              const interval = setInterval(() => {
                guestId = localStorage.getItem("guestId");
                if (guestId) {
                  clearInterval(interval);
                  startSync(guestId, 'guest');
                }
              }, 100);
            }
          }
        });
        return true;
      }
      return false;
    };

    if (!checkFirebaseAndAuth()) {
      const interval = setInterval(() => {
        if (checkFirebaseAndAuth()) {
          clearInterval(interval);
        }
      }, 200);
    }
  }

  // تشغيل التهيئة
  setupAuthListener();

  // ========================
  // تنظيف البيانات لـ Firestore (منع أخطاء HTMLImageElement وغيرها)
  // ========================

  function sanitizeForFirestore(val) {
    if (val === null || val === undefined) {
      return val;
    }
    
    // التحقق من كونه عنصر صورة أو عنصر DOM
    if (typeof window !== 'undefined') {
      if (window.HTMLImageElement && val instanceof window.HTMLImageElement) {
        return undefined;
      }
      if (window.HTMLElement && val instanceof window.HTMLElement) {
        return undefined;
      }
    }
    if (val.nodeType && val.nodeName) {
      return undefined;
    }
    
    // التحقق من كونه عنصر صورة بالمنشئ
    if (val.constructor && val.constructor.name === 'HTMLImageElement') {
      return undefined;
    }
    
    if (Array.isArray(val)) {
      return val.map(sanitizeForFirestore).filter(v => v !== undefined);
    }
    
    if (typeof val === 'object') {
      // الاحتفاظ بـ Firestore Timestamps والتواريخ
      if (typeof val.toDate === 'function' || val instanceof Date) {
        return val;
      }
      if (typeof firebase !== 'undefined' && firebase.firestore) {
        if (val instanceof firebase.firestore.FieldValue) {
          return val;
        }
        if (val.constructor && (val.constructor.name === 'Timestamp' || val.constructor.name === 'DocumentReference' || val.constructor.name === 'GeoPoint')) {
          return val;
        }
      }
      
      const cleanObj = {};
      for (const key in val) {
        if (Object.prototype.hasOwnProperty.call(val, key)) {
          const cleaned = sanitizeForFirestore(val[key]);
          if (cleaned !== undefined) {
            cleanObj[key] = cleaned;
          }
        }
      }
      return cleanObj;
    }
    
    return val;
  }

  // ========================
  // CRUD المشاريع (Firestore)
  // ========================

  function getProjects() {
    return cachedProjects;
  }

  function createProject(data) {
    const id = 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    const projectDoc = {
      ownerId: activeOwnerId || 'anonymous',
      ownerType: activeOwnerType || 'guest',
      projectName: data.name || 'مشروع جديد',
      client: data.client || '',
      notes: data.notes || '',
      projectType: data.projectType || 'packing',
      pagesCount: data.pagesCount || 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      data: {
        paper: data.paper || {},
        printSettings: data.printSettings || {},
        costSettings: data.costSettings || {},
        products: data.products || [],
        result: data.result || null,
        booklet: data.booklet || null
      }
    };

    const db = getDb();
    if (db && activeOwnerId) {
      db.collection('projects').doc(id).set(sanitizeForFirestore(projectDoc))
        .then(() => {
          if (window.ProtectionSystem && window.ProtectionSystem.incrementLimit) {
            window.ProtectionSystem.incrementLimit('projectsCreated');
          }
        })
        .catch(e => console.error("Error creating project in Firestore:", e));
    }

    // إرجاع تمثيل المشروع محلياً فوراً للواجهة
    return {
      id,
      name: projectDoc.projectName,
      client: projectDoc.client,
      notes: projectDoc.notes,
      projectType: projectDoc.projectType,
      pagesCount: projectDoc.pagesCount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...projectDoc.data
    };
  }

  function updateProject(id, updates) {
    const db = getDb();
    if (!db) return null;

    const projectUpdates = {
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (updates.name !== undefined) projectUpdates.projectName = updates.name;
    if (updates.client !== undefined) projectUpdates.client = updates.client;
    if (updates.notes !== undefined) projectUpdates.notes = updates.notes;
    if (updates.projectType !== undefined) projectUpdates.projectType = updates.projectType;
    if (updates.pagesCount !== undefined) projectUpdates.pagesCount = updates.pagesCount;

    // تجميع الحقول الداخلية للمشروع
    const existing = cachedProjects.find(p => p.id === id) || {};
    const dataField = {};
    dataField.paper = updates.paper !== undefined ? updates.paper : existing.paper || {};
    dataField.printSettings = updates.printSettings !== undefined ? updates.printSettings : existing.printSettings || {};
    dataField.costSettings = updates.costSettings !== undefined ? updates.costSettings : existing.costSettings || {};
    dataField.products = updates.products !== undefined ? updates.products : existing.products || [];
    dataField.result = updates.result !== undefined ? updates.result : existing.result || null;
    dataField.booklet = updates.booklet !== undefined ? updates.booklet : existing.booklet || null;

    projectUpdates.data = dataField;

    db.collection('projects').doc(id).update(sanitizeForFirestore(projectUpdates))
      .catch(e => console.error("Error updating project in Firestore:", e));

    return {
      id,
      name: projectUpdates.projectName || existing.name,
      client: projectUpdates.client !== undefined ? projectUpdates.client : existing.client,
      notes: projectUpdates.notes !== undefined ? projectUpdates.notes : existing.notes,
      projectType: projectUpdates.projectType !== undefined ? projectUpdates.projectType : existing.projectType,
      pagesCount: projectUpdates.pagesCount !== undefined ? projectUpdates.pagesCount : existing.pagesCount,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...dataField
    };
  }

  function deleteProject(id) {
    const db = getDb();
    if (db) {
      db.collection('projects').doc(id).delete()
        .catch(e => console.error("Error deleting project in Firestore:", e));
    }
    cachedProjects = cachedProjects.filter(p => p.id !== id);
    return cachedProjects;
  }

  function getProject(id) {
    return cachedProjects.find(p => p.id === id) || null;
  }

  // ========================
  // الإعدادات والتفضيلات (Firestore)
  // ========================

  function getSettings() {
    return cachedSettings;
  }

  function saveSettings(settings) {
    cachedSettings = { ...cachedSettings, ...settings };
    
    const db = getDb();
    if (db && activeOwnerId && activeOwnerType) {
      const collectionName = activeOwnerType === 'registered' ? 'users' : 'guests';
      db.collection(collectionName).doc(activeOwnerId).set(sanitizeForFirestore({
        settings: cachedSettings
      }), { merge: true })
      .catch(e => console.error("Error saving settings to Firestore:", e));
    }
    if (window.applyPaperPresets) {
      window.applyPaperPresets();
    }
    return true;
  }

  function saveProfile(profileData) {
    const db = getDb();
    if (db && activeOwnerId && activeOwnerType) {
      const collectionName = activeOwnerType === 'registered' ? 'users' : 'guests';
      db.collection(collectionName).doc(activeOwnerId).set(sanitizeForFirestore(profileData), { merge: true })
      .catch(e => console.error("Error saving profile to Firestore:", e));
    }
    return true;
  }

  function getDefaultSettings() {
    let savedTheme = 'light';
    try {
      savedTheme = localStorage.getItem('theme') || 'light';
    } catch (e) {
      console.error(e);
    }
    return {
      theme: savedTheme,
      unit: 'cm',
      algorithm: 'auto',
      iterations: 500,
      canvasQuality: 2,
      exportDPI: 300,
      currency: 'ج.م'
    };
  }

  // ========================
  // الحفظ التلقائي الحالي (Firestore)
  // ========================

  function saveCurrent(state) {
    cachedCurrent = {
      ...state,
      savedAt: new Date().toISOString()
    };

    const db = getDb();
    if (db && activeOwnerId && activeOwnerType) {
      const collectionName = activeOwnerType === 'registered' ? 'users' : 'guests';
      db.collection(collectionName).doc(activeOwnerId).set(sanitizeForFirestore({
        current: cachedCurrent
      }), { merge: true })
      .catch(e => console.error("Error auto-saving state to Firestore:", e));
    }
  }

  function loadCurrent() {
    return cachedCurrent;
  }

  function clearCurrent() {
    cachedCurrent = null;

    const db = getDb();
    if (db && activeOwnerId && activeOwnerType) {
      const collectionName = activeOwnerType === 'registered' ? 'users' : 'guests';
      db.collection(collectionName).doc(activeOwnerId).update({
        current: firebase.firestore.FieldValue.delete()
      })
      .catch(e => console.error("Error clearing auto-save state in Firestore:", e));
    }
  }

  // ========================
  // استيراد وتصدير (سحابي)
  // ========================

  function exportAll() {
    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      projects: cachedProjects,
      settings: cachedSettings
    };
    return JSON.stringify(data, null, 2);
  }

  function importAll(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data.projects || !Array.isArray(data.projects)) {
        return { error: 'ملف غير صالح' };
      }

      const db = getDb();
      if (!db || !activeOwnerId) {
        return { error: 'قاعدة البيانات غير متوفرة حالياً' };
      }

      const imported = data.projects || [];
      const batch = db.batch();
      let count = 0;

      const existingIds = new Set(cachedProjects.map(p => p.id));

      imported.forEach(p => {
        if (!existingIds.has(p.id)) {
          const docId = p.id || ('proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
          const docRef = db.collection('projects').doc(docId);
          
          batch.set(docRef, {
            ownerId: activeOwnerId,
            ownerType: activeOwnerType || 'guest',
            projectName: p.name || 'مشروع مستورد',
            client: p.client || '',
            notes: p.notes || '',
            createdAt: p.createdAt ? new Date(p.createdAt) : firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: p.updatedAt ? new Date(p.updatedAt) : firebase.firestore.FieldValue.serverTimestamp(),
            data: {
              paper: p.paper || {},
              printSettings: p.printSettings || {},
              costSettings: p.costSettings || {},
              products: p.products || [],
              result: p.result || null
            }
          });
          count++;
        }
      });

      if (count > 0) {
        batch.commit().catch(e => console.error("Error importing projects batch:", e));
      }

      if (data.settings) {
        saveSettings({ ...cachedSettings, ...data.settings });
      }

      return { success: true, count: count };
    } catch (e) {
      return { error: 'خطأ في تحليل الملف: ' + e.message };
    }
  }

  function clearAll() {
    const db = getDb();
    if (db && activeOwnerId) {
      db.collection('projects').where('ownerId', '==', activeOwnerId).get()
        .then(snapshot => {
          const batch = db.batch();
          snapshot.forEach(doc => {
            batch.delete(doc.ref);
          });
          return batch.commit();
        })
        .catch(e => console.error("Error clearing projects in Firestore:", e));
      
      clearCurrent();
    }
    return true;
  }

  // ========================
  // تنسيق التاريخ
  // ========================

  function formatDate(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return isoString;
    }
  }

  function getActiveOwnerId() {
    return activeOwnerId;
  }

  return {
    getProjects,
    createProject,
    updateProject,
    deleteProject,
    getProject,
    getSettings,
    saveSettings,
    saveProfile,
    getDefaultSettings,
    saveCurrent,
    loadCurrent,
    clearCurrent,
    exportAll,
    importAll,
    clearAll,
    formatDate,
    startSync, // للتصدير والتشغيل اليدوي إن لزم الأمر
    sanitizeForFirestore,
    getActiveOwnerId
  };

})();

window.ProjectsManager = ProjectsManager;
