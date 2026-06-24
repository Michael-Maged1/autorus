/**
 * اوتو رص - نظام الحماية والاشتراكات والترخيص المطور
 * Auto Rass - Advanced Protection, Authentication & Manual Subscription System
 */

'use strict';

const ProtectionSystem = (() => {

  const firebaseConfig = {
    apiKey: "AIzaSyA8YW6wxMhhj9JWT_1hItCvkAwRC_xMGxo",
    authDomain: "auto-rus-2c07a.firebaseapp.com",
    projectId: "auto-rus-2c07a",
    storageBucket: "auto-rus-2c07a.firebasestorage.app",
    messagingSenderId: "390965343469",
    appId: "1:390965343469:web:928befc4f5aa388b4c08e4",
    measurementId: "G-6TWT6G67B4"
  };

  let db = null;
  let auth = null;
  let isFirebaseAvailable = false;

  const state = {
    deviceId: null,
    fingerprint: null,
    guestId: null,
    userId: null,
    email: null,
    name: null,
    status: 'trial',      // 'trial' | 'expired' | 'paid' | 'blocked'
    plan: 'free',         // 'free' | 'paid'
    trialStart: null,
    trialExpires: null,
    isPaid: false,
    subscriptionEnd: null,
    isBlocked: false,
    userType: 'guest',    // 'guest' | 'registered'
    isLoaded: false
  };

  let sessionClaimed = false;
  let activeHeartbeatInterval = null;
  let activeCoupon = null;

  const ADMIN_EMAILS = ['admin@autorass.com', 'Michaelmm@gmail.com'];
  const ADMIN_UIDS = []; // أضف الـ UID الحقيقي هنا من Firebase Console

  const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
  const CACHE_KEY = 'autorass_lic_session_cache';

  /**
   * حساب البصمة كعملية غير معطلة للتحميل
   */
  async function calculateFingerprintAsync() {
    // 1. Try to load FingerprintJS dynamically if not present
    let fpJsVisitorId = '';
    try {
      if (!window.FingerprintJS) {
        await new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@4/dist/fp.min.js';
          script.onload = () => resolve();
          script.onerror = () => resolve();
          document.head.appendChild(script);
        });
      }
      if (window.FingerprintJS) {
        const fp = await window.FingerprintJS.load();
        const result = await fp.get();
        fpJsVisitorId = result.visitorId;
      }
    } catch (e) {
      console.warn("FingerprintJS loading failed:", e);
    }

    // 2. Gather custom fingerprint elements safely (individual try-catch per element)
    const data = [];
    
    // User Agent
    try { data.push(navigator.userAgent || ''); } catch (e) {}
    
    // Screen Resolution
    try { data.push((screen.width || 0) + 'x' + (screen.height || 0) + 'x' + (screen.colorDepth || 0)); } catch (e) {}
    
    // Timezone
    try { data.push(new Date().getTimezoneOffset()); } catch (e) {}
    
    // Language
    try { data.push(navigator.language || ''); } catch (e) {}
    
    // Platform
    try { data.push(navigator.platform || ''); } catch (e) {}
    
    // Canvas Fingerprint
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = "top";
        ctx.font = "14px 'Arial'";
        ctx.fillStyle = "#f60";
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = "#069";
        ctx.fillText("AutoRassSecureFingerprint!", 2, 15);
        ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
        ctx.fillText("AutoRassSecureFingerprint!", 4, 17);
        data.push(canvas.toDataURL());
      }
    } catch (e) {
      console.warn("Canvas fingerprint gathering failed (anti-fingerprinting active?):", e);
    }
    
    // WebGL Fingerprint
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          data.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
          data.push(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
        }
      }
    } catch (e) {
      console.warn("WebGL fingerprint gathering failed:", e);
    }

    // Browser Features
    try {
      const features = [
        'indexedDB' in window ? 1 : 0,
        'localStorage' in window ? 1 : 0,
        'sessionStorage' in window ? 1 : 0,
        'cookieEnabled' in navigator ? 1 : 0,
        'WebGLRenderingContext' in window ? 1 : 0,
        'requestIdleCallback' in window ? 1 : 0,
        'serviceWorker' in navigator ? 1 : 0,
        'devicePixelRatio' in window ? window.devicePixelRatio : 1
      ];
      data.push(features.join(','));
    } catch (e) {}

    // Add FingerprintJS Visitor ID if available
    if (fpJsVisitorId) {
      data.push(fpJsVisitorId);
    }

    // 3. Persistent LocalStorage Fallback:
    // This ensures that even if Brave or other browsers block/randomize canvas or WebGL elements,
    // the generated hash remains completely stable across page refreshes.
    let persistentFallback = '';
    try {
      persistentFallback = localStorage.getItem('autorass_fp_fallback');
      if (!persistentFallback) {
        persistentFallback = 'fp_fallback_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
        localStorage.setItem('autorass_fp_fallback', persistentFallback);
      }
    } catch (lsErr) {
      // If localStorage is completely blocked (e.g. cookies disabled), fallback to a session random value
      persistentFallback = 'session_fallback_' + Math.random().toString(36).substring(2, 15);
    }
    data.push(persistentFallback);

    return hashString(data.join('|'));
  }

  function hashString(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334903);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }

  function generateUUID() {
    return 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
  }

  async function syncDeviceFingerprint() {
    if (!isFirebaseAvailable || !db || !state.fingerprint) return null;
    
    try {
      const docRef = db.collection('deviceFingerprints').doc(state.fingerprint);
      const docSnap = await docRef.get();
      const now = new Date();
      
      if (docSnap.exists) {
        const data = docSnap.data();
        
        // Update lastVisit
        await docRef.update({
          lastVisit: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        let status = data.status || 'trial';
        const trialEnd = data.trialEnd ? (data.trialEnd.toDate ? data.trialEnd.toDate() : new Date(data.trialEnd)) : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
        
        if (status === 'trial' && Date.now() > trialEnd.getTime()) {
          status = 'expired';
          await docRef.update({ status: 'expired' });
        }
        
        return {
          visitorId: state.fingerprint,
          trialStart: data.trialStart ? (data.trialStart.toDate ? data.trialStart.toDate().getTime() : new Date(data.trialStart).getTime()) : Date.now(),
          trialEnd: trialEnd.getTime(),
          status: status,
          projectsCreated: data.projectsCreated || 0,
          pdfExports: data.pdfExports || 0,
          nestingOperations: data.nestingOperations || 0
        };
      } else {
        // Create new device trial document
        const trialDays = 7;
        const trialEnd = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
        const newDeviceRecord = {
          visitorId: state.fingerprint,
          firstVisit: firebase.firestore.FieldValue.serverTimestamp(),
          trialStart: firebase.firestore.FieldValue.serverTimestamp(),
          trialEnd: trialEnd,
          status: 'trial',
          projectsCreated: 0,
          pdfExports: 0,
          nestingOperations: 0,
          lastVisit: firebase.firestore.FieldValue.serverTimestamp()
        };
        await docRef.set(newDeviceRecord);
        return {
          visitorId: state.fingerprint,
          trialStart: Date.now(),
          trialEnd: trialEnd.getTime(),
          status: 'trial',
          projectsCreated: 0,
          pdfExports: 0,
          nestingOperations: 0
        };
      }
    } catch (e) {
      console.warn("Failed to sync device fingerprints:", e);
      return null;
    }
  }

  async function incrementLimit(field) {
    if (!state.fingerprint) return;
    if (!isFirebaseAvailable || !db) return;
    try {
      const docRef = db.collection('deviceFingerprints').doc(state.fingerprint);
      const updateData = {
        lastVisit: firebase.firestore.FieldValue.serverTimestamp()
      };
      updateData[field] = firebase.firestore.FieldValue.increment(1);
      await docRef.update(updateData);
      console.log(`[ProtectionSystem] Incremented ${field} in deviceFingerprints`);
    } catch (e) {
      console.warn(`[ProtectionSystem] Failed to increment ${field}:`, e);
    }
  }

  /**
   * تحميل وحفظ الكاش في sessionStorage لتجنب الطلبات المتكررة
   */
  function saveToCache() {
    try {
      const cacheData = {
        state: { ...state },
        timestamp: Date.now()
      };
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (e) {
      console.warn("Failed to write to sessionStorage cache:", e);
    }
  }

  function loadFromCache() {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const cacheData = JSON.parse(cached);
        // صلاحية الكاش 10 دقائق لضمان تطبيق الحجب بسرعة
        if (Date.now() - cacheData.timestamp < 600 * 1000 && cacheData.state && cacheData.state.status) {
          Object.assign(state, cacheData.state);
          return true;
        }
      }
    } catch (e) {
      console.warn("Failed to read sessionStorage cache:", e);
    }
    return false;
  }

  async function fetchLocationData() {
    try {
      const response = await fetch('https://ipapi.co/json/');
      if (response.ok) {
        const data = await response.json();
        if (data && !data.error) {
          return {
            ip: data.ip || '',
            city: data.city || '',
            region: data.region || '',
            country: data.country_name || '',
            countryCode: data.country_code || '',
            latitude: data.latitude || null,
            longitude: data.longitude || null,
            timezone: data.timezone || '',
            org: data.org || '',
            updatedAt: new Date().toISOString()
          };
        }
      }
    } catch (e) {
      console.warn("ipapi.co failed, trying fallback:", e);
    }

    try {
      const response = await fetch('https://freeipapi.com/api/json');
      if (response.ok) {
        const data = await response.json();
        return {
          ip: data.ipAddress || '',
          city: data.cityName || '',
          region: data.regionName || '',
          country: data.countryName || '',
          countryCode: data.countryCode || '',
          latitude: data.latitude || null,
          longitude: data.longitude || null,
          timezone: data.timeZone || '',
          org: '',
          updatedAt: new Date().toISOString()
        };
      }
    } catch (e) {
      console.warn("freeipapi.com failed:", e);
    }

    return null;
  }

  async function updateLastActive() {
    if (!isFirebaseAvailable || !db) return;
    try {
      const isRegistered = auth && auth.currentUser;
      const id = isRegistered ? auth.currentUser.uid : state.guestId;
      const collectionName = isRegistered ? 'users' : 'guests';
      if (!id) return;

      if (document.visibilityState !== 'visible') return;

      const docRef = db.collection(collectionName).doc(id);
      
      const updateData = {
        lastActive: firebase.firestore.FieldValue.serverTimestamp()
      };

      const sessionKey = `autorass_loc_fetched_${id}`;
      let loc = null;
      if (!sessionStorage.getItem(sessionKey)) {
        try {
          loc = await fetchLocationData();
          if (loc) {
            updateData.locationInfo = loc;
            state.locationInfo = loc;
            sessionStorage.setItem(sessionKey, 'true');
          }
        } catch (e) {
          console.warn("Failed to check or fetch location:", e);
        }
      }

      if (isRegistered && state.deviceId) {
        // Update specific device in activeDevices map using nested dot notation
        const devPath = `activeDevices.${state.deviceId}`;
        updateData[`${devPath}.lastActive`] = firebase.firestore.FieldValue.serverTimestamp();
        updateData[`${devPath}.userAgent`] = navigator.userAgent;
        if (loc || state.locationInfo) {
          const locationToSave = loc || state.locationInfo;
          updateData[`${devPath}.ip`] = locationToSave.ip || '';
          updateData[`${devPath}.city`] = locationToSave.city || '';
          updateData[`${devPath}.country`] = locationToSave.country || '';
          updateData[`${devPath}.countryCode`] = locationToSave.countryCode || '';
        }
        await docRef.update(updateData);
      } else {
        await docRef.set(updateData, { merge: true });
      }
      console.log(`Updated activity status (lastActive) for ${collectionName}/${id}`);
    } catch (e) {
      console.warn("Failed to update active status:", e);
    }
  }

  function startActiveHeartbeat() {
    if (activeHeartbeatInterval) clearInterval(activeHeartbeatInterval);
    updateLastActive();
    activeHeartbeatInterval = setInterval(updateLastActive, 120000);
  }

  /**
   * تهيئة الحماية - لا تعطل معالجة الصفحة أبداً
   */
  async function init() {
    // 1. فحص كاش الجلسة أولاً للاستجابة الفورية
    const hasCache = loadFromCache();
    
    // 2. تحميل بصمة ومعرف الجهاز بالخلفية
    state.fingerprint = await calculateFingerprintAsync();
    state.deviceId = localStorage.getItem('autorass_device_id');
    if (!state.deviceId) {
      state.deviceId = generateUUID();
      localStorage.setItem('autorass_device_id', state.deviceId);
    }

    // 3. التأكد من وجود معرف الزائر في المتصفح
    let guestId = localStorage.getItem("guestId");
    if (!guestId) {
      guestId = generateGuestId();
      localStorage.setItem("guestId", guestId);
    }
    state.guestId = guestId;

    // 4. تهيئة الفايربيس
    try {
      if (typeof firebase !== 'undefined' && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('AIzaSyAsMock')) {
        if (firebase.apps.length === 0) {
          firebase.initializeApp(firebaseConfig);
        }
        
        // تفعيل App Check
        try {
          if (firebase.appCheck) {
            // تفعيل حزمة تصحيح الأخطاء عند التشغيل محلياً
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.includes('ngrok')) {
              self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
            }
            const appCheck = firebase.appCheck();
            appCheck.activate(
              new firebase.appCheck.ReCaptchaV3Provider('6Ld_placeholder_site_key_autorous'),
              true // auto refresh
            );
            console.log("[ProtectionSystem] App Check activated.");
          }
        } catch (acErr) {
          console.warn("[ProtectionSystem] App Check activation skipped/failed:", acErr);
        }

        db = firebase.firestore();
        auth = firebase.auth();
        isFirebaseAvailable = true;
      }
    } catch (e) {
      console.warn("Firebase config error, running local fallback:", e);
    }

    // 5. ربط أزرار ومستمعي تسجيل الدخول والاشتراك في الـ DOM
    setupUIEventListeners();

    // Start live ticking countdown
    setInterval(tickCountdown, 1000);
    setTimeout(() => tickCountdown(), 100);

    if (hasCache) {
      console.log("🔒 License status loaded from session cache:", state.status);
      updateUI();
      updateSubscriptionPanel();
      // تحقق بالخلفية بدون تعطيل لتحديث الكاش
      setTimeout(async () => {
        await validateLicenseBackground();
        startActiveHeartbeat();
      }, 1000);
      return;
    }

    // 6. إذا لم يكن هناك كاش، نقوم بالتحميل بالخلفية بشكل غير حظير
    setTimeout(async () => {
      await validateLicense();
      state.isLoaded = true;
      saveToCache();
      updateUI();
      updateSubscriptionPanel();
      startActiveHeartbeat();
    }, 50);
  }

  /**
   * التحقق بالخلفية لتحديث كاش الجلسة
   */
  async function validateLicenseBackground() {
    try {
      await validateLicense();
      saveToCache();
      updateUI();
      updateSubscriptionPanel();
    } catch (e) {
      // تجاهل أخطاء الشبكة بالخلفية
    }
  }

  /**
   * التحقق من الصلاحية سحابياً
   */
  /**
   * توليد معرف زائر عشوائي
   */
  function generateGuestId() {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 10);
    return `guest_${timestamp}_${randomStr}`;
  }

  /**
   * التحقق من الصلاحية سحابياً
   */
  async function validateLicense() {
    if (isFirebaseAvailable && auth) {
      try {
        // فحص حالة تسجيل الدخول أولاً
        const currentUser = auth.currentUser || await new Promise(res => {
          const unsub = auth.onAuthStateChanged(user => { unsub(); res(user); });
        });

        if (currentUser) {
          state.userId = currentUser.uid;
          state.userType = 'registered';
          await checkUserOrGuestSubscription(currentUser.uid, 'registered');
        } else {
          // وضع الزائر (Guest Mode)
          state.userId = null;
          state.userType = 'guest';
          
          let guestId = localStorage.getItem("guestId");
          if (!guestId) {
            guestId = generateGuestId();
            localStorage.setItem("guestId", guestId);
          }
          state.guestId = guestId;
          await checkUserOrGuestSubscription(guestId, 'guest');
        }
      } catch (err) {
        fallbackLocalValidation();
      }
    } else {
      fallbackLocalValidation();
    }

    // إجبار المستخدمين على تسجيل الدخول إن لم يكونوا مسجلين
    const isBypassPage = window.location.pathname.includes('auth.html') || 
                         window.location.pathname.includes('subscription.html') || 
                         window.location.pathname.includes('admin.html');
    if (state.userType === 'guest' && !isBypassPage) {
      window.location.replace('auth.html');
    }
  }

  async function handleKickOut() {
    console.warn("🔒 Device kicked out: session conflict detected.");
    sessionStorage.setItem('autorass_just_kicked', 'true');
    sessionStorage.removeItem(CACHE_KEY);
    sessionClaimed = false;
    
    state.userId = null;
    state.userType = 'guest';
    state.status = 'trial';
    
    if (isFirebaseAvailable && auth) {
      try {
        await auth.signOut();
      } catch (err) {
        console.error("Error signing out during kickout:", err);
      }
    }
  }

  /**
   * التحقق من اشتراك المستخدم المسجل أو الزائر
   */
  async function checkUserOrGuestSubscription(id, userType) {
    if (!id) return;
    
    // Sync device fingerprint trial record first (source of truth)
    const deviceTrial = await syncDeviceFingerprint();
    
    const collectionName = userType === 'registered' ? 'users' : 'guests';
    try {
      const docRef = db.collection(collectionName).doc(id);
      const docSnap = await docRef.get();
      
      const now = new Date();
      
      if (docSnap.exists) {
        const data = docSnap.data();
        
        // Invalidate subscription cache for this user since we got fresh data from Firestore
        delete userSubscriptionCache[id];
        try {
          sessionStorage.removeItem(`autorass_user_sub_${id}`);
        } catch (e) {
          console.warn("Failed to clear sessionStorage subscription cache:", e);
        }
        
        if (data.settings && data.settings.theme) {
          const body = document.body;
          if (body) {
            body.classList.remove('light-mode', 'dark-mode');
            body.classList.add(data.settings.theme === 'dark' ? 'dark-mode' : 'light-mode');
          }
          localStorage.setItem('theme', data.settings.theme);
        }
        


        state.isBlocked = data.isBlocked || false;
        state.isPaid = data.isPaid || false;
        state.userType = data.userType || userType;
        state.name = data.name || '';
        state.email = data.email || null;

        // Auto-fill/update missing or placeholder fields for registered users
        if (userType === 'registered' && auth && auth.currentUser) {
          const authEmail = auth.currentUser.email;
          const authName = auth.currentUser.displayName || auth.currentUser.email.split('@')[0];
          
          let needsUpdate = false;
          const updateFields = {};
          
          if (!data.email && authEmail) {
            updateFields.email = authEmail;
            state.email = authEmail;
            needsUpdate = true;
          }
          if ((!data.name || data.name === 'مستخدم' || data.name === 'زائر') && authName) {
            updateFields.name = authName;
            state.name = authName;
            needsUpdate = true;
          }
          
          if (needsUpdate) {
            await docRef.update(updateFields).catch(e => console.warn("[Protection] Failed to auto-update profile fields:", e));
          }
        }
        
        // Concurrent session validation (only for logged in registered users)
        let isSessionKicked = false;
        if (userType === 'registered') {
          const maxDevices = data.maxDevices !== undefined ? parseInt(data.maxDevices) : 1;
          const activeDevices = data.activeDevices || {};
          const deviceIds = Object.keys(activeDevices);
          const currentDeviceExists = deviceIds.includes(state.deviceId);

          if (sessionClaimed) {
            // We have already claimed our session.
            // If our device was removed from the active list, we are kicked out!
            if (!currentDeviceExists) {
              isSessionKicked = true;
            }
          } else {
            // This is a new session claiming a slot
            if (currentDeviceExists) {
              // Device is already registered in active devices list, just update its last active time
              const updateKey = `activeDevices.${state.deviceId}.lastActive`;
              await docRef.update({
                [updateKey]: firebase.firestore.FieldValue.serverTimestamp()
              });
              sessionClaimed = true;
            } else {
              // Device is not registered yet. We must register it.
              // Sort device IDs by lastActive timestamp (oldest first)
              const sortedDevices = deviceIds.sort((a, b) => {
                const devA = activeDevices[a] || {};
                const devB = activeDevices[b] || {};
                const timeA = devA.lastActive ? (devA.lastActive.toDate ? devA.lastActive.toDate().getTime() : new Date(devA.lastActive).getTime()) : 0;
                const timeB = devB.lastActive ? (devB.lastActive.toDate ? devB.lastActive.toDate().getTime() : new Date(devB.lastActive).getTime()) : 0;
                return timeA - timeB;
              });

              const updateObj = {};
              // If we exceed or meet maxDevices limit, kick the oldest devices
              // We need to keep total count < maxDevices before adding the new one
              let count = sortedDevices.length;
              while (count >= maxDevices && sortedDevices.length > 0) {
                const oldestId = sortedDevices.shift();
                updateObj[`activeDevices.${oldestId}`] = firebase.firestore.FieldValue.delete();
                count--;
              }

              // Retrieve location data if available
              const loc = state.locationInfo || (await fetchLocationData());
              if (loc) {
                state.locationInfo = loc;
              }
              
              updateObj[`activeDevices.${state.deviceId}`] = {
                lastActive: firebase.firestore.FieldValue.serverTimestamp(),
                ip: loc ? (loc.ip || '') : '',
                city: loc ? (loc.city || '') : '',
                country: loc ? (loc.country || '') : '',
                countryCode: loc ? (loc.countryCode || '') : '',
                userAgent: navigator.userAgent
              };
              updateObj.activeDeviceId = state.deviceId; // Keep activeDeviceId synchronized for compatibility
              
              // Also store locationInfo at root level if not already present
              if (!data.locationInfo && loc) {
                updateObj.locationInfo = loc;
              }

              await docRef.update(updateObj);
              sessionClaimed = true;
            }
          }
        }

        if (isSessionKicked) {
          await handleKickOut();
          return;
        }

        const endMs = data.subscriptionEnd ? data.subscriptionEnd.toDate().getTime() : 0;
        
        // Check if this is an admin account to bypass subscription expiration
        const isAdminAccount = (userType === 'registered') && isAdmin();

        if (isAdminAccount) {
          state.status = 'paid';
          state.plan = 'unlimited';
          state.isPaid = true;
          state.isBlocked = false;
          state.subscriptionEnd = null;
        } else if (state.isBlocked || (deviceTrial && deviceTrial.status === 'blocked')) {
          state.status = 'blocked';
        } else if (isSessionKicked) {
          state.status = 'kicked';
        } else if (state.isPaid || endMs > 0) {
          // Has paid subscription
          state.subscriptionEnd = endMs ? new Date(endMs) : null;
          const subType = (data.subscription && data.subscription.type) || data.requestedPlan || 'monthly';
          if (endMs > Date.now() || (state.isPaid && !endMs)) {
            state.status = 'paid';
            state.plan = subType;
          } else {
            state.status = 'expired';
            state.plan = subType;
          }
        } else if (deviceTrial) {
          // Free trial user - bound by device fingerprints
          state.trialStart = deviceTrial.trialStart;
          state.trialExpires = deviceTrial.trialEnd;
          state.status = deviceTrial.status; // 'trial' or 'expired'
          state.plan = 'free';
          
          // Sync start/end dates in user/guest document if they don't match
          const userStartMs = data.startDate ? data.startDate.toDate().getTime() : 0;
          if (Math.abs(userStartMs - deviceTrial.trialStart) > 1000) {
            await docRef.update({
              startDate: new Date(deviceTrial.trialStart),
              trialDays: 7,
              fingerprint: state.fingerprint
            });
          }
        } else {
          // Fallback
          const startMs = data.startDate ? data.startDate.toDate().getTime() : now.getTime();
          state.trialStart = startMs;
          state.trialExpires = startMs + (data.trialDays || 7) * 24 * 60 * 60 * 1000;
          state.subscriptionEnd = endMs ? new Date(endMs) : null;
          if (Date.now() <= state.trialExpires) {
            state.status = 'trial';
            state.plan = 'free';
          } else {
            state.status = 'expired';
            state.plan = 'free';
          }
        }
      } else {
        // Document does not exist yet (e.g. brand new user/guest or localStorage cleared)
        const isAdminAccount = (userType === 'registered') && isAdmin();

        let startDate = now;
        let trialDays = 7;
        let isPaid = isAdminAccount ? true : false;
        let subEnd = null;
        let isBlocked = false;
        let firstDeviceRegister = now;

        if (deviceTrial) {
          startDate = new Date(deviceTrial.trialStart);
          trialDays = 7;
        }

        const trialExpires = startDate.getTime() + trialDays * 24 * 60 * 60 * 1000;

        let loc = state.locationInfo;
        if (!loc) {
          try {
            loc = await fetchLocationData();
            if (loc) {
              state.locationInfo = loc;
            }
          } catch (e) {
            console.warn("Failed to fetch location on registration:", e);
          }
        }

        const newDoc = {
          name: userType === 'registered' ? (auth.currentUser.displayName || auth.currentUser.email.split('@')[0]) : 'زائر',
          email: userType === 'registered' ? auth.currentUser.email : null,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastActive: firebase.firestore.FieldValue.serverTimestamp(),
          startDate: startDate,
          trialDays: trialDays,
          isPaid: isPaid,
          subscriptionEnd: subEnd,
          isBlocked: isBlocked,
          userType: userType,
          fingerprint: state.fingerprint || null,
          deviceId: state.deviceId || null,
          activeDeviceId: userType === 'registered' ? state.deviceId : null,
          firstDeviceRegister: firstDeviceRegister,
          subscription: {
            type: isPaid ? 'monthly' : 'free',
            status: isPaid ? 'active' : (Date.now() <= trialExpires ? 'active' : 'expired'),
            startDate: startDate,
            expireDate: subEnd || new Date(trialExpires)
          }
        };

        if (loc) {
          newDoc.locationInfo = loc;
        }

        if (userType === 'registered') {
          newDoc.maxDevices = 1;
          newDoc.activeDevices = {
            [state.deviceId]: {
              lastActive: firebase.firestore.FieldValue.serverTimestamp(),
              ip: loc ? (loc.ip || '') : '',
              city: loc ? (loc.city || '') : '',
              country: loc ? (loc.country || '') : '',
              countryCode: loc ? (loc.countryCode || '') : '',
              userAgent: navigator.userAgent
            }
          };
          sessionClaimed = true;
        }
        
        await docRef.set(newDoc);
        
        state.isBlocked = isBlocked;
        state.isPaid = isPaid;
        state.userType = userType;
        state.name = newDoc.name;
        state.email = newDoc.email;
        state.trialStart = startDate.getTime();
        state.trialExpires = trialExpires;
        state.subscriptionEnd = subEnd;
        


        if (isAdminAccount) {
          state.status = 'paid';
          state.plan = 'paid';
        } else if (state.isBlocked) {
          state.status = 'blocked';
        } else if (deviceTrial) {
          state.status = deviceTrial.status;
          state.plan = 'free';
        } else if (Date.now() > state.trialExpires) {
          state.status = 'expired';
          state.plan = 'free';
        } else {
          state.status = 'trial';
          state.plan = 'free';
        }
      }
      try {
        if (isFirebaseAvailable && db) {
          updateLastActive();
        }
      } catch (err) {
        console.warn("Failed to schedule initial lastActive update:", err);
      }
    } catch (e) {
      console.error(`Error checking subscription:`, e);
      fallbackLocalValidation();
    }
  }

  function fallbackLocalValidation() {
    // التحقق المحلي عند انقطاع Firebase
    // ⚠️ الأمان: لا نثق بأي قيمة 'paid' من localStorage — يجب التحقق دائماً من Firebase
    let licenseDataStr = localStorage.getItem('autorass_lic_secure');
    let data = null;

    if (licenseDataStr) {
      try {
        data = JSON.parse(licenseDataStr);
      } catch (e) {
        data = null;
      }
    }

    if (!data) {
      const now = Date.now();
      const expires = now + TRIAL_DURATION_MS;
      data = {
        deviceId: state.deviceId || 'local_device',
        trialStart: now,
        trialExpires: expires,
        status: 'trial',
        email: null
      };
      localStorage.setItem('autorass_lic_secure', JSON.stringify(data));
    }

    // 🔒 الإصلاح الأمني: لا نسمح بـ 'paid' أو 'blocked' من localStorage
    // عند انقطاع Firebase، الحالة القصوى هي 'trial' أو 'expired' فقط
    const localStatus = data.status || 'trial';
    state.status = (localStatus === 'trial' || localStatus === 'expired') ? localStatus : 'trial';
    state.trialStart = data.trialStart || Date.now();
    state.trialExpires = data.trialExpires || (state.trialStart + TRIAL_DURATION_MS);
    
    // تحميل بيانات مستخدم المحاكاة المحلية إن وجد
    const mockUserStr = localStorage.getItem('autorass_mock_user');
    if (mockUserStr) {
      try {
        const mockUser = JSON.parse(mockUserStr);
        state.email = mockUser.email || null;
        state.name = mockUser.name || '';
        state.userType = 'registered';
      } catch (e) {
        state.email = null;
        state.userType = 'guest';
      }
    } else {
      state.email = null;
      state.userType = 'guest';
    }

    // التحقق من انتهاء التجربة بناءً على الوقت الفعلي
    if (state.status === 'trial' && Date.now() > state.trialExpires) {
      state.status = 'expired';
    }
  }

  /**
   * التوجيه إلى واتساب لتأكيد الدفع اليدوي بفودافون كاش
   */
  /**
   * يفتح نافذة الدفع وتأكيد الاشتراك مع تحديد الباقة وتجهيز البيانات
   */
  function openCheckoutModal(plan) {
    const modal = document.getElementById('modal-checkout');
    if (!modal) return;
    
    // توحيد اسم الباقة
    const normPlan = (plan === 'annual' || plan === 'yearly') ? 'yearly' : 'monthly';
    
    // تفعيل الراديو المقابل للباقة
    const monthlyRadio = document.getElementById('checkout-plan-monthly');
    const yearlyRadio = document.getElementById('checkout-plan-yearly');
    if (normPlan === 'monthly') {
      if (monthlyRadio) monthlyRadio.checked = true;
    } else {
      if (yearlyRadio) yearlyRadio.checked = true;
    }
    
    // تعبئة الاسم والهاتف تلقائياً من الإعدادات إن وجد
    const nameInput = document.getElementById('checkout-name');
    const phoneInput = document.getElementById('checkout-phone');
    
    const savedName = document.getElementById('user-settings-name')?.value || state.name || '';
    const savedPhone = document.getElementById('user-settings-phone')?.value || '';
    
    if (nameInput) nameInput.value = savedName;
    if (phoneInput) phoneInput.value = savedPhone;
    
    // تصفير الكوبون
    activeCoupon = null;
    const couponInput = document.getElementById('checkout-coupon');
    if (couponInput) couponInput.value = '';
    const couponStatus = document.getElementById('checkout-coupon-status');
    if (couponStatus) couponStatus.style.display = 'none';
    
    updateCheckoutPricing();
    
    // فتح المودال
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function updateCheckoutPricing() {
    const selectedPlanEl = document.querySelector('input[name="checkout-plan"]:checked');
    const plan = selectedPlanEl ? selectedPlanEl.value : 'monthly';
    const basePrice = plan === 'yearly' ? 499 : 49;
    
    // تحديث المظهر المرئي لأزرار الباقات
    const monthlyRadio = document.getElementById('checkout-plan-monthly');
    const yearlyRadio = document.getElementById('checkout-plan-yearly');
    const monthlyLbl = document.getElementById('checkout-plan-monthly-lbl');
    const yearlyLbl = document.getElementById('checkout-plan-yearly-lbl');
    
    if (monthlyLbl && yearlyLbl) {
      if (monthlyRadio && monthlyRadio.checked) {
        monthlyLbl.style.borderColor = 'var(--color-primary, #1565C0)';
        monthlyLbl.style.background = 'rgba(21, 101, 192, 0.05)';
        yearlyLbl.style.borderColor = 'var(--border-color, #e2e8f0)';
        yearlyLbl.style.background = 'transparent';
      } else if (yearlyRadio && yearlyRadio.checked) {
        yearlyLbl.style.borderColor = 'var(--color-primary, #1565C0)';
        yearlyLbl.style.background = 'rgba(21, 101, 192, 0.05)';
        monthlyLbl.style.borderColor = 'var(--border-color, #e2e8f0)';
        monthlyLbl.style.background = 'transparent';
      }
    }
    
    const originalPriceEl = document.getElementById('checkout-price-original');
    const finalPriceEl = document.getElementById('checkout-price-final');
    
    if (activeCoupon) {
      const discount = (basePrice * activeCoupon.percentage) / 100;
      const finalPrice = basePrice - discount;
      
      if (originalPriceEl) {
        originalPriceEl.style.display = 'inline-block';
        originalPriceEl.textContent = `${basePrice} ج.م`;
      }
      if (finalPriceEl) {
        finalPriceEl.textContent = `${finalPrice.toFixed(1)} ج.م`;
      }
    } else {
      if (originalPriceEl) {
        originalPriceEl.style.display = 'none';
      }
      if (finalPriceEl) {
        finalPriceEl.textContent = `${basePrice} ج.م`;
      }
    }
  }

  async function applyCouponCode(code) {
    const statusEl = document.getElementById('checkout-coupon-status');
    if (!statusEl) return;
    
    if (!code) {
      activeCoupon = null;
      statusEl.style.display = 'none';
      updateCheckoutPricing();
      return;
    }
    
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--text-secondary, #64748b)';
    statusEl.textContent = 'جاري التحقق من كود الخصم...';
    
    if (!isFirebaseAvailable || !db) {
      // وضع المحاكاة بدون إنترنت
      if (code.toUpperCase() === 'WELCOME10') {
        activeCoupon = { code: 'WELCOME10', percentage: 10 };
        statusEl.style.color = '#16a34a';
        statusEl.textContent = 'تم تطبيق الكوبون! خصم 10% (وضع المحاكاة)';
      } else {
        activeCoupon = null;
        statusEl.style.color = '#ef4444';
        statusEl.textContent = 'كود الخصم غير صالح أو منتهي الصلاحية';
      }
      updateCheckoutPricing();
      return;
    }
    
    try {
      const docRef = db.collection('coupons').doc(code.toUpperCase());
      const docSnap = await docRef.get();
      
      if (docSnap.exists) {
        const data = docSnap.data();
        const pct = parseFloat(data.percentage) || 0;
        activeCoupon = { code: code.toUpperCase(), percentage: pct };
        statusEl.style.color = '#16a34a';
        statusEl.textContent = `تم تطبيق الكوبون بنجاح! خصم ${pct}%`;
      } else {
        activeCoupon = null;
        statusEl.style.color = '#ef4444';
        statusEl.textContent = 'كود الخصم غير صالح أو منتهي الصلاحية';
      }
    } catch (e) {
      console.error("Error validating coupon:", e);
      activeCoupon = null;
      statusEl.style.color = '#ef4444';
      statusEl.textContent = 'حدث خطأ أثناء التحقق من الكود';
    }
    updateCheckoutPricing();
  }

  async function confirmCheckoutWhatsApp() {
    const nameInput = document.getElementById('checkout-name');
    const phoneInput = document.getElementById('checkout-phone');
    const name = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';
    
    if (!name) {
      showToast('يرجى إدخال الاسم أو اسم المطبعة لتأكيد الاشتراك.', 'warning');
      return;
    }
    if (!phone) {
      showToast('يرجى إدخال رقم الهاتف الذي قمت بالتحويل منه.', 'warning');
      return;
    }
    
    const selectedPlanEl = document.querySelector('input[name="checkout-plan"]:checked');
    const plan = selectedPlanEl ? selectedPlanEl.value : 'monthly';
    const basePrice = plan === 'yearly' ? 499 : 49;
    const finalPrice = activeCoupon ? (basePrice - (basePrice * activeCoupon.percentage) / 100) : basePrice;
    
    const email = state.email || '';
    const planText = plan === 'yearly' ? 'السنوية' : 'الشهرية';
    const whatsappPhone = '201515034914';
    const walletNumber = '01091968846';
    
    let couponText = 'لا يوجد';
    if (activeCoupon) {
      couponText = `${activeCoupon.code} (خصم ${activeCoupon.percentage}%)`;
    }
    
    const message = `مرحباً اوتو رص 👋
لقد قمت بتحويل قيمة الاشتراك عبر فودافون كاش إلى الرقم (${walletNumber}).

تفاصيل التحويل والتفعيل:
- الاسم: ${name}
- رقم الهاتف المحول منه: ${phone}
- الباقة المطلوبة: ${planText} (${basePrice} ج.م)
- كود الخصم المستخدم: ${couponText}
- المبلغ النهائي بعد الخصم: ${finalPrice.toFixed(1)} ج.م

تفاصيل فنية للتفعيل:
- البريد الإلكتروني: ${email || 'غير مسجل (زائر)'}
- معرف العميل: ${state.userId || state.guestId || 'غير متوفر'}
- بصمة المتصفح: ${state.fingerprint || 'غير متوفر'}

يرجى تأكيد التحويل وتفعيل الاشتراك في أسرع وقت.`;

    if (isFirebaseAvailable && db) {
      try {
        const collectionName = auth && auth.currentUser ? 'users' : 'guests';
        const docId = auth && auth.currentUser ? auth.currentUser.uid : state.guestId;
        
        await db.collection(collectionName).doc(docId).set({
          requestedPlan: plan,
          requestedPlanDate: new Date(),
          transferName: name,
          transferPhone: phone,
          couponUsed: activeCoupon ? activeCoupon.code : null,
          finalPrice: finalPrice,
          isPaid: false
        }, { merge: true });
        
        showToast('تم إرسال طلب تفعيل الاشتراك. جاري تفعيل المحادثة على واتساب...', 'info');
      } catch (e) {
        console.warn("Error updating Firestore status:", e);
      }
    } else {
      localStorage.setItem('autorass_sub_pending', JSON.stringify({ 
        plan, 
        email, 
        name, 
        phone, 
        coupon: activeCoupon ? activeCoupon.code : null, 
        finalPrice, 
        date: Date.now() 
      }));
    }

    // إغلاق النافذة
    closeModal('modal-checkout');
    
    // فتح واتساب
    const url = `https://api.whatsapp.com/send?phone=${whatsappPhone}&text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  }

  async function subscribePlan(plan) {
    openCheckoutModal(plan);
  }

  /**
   * التفعيل اليدوي السحابي للمستخدمين المشتركين
   */
  async function activateByEmail(email) {
    if (!email || !email.includes('@')) {
      showToast('يرجى إدخال بريد إلكتروني صالح', 'warning');
      return false;
    }

    showToast('جاري التحقق من التراخيص السحابية...', 'info');

    if (isFirebaseAvailable && db) {
      try {
        const querySnapshot = await db.collection("users").where("email", "==", email).limit(1).get();
        if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0];
          const data = userDoc.data();
          const subExpires = data.subscriptionEnd ? data.subscriptionEnd.toDate().getTime() : 0;
          
          if (data.isPaid && subExpires > Date.now()) {
            state.status = 'paid';
            state.isPaid = true;
            state.email = email;
            state.subscriptionEnd = new Date(subExpires);
            state.plan = (data.subscription && data.subscription.type) || data.requestedPlan || 'monthly';
            saveToCache();
            showToast('🎉 تم تفعيل اشتراكك بنجاح! شكراً لك.', 'success');
            closePaywall();
            updateUI();
            updateSubscriptionPanel();
            return true;
          }
        }
        showToast('لم يتم العثور على اشتراك نشط لهذا البريد. يرجى إرسال رسالة واتساب لتأكيد الدفع أولاً.', 'error');
        return false;
      } catch (e) {
        showToast('خطأ في التفعيل: ' + e.message, 'error');
        return false;
      }
    } else {
      // المحاكاة المحلية
      state.status = 'paid';
      state.isPaid = true;
      state.email = email;
      saveToCache();
      showToast('🎉 تم التفعيل الفوري محلياً بنجاح! (وضع المحاكاة)', 'success');
      closePaywall();
      updateUI();
      updateSubscriptionPanel();
      return true;
    }
  }

  function verifyAccess() {
    if (state.status === 'expired' || state.status === 'blocked' || state.isBlocked) {
      updateUI();
      return false;
    }
    return true;
  }

  /**
   * تحديث واجهة المستخدم للحماية
   */
  function updateUI() {
    const overlay = document.getElementById('paywall-overlay');
    const deviceIdLabel = document.getElementById('paywall-device-id');
    const appBody = document.getElementById('app-layout');
    const header = document.getElementById('app-header');

    if (deviceIdLabel) {
      deviceIdLabel.textContent = state.userId || state.guestId || state.deviceId || 'جاري استرداد المعرّف...';
    }

    const isBypassPage = window.location.pathname.includes('auth.html') || window.location.pathname.includes('subscription.html') || window.location.pathname.includes('admin.html');

    // إظهار لوحة التحكم للمشرفين فقط
    const btnAdminLink = document.getElementById('btn-admin-link');
    if (btnAdminLink) {
      btnAdminLink.style.display = isAdmin() ? 'inline-block' : 'none';
    }

    if ((state.status === 'expired' || state.status === 'blocked' || state.isBlocked || state.status === 'kicked') && !isBypassPage) {
      if (overlay) {
        overlay.style.display = 'flex';
        
        const paywallTitle = document.querySelector('.paywall-header h2');
        const paywallDesc = document.querySelector('.paywall-header p');
        const activationSection = document.querySelector('.activation-section');
        const pricingGrid = document.querySelector('.pricing-grid');
        
        if (state.isBlocked || state.status === 'blocked') {
          if (paywallTitle) paywallTitle.textContent = 'تم حظر الوصول إلى الحساب';
          if (paywallDesc) paywallDesc.innerHTML = 'تم حظر حسابك أو جهازك من قبل الإدارة. يرجى التواصل مع الدعم الفني لحل المشكلة.';
          if (activationSection) activationSection.style.display = 'none';
          if (pricingGrid) pricingGrid.style.display = 'none';
        } else if (state.status === 'kicked') {
          if (paywallTitle) paywallTitle.textContent = 'تنبيه: الحساب مفتوح على جهاز آخر';
          if (paywallDesc) paywallDesc.innerHTML = 'لا يمكن استخدام الحساب في أكثر من جهاز في نفس الوقت. تم إيقاف العمل على هذا المتصفح لأن الحساب نشط حالياً على جهاز آخر.';
          if (activationSection) activationSection.style.display = 'none';
          if (pricingGrid) pricingGrid.style.display = 'none';
        } else {
          if (paywallTitle) paywallTitle.textContent = 'انتهت الفترة التجريبية المجانية';
          if (paywallDesc) paywallDesc.textContent = 'انتهت الـ 7 أيام المجانية الخاصة بك. اشترك الآن للمتابعة والوصول لكافة الميزات.';
          if (activationSection) activationSection.style.display = 'block';
          if (pricingGrid) pricingGrid.style.display = 'flex';
        }
      }
      if (appBody) {
        appBody.style.display = 'none'; // إخفاء مساحة العمل بالكامل وجعل الموقع لا يعمل إطلاقاً
      }
      if (header) header.style.pointerEvents = 'none';
      window.scrollTo(0, 0);
      document.body.style.overflow = 'hidden';
    } else {
      if (overlay) overlay.style.display = 'none';
      if (appBody) {
        appBody.style.display = ''; // استعادة الوضع الافتراضي للشبكة
      }
      if (header) header.style.pointerEvents = 'auto';
      document.body.style.overflow = 'auto';
    }

    // تحديث أزرار تسجيل الدخول في الهيدر
    const btnLogin = document.getElementById('btn-login-trigger');
    const btnRegister = document.getElementById('btn-register-trigger');
    const btnLogout = document.getElementById('btn-logout-trigger');
    const displayName = document.getElementById('user-display-name');

    if (auth && auth.currentUser) {
      if (btnLogin) btnLogin.style.display = 'none';
      if (btnRegister) btnRegister.style.display = 'none';
      if (btnLogout) btnLogout.style.display = 'block';
      if (displayName) {
        const nameToDisplay = state.name || auth.currentUser.displayName || auth.currentUser.email.split('@')[0];
        displayName.textContent = nameToDisplay;
        displayName.style.display = 'block';
      }
    } else {
      if (btnLogin) btnLogin.style.display = 'block';
      if (btnRegister) btnRegister.style.display = 'block';
      if (btnLogout) btnLogout.style.display = 'none';
      if (displayName) displayName.style.display = 'none';
    }

    // ✅ عداد أيام التجربة المتبقية — يظهر في آخر 3 أيام
    _updateTrialCountdownBanner();
  }

  /**
   * عداد أيام التجربة: شريط تحذير يظهر في آخر 3 أيام
   */
  function _updateTrialCountdownBanner() {
    const BANNER_ID = 'trial-countdown-banner';

    // إزالة البانر إذا كان المستخدم مدفوع أو منتهي أو محجوب
    if (state.status !== 'trial' || state.isPaid) {
      const existing = document.getElementById(BANNER_ID);
      if (existing) existing.remove();
      return;
    }

    const expiresMs = state.trialExpires;
    if (!expiresMs) return;

    const diffMs = expiresMs - Date.now();
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

    // عرض البانر فقط في آخر 3 أيام
    if (diffMs > THREE_DAYS_MS || diffMs <= 0) {
      const existing = document.getElementById(BANNER_ID);
      if (existing) existing.remove();
      return;
    }

    const daysLeft = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    const hoursLeft = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

    let urgencyColor = '#d97706'; // برتقالي افتراضي
    let urgencyBg = 'rgba(217, 119, 6, 0.1)';
    let urgencyBorder = 'rgba(217, 119, 6, 0.3)';
    let icon = '⏳';

    if (daysLeft === 0) {
      // آخر يوم — أحمر
      urgencyColor = '#ef4444';
      urgencyBg = 'rgba(239, 68, 68, 0.1)';
      urgencyBorder = 'rgba(239, 68, 68, 0.3)';
      icon = '🔴';
    } else if (daysLeft === 1) {
      // يوم واحد — برتقالي داكن
      urgencyColor = '#ea580c';
      urgencyBg = 'rgba(234, 88, 12, 0.1)';
      urgencyBorder = 'rgba(234, 88, 12, 0.3)';
      icon = '⚠️';
    }

    let timeText = '';
    if (daysLeft === 0) {
      timeText = hoursLeft > 0 ? `${hoursLeft} ساعة` : 'أقل من ساعة';
    } else if (daysLeft === 1) {
      timeText = 'يوم واحد';
    } else {
      timeText = `${daysLeft} أيام`;
    }

    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 9990;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 10px 20px;
        font-family: inherit;
        font-size: 0.875rem;
        font-weight: 600;
        text-align: center;
        direction: rtl;
        transition: background 0.3s ease;
      `;
      // إضافة مساحة للبانر لعدم إخفاء الهيدر
      const header = document.getElementById('app-header');
      if (header) header.style.marginTop = '44px';
      document.body.prepend(banner);
    }

    banner.style.background = urgencyBg;
    banner.style.borderBottom = `1px solid ${urgencyBorder}`;
    banner.style.color = urgencyColor;
    banner.innerHTML = `
      <span>${icon}</span>
      <span>تجربتك المجانية تنتهي خلال <strong>${timeText}</strong> — اشترك الآن واستمر بالعمل دون انقطاع</span>
      <button onclick="window.ProtectionSystem && window.ProtectionSystem.showPaywall()" style="
        background: ${urgencyColor};
        color: white;
        border: none;
        padding: 5px 14px;
        border-radius: 6px;
        font-size: 0.8rem;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        font-family: inherit;
      ">اشترك الآن</button>
      <button onclick="document.getElementById('${BANNER_ID}').style.display='none'" style="
        background: transparent;
        border: none;
        color: ${urgencyColor};
        cursor: pointer;
        font-size: 1rem;
        padding: 0 4px;
        opacity: 0.7;
      " title="إغلاق">✕</button>
    `;
  }

  function getRemainingTimeText(expiresMs) {
    if (!expiresMs) return '';
    let targetMs = 0;
    if (typeof expiresMs.toDate === 'function') {
      targetMs = expiresMs.toDate().getTime();
    } else if (typeof expiresMs.seconds === 'number') {
      targetMs = expiresMs.seconds * 1000;
    } else if (expiresMs instanceof Date) {
      targetMs = expiresMs.getTime();
    } else if (typeof expiresMs === 'number') {
      targetMs = expiresMs;
    } else if (typeof expiresMs === 'string') {
      targetMs = new Date(expiresMs).getTime();
    }
    
    if (isNaN(targetMs) || targetMs <= 0) return '';
    const diffMs = targetMs - Date.now();
    if (diffMs <= 0) return 'منتهي';

    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    const diffHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const diffMinutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
    const diffSeconds = Math.floor((diffMs % (60 * 1000)) / 1000);

    if (diffDays >= 1) {
      let text = '';
      if (diffDays === 1) text = 'يوم واحد';
      else if (diffDays === 2) text = 'يومان';
      else if (diffDays >= 3 && diffDays <= 10) text = `${diffDays} أيام`;
      else text = `${diffDays} يوماً`;

      if (diffHours > 0) {
        let hrText = '';
        if (diffHours === 1) hrText = 'ساعة';
        else if (diffHours === 2) hrText = 'ساعتان';
        else if (diffHours >= 3 && diffHours <= 10) hrText = `${diffHours} ساعات`;
        else hrText = `${diffHours} ساعة`;
        text += ` و ${hrText}`;
      }
      return `متبقي ${text}`;
    }
    
    if (diffHours >= 1) {
      let text = '';
      if (diffHours === 1) text = 'ساعة واحدة';
      else if (diffHours === 2) text = 'ساعتان';
      else if (diffHours >= 3 && diffHours <= 10) text = `${diffHours} ساعات`;
      else text = `${diffHours} ساعة`;

      if (diffMinutes > 0) {
        let minText = '';
        if (diffMinutes === 1) minText = 'دقيقة';
        else if (diffMinutes === 2) minText = 'دقيقتان';
        else if (diffMinutes >= 3 && diffMinutes <= 10) minText = `${diffMinutes} دقائق`;
        else minText = `${diffMinutes} دقيقة`;
        text += ` و ${minText}`;
      }
      return `متبقي ${text}`;
    }
    
    let text = '';
    if (diffMinutes === 1) text = 'دقيقة واحدة';
    else if (diffMinutes === 2) text = 'دقيقتان';
    else if (diffMinutes >= 3 && diffMinutes <= 10) text = `${diffMinutes} دقائق`;
    else text = `${diffMinutes} دقيقة`;

    if (diffSeconds > 0) {
      let secText = '';
      if (diffSeconds === 1) secText = 'ثانية';
      else if (diffSeconds === 2) secText = 'ثانيتان';
      else if (diffSeconds >= 3 && diffSeconds <= 10) secText = `${diffSeconds} ثوانٍ`;
      else secText = `${diffSeconds} ثانية`;
      text += ` و ${secText}`;
    }
    return `متبقي ${text}`;
  }

  let lastSessionCheck = Date.now();

  function tickCountdown() {
    const badge = document.getElementById('trial-countdown-badge');
    const panelClock = document.getElementById('panel-countdown-clock');
    
    if (state.isBlocked || state.status === 'blocked' || state.status === 'expired' || state.status === 'kicked') {
      if (badge) badge.style.display = 'none';
      if (panelClock) panelClock.textContent = state.status === 'kicked' ? 'مفتوح من جهاز آخر' : 'منتهي';
      return;
    }

    // Check concurrent session every 10 seconds for registered users
    if (state.userType === 'registered' && Date.now() - lastSessionCheck > 10000) {
      lastSessionCheck = Date.now();
      validateLicenseBackground();
    }
    
    const exp = state.status === 'paid' ? state.subscriptionEnd : state.trialExpires;
    if (!exp) {
      if (badge) badge.style.display = 'none';
      return;
    }
    
    const timeText = getRemainingTimeText(exp);
    
    if (timeText === 'منتهي' || timeText === '') {
      // Expired! Validate license to update status and trigger paywall
      validateLicense().then(() => {
        saveToCache();
        updateUI();
        updateSubscriptionPanel();
      });
      return;
    }
    
    // Update header badge
    if (badge) {
      badge.style.display = 'inline-flex';
      badge.textContent = `⏳ ${state.status === 'paid' ? 'اشتراك نشط: ' : 'تجريبي: '}${timeText}`;
      
      // Dynamic styles for the badge
      if (state.status === 'paid') {
        badge.style.background = 'rgba(34, 197, 94, 0.1)';
        badge.style.color = '#16a34a';
        badge.style.border = '1px solid rgba(34, 197, 94, 0.2)';
      } else {
        const diffMs = (exp instanceof Date ? exp.getTime() : exp) - Date.now();
        const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
        if (diffMs < twoDaysMs) {
          badge.style.background = 'rgba(239, 68, 68, 0.1)';
          badge.style.color = '#dc2626';
          badge.style.border = '1px solid rgba(239, 68, 68, 0.2)';
        } else {
          badge.style.background = 'rgba(249, 115, 22, 0.1)';
          badge.style.color = '#ea580c';
          badge.style.border = '1px solid rgba(249, 115, 22, 0.2)';
        }
      }
    }
    
    // Update panel clock if present
    if (panelClock) {
      panelClock.textContent = `⏳ ${timeText}`;
    }
  }

  // Local cache for loaded user subscription object
  let userSubscriptionCache = {};

  /**
   * Calculates subscription details.
   * @param {Object} subscription The subscription object from Firestore user doc
   * @returns {Object} { type, status, expireDate, expireDateFormatted, remainingDays, isSubscribed }
   */
  function getSubscriptionInfo(subscription) {
    const info = {
      type: 'free',
      status: 'free',
      expireDate: null,
      expireDateFormatted: 'لا يوجد تاريخ انتهاء (No expiration date)',
      remainingDays: 0,
      isSubscribed: false
    };

    if (!subscription) {
      return info;
    }

    const type = subscription.type || 'free';
    let status = subscription.status || 'active';
    let expireMs = 0;
    let hasExpiration = false;

    if (subscription.expireDate) {
      hasExpiration = true;
      try {
        const exp = subscription.expireDate;
        if (typeof exp.toDate === 'function') {
          expireMs = exp.toDate().getTime();
        } else if (typeof exp.seconds === 'number') {
          expireMs = exp.seconds * 1000;
        } else if (exp instanceof Date) {
          expireMs = exp.getTime();
        } else if (typeof exp === 'number') {
          expireMs = exp;
        } else if (typeof exp === 'string') {
          expireMs = new Date(exp).getTime();
        }
      } catch (e) {
        console.error("Error parsing expireDate in getSubscriptionInfo:", e);
      }
    }

    const now = Date.now();
    if (hasExpiration) {
      if (expireMs > now) {
        const diffMs = expireMs - now;
        info.remainingDays = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
        info.status = (status === 'active' || status === 'free' || status === 'trial') ? 'active' : 'expired';
      } else {
        info.remainingDays = 0;
        info.status = 'expired';
      }
    } else {
      if (status === 'active' || status === 'free' || status === 'trial') {
        info.status = 'active';
        info.remainingDays = 9999;
      } else {
        info.status = 'expired';
        info.remainingDays = 0;
      }
    }

    info.type = type;
    
    // Treat as subscribed (having a valid active or expired trial tracker) if expireMs is set.
    if (expireMs > 0) {
      info.isSubscribed = true;
    } else {
      info.isSubscribed = false;
    }

    if (expireMs > 0) {
      info.expireDate = new Date(expireMs);
      try {
        // Arabic formatted date
        const arDate = info.expireDate.toLocaleDateString('ar-EG', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        // English formatted date
        const enDate = info.expireDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        info.expireDateFormatted = `${arDate} (${enDate})`;
      } catch (e) {
        info.expireDateFormatted = info.expireDate.toLocaleDateString();
      }
    }

    return info;
  }

  /**
   * Renders the subscription UI into `#subscription-status`
   * @param {Object} userData The user data object containing subscription fields
   */
  function renderSubscriptionStatus(userData) {
    const container = document.getElementById('subscription-status') || document.getElementById('panel-subscription-status');
    if (!container) return;

    const subscription = userData ? userData.subscription : null;
    const info = getSubscriptionInfo(subscription);

    let html = '';

    const isExpired = info.status === 'expired';
    const isPaidPlan = (info.type !== 'free' && info.type !== 'trial') || (userData && userData.isPaid);

    const planNameAr = info.type === 'yearly' ? 'الاشتراك السنوي' : 
                       (info.type === 'monthly' ? 'الاشتراك الشهري' : 
                       (info.type === 'unlimited' ? 'الاشتراك المفتوح (مسؤول)' : 
                       (isPaidPlan ? 'الخطة المدفوعة' : 'الخطة المجانية (فترة تجريبية)')));

    const planNameEn = info.type === 'yearly' ? 'Yearly Plan' : 
                       (info.type === 'monthly' ? 'Monthly Plan' : 
                       (info.type === 'unlimited' ? 'Unlimited Plan' : 
                       (isPaidPlan ? 'Paid Plan' : 'Free Trial Plan')));

    if (isExpired) {
      const expiredTitleAr = info.type === 'free' ? 'انتهت الفترة التجريبية المجانية' : 'انتهى الاشتراك الخاص بك';
      const expiredTitleEn = info.type === 'free' ? 'Free Trial Expired' : 'Subscription Expired';
      const expiredMsgAr = info.type === 'free' ? 'يرجى الاشتراك في إحدى الباقات للمتابعة واستخدام ميزات الموقع.' : 'يرجى تجديد الاشتراك عبر فودافون كاش وتأكيد العملية لتفعيل الحساب مجدداً.';

      html = `
        <div class="sub-status-card expired-plan" style="
          background: linear-gradient(135deg, #fff5f5 0%, #fed7d7 100%);
          border: 1px solid #feb2b2;
          border-radius: 12px;
          padding: 20px;
          text-align: right;
          position: relative;
          overflow: hidden;
          transition: all 0.3s ease;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
          margin-top: 10px;
        ">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <span style="
              background: #e53e3e;
              color: white;
              padding: 4px 12px;
              border-radius: 20px;
              font-size: 0.85rem;
              font-weight: bold;
            ">منتهي الصلاحية (Expired)</span>
            <span style="color: #e53e3e; font-size: 0.85rem; font-weight: bold;">${planNameAr}</span>
          </div>
          <h4 style="margin: 0 0 8px 0; color: #9b2c2c; font-size: 1.1rem; font-weight: bold;">${expiredTitleAr} (${expiredTitleEn})</h4>
          <p style="margin: 0; color: #742a2a; font-size: 0.875rem; line-height: 1.5;">
            تاريخ الانتهاء: <strong>${info.expireDateFormatted}</strong><br>
            ${expiredMsgAr}
          </p>
        </div>
      `;
    } else {
      // Active Subscribed or Active Free Plan
      const activeColor = isPaidPlan ? '#16a34a' : '#0284c7';
      const activeBg = isPaidPlan ? 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)' : 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)';
      const activeBorder = isPaidPlan ? '#86efac' : '#bae6fd';

      html = `
        <div class="sub-status-card active-plan" style="
          background: ${activeBg};
          border: 1px solid ${activeBorder};
          border-radius: 12px;
          padding: 20px;
          text-align: right;
          position: relative;
          overflow: hidden;
          transition: all 0.3s ease;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
          margin-top: 10px;
        ">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <span style="
              background: ${activeColor};
              color: white;
              padding: 4px 12px;
              border-radius: 20px;
              font-size: 0.85rem;
              font-weight: bold;
            ">نشط (Active)</span>
            <span style="color: ${activeColor}; font-size: 0.85rem; font-weight: bold;">${planNameAr} (${planNameEn})</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="font-size: 1.4rem; font-weight: 800; color: ${isPaidPlan ? '#14532d' : '#0369a1'}; display: flex; align-items: center; gap: 6px;">
              <span id="panel-countdown-clock">⏳ ${info.remainingDays === 9999 ? 'نشط دائماً (Always Active)' : `متبقي ${info.remainingDays} يوماً (${info.remainingDays} days left)`}</span>
            </div>
            <div style="color: ${isPaidPlan ? '#166534' : '#075985'}; font-size: 0.875rem; line-height: 1.5;">
              تاريخ انتهاء الصلاحية (Expiration Date): <strong style="font-weight: bold;">${info.expireDateFormatted}</strong>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
  }

  /**
   * Fetches the user subscription once from Firestore or returns cached values
   * @param {string} userId Firebase user UID
   * @returns {Promise<Object>} The user data containing subscription details
   */
  async function loadUserSubscription(userId) {
    if (!userId) {
      // Return guest representation based on current state parameters
      const localData = {
        email: state.email || null,
        subscription: {
          type: (state.plan && state.plan !== 'paid') ? state.plan : (state.status === 'paid' ? 'monthly' : 'free'),
          status: (state.status === 'paid' || state.status === 'trial') ? 'active' : (state.status === 'expired' ? 'expired' : 'free'),
          expireDate: state.status === 'paid'
            ? (state.subscriptionEnd ? new Date(state.subscriptionEnd) : null)
            : (state.trialExpires ? new Date(state.trialExpires) : null)
        }
      };
      renderSubscriptionStatus(localData);
      return localData;
    }

    // Check memory cache
    if (userSubscriptionCache[userId]) {
      const cached = userSubscriptionCache[userId];
      if (Date.now() - cached.timestamp < 120 * 1000) { // 2 minutes memory TTL
        renderSubscriptionStatus(cached.data);
        return cached.data;
      }
    }

    // Check sessionStorage
    try {
      const sessionCached = sessionStorage.getItem(`autorass_user_sub_${userId}`);
      if (sessionCached) {
        const cacheObj = JSON.parse(sessionCached);
        if (Date.now() - cacheObj.timestamp < 600 * 1000) { // 10 minutes session TTL
          userSubscriptionCache[userId] = cacheObj;
          renderSubscriptionStatus(cacheObj.data);
          return cacheObj.data;
        }
      }
    } catch (e) {
      console.warn("Error reading from session storage:", e);
    }

    // Fallback if Firebase isn't initialized yet or db is unavailable
    if (!isFirebaseAvailable || !db) {
      const localData = {
        email: state.email || null,
        subscription: {
          type: (state.plan && state.plan !== 'paid') ? state.plan : (state.status === 'paid' ? 'monthly' : 'free'),
          status: (state.status === 'paid' || state.status === 'trial') ? 'active' : (state.status === 'expired' ? 'expired' : 'free'),
          expireDate: state.status === 'paid'
            ? (state.subscriptionEnd ? new Date(state.subscriptionEnd) : null)
            : (state.trialExpires ? new Date(state.trialExpires) : null)
        }
      };
      renderSubscriptionStatus(localData);
      return localData;
    }

    try {
      const userDoc = await db.collection("users").doc(userId).get();
      let userData = null;
      if (userDoc.exists) {
        userData = userDoc.data();
      } else {
        userData = {
          email: auth.currentUser ? auth.currentUser.email : '',
          subscription: {
            type: 'free',
            status: 'free',
            expireDate: null
          }
        };
      }

      // Normalize subscription object from root-level parameters if they exist
      if (!userData.subscription) {
        userData.subscription = {};
      }
      
      const startMs = userData.startDate 
        ? (userData.startDate.toDate ? userData.startDate.toDate().getTime() : new Date(userData.startDate).getTime()) 
        : Date.now();

      const endMs = userData.subscriptionEnd 
        ? (userData.subscriptionEnd.toDate ? userData.subscriptionEnd.toDate().getTime() : new Date(userData.subscriptionEnd).getTime()) 
        : 0;

      const email = userData.email || (auth.currentUser ? auth.currentUser.email : '');
      const isAdminAccount = ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase()) || ADMIN_UIDS.includes(userId);
      const hasPaidSubscription = userData.isPaid || endMs > 0;

      if (isAdminAccount) {
        userData.isPaid = true;
        userData.isBlocked = false;
        userData.subscription = {
          type: 'unlimited',
          status: 'active',
          expireDate: null,
          startDate: userData.startDate || new Date(startMs)
        };
      } else if (hasPaidSubscription) {
        userData.subscription.type = userData.requestedPlan || 'monthly';
        userData.subscription.status = (endMs > Date.now() || (userData.isPaid && !endMs)) ? 'active' : 'expired';
        userData.subscription.expireDate = userData.subscriptionEnd || null;
      } else {
        userData.subscription.type = 'free';
        const trialDays = userData.trialDays !== undefined ? userData.trialDays : 7;
        const trialExpiresMs = startMs + trialDays * 24 * 60 * 60 * 1000;
        userData.subscription.status = (Date.now() <= trialExpiresMs) ? 'active' : 'expired';
        userData.subscription.expireDate = new Date(trialExpiresMs);
      }
      
      userData.subscription.startDate = userData.startDate || new Date(startMs);

      // Format Firestore Timestamps into Dates for local consumption if necessary
      if (userData.subscription) {
        const sub = userData.subscription;
        if (sub.expireDate && typeof sub.expireDate.toDate === 'function') {
          sub.expireDate = sub.expireDate.toDate();
        } else if (sub.expireDate && !(sub.expireDate instanceof Date)) {
          sub.expireDate = new Date(sub.expireDate);
        }
        if (sub.startDate && typeof sub.startDate.toDate === 'function') {
          sub.startDate = sub.startDate.toDate();
        } else if (sub.startDate && !(sub.startDate instanceof Date)) {
          sub.startDate = new Date(sub.startDate);
        }
      }

      const cacheObj = {
        data: userData,
        timestamp: Date.now()
      };
      userSubscriptionCache[userId] = cacheObj;
      try {
        sessionStorage.setItem(`autorass_user_sub_${userId}`, JSON.stringify(cacheObj));
      } catch (e) {
        console.warn("Error saving to session storage:", e);
      }

      renderSubscriptionStatus(userData);
      return userData;
    } catch (e) {
      console.error("Error fetching user subscription from Firestore:", e);
      // Fallback
      const localData = {
        email: state.email || null,
        subscription: {
          type: (state.plan && state.plan !== 'paid') ? state.plan : (state.status === 'paid' ? 'monthly' : 'free'),
          status: (state.status === 'paid' || state.status === 'trial') ? 'active' : (state.status === 'expired' ? 'expired' : 'free'),
          expireDate: state.status === 'paid'
            ? (state.subscriptionEnd ? new Date(state.subscriptionEnd) : null)
            : (state.trialExpires ? new Date(state.trialExpires) : null)
        }
      };
      renderSubscriptionStatus(localData);
      return localData;
    }
  }

  /**
   * تحديث لوحة الاشتراكات
   */
  function updateSubscriptionPanel() {
    const localData = {
      email: state.email || null,
      isPaid: state.isPaid,
      subscription: {
        type: state.plan === 'free' ? 'free' : (state.plan === 'unlimited' ? 'unlimited' : state.plan),
        status: state.status === 'paid' ? 'active' : (state.status === 'trial' ? 'active' : 'expired'),
        expireDate: state.status === 'paid' ? state.subscriptionEnd : state.trialExpires
      }
    };
    renderSubscriptionStatus(localData);
  }

  let currentAuthMode = 'register';

  function setAuthMode(mode) {
    currentAuthMode = mode;
    
    const title = document.getElementById('auth-modal-title');
    const subtitle = document.getElementById('auth-subtitle');
    const submit = document.getElementById('btn-auth-submit');
    const switchBtn = document.getElementById('btn-auth-switch');
    const passwordGroup = document.getElementById('auth-password-group');
    const forgotBtn = document.getElementById('btn-forgot-password');
    const errorEl = document.getElementById('auth-error-msg');
    
    const googleBtn = document.getElementById('btn-google-auth');
    const googleBtnText = document.getElementById('btn-google-auth-text');
    const googleDivider = document.getElementById('auth-google-divider');
    const nameGroup = document.getElementById('auth-name-group');
    const emailLabel = document.getElementById('auth-email-label');
    const emailInput = document.getElementById('auth-email');
    const tabLogin = document.getElementById('tab-auth-login');
    const tabRegister = document.getElementById('tab-auth-register');
    const tabsContainer = document.querySelector('.auth-tabs');

    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }

    if (switchBtn) {
      switchBtn.style.display = 'none'; // إخفاء زر التبديل القديم تماماً واستبداله بالتبويبات
    }

    if (mode === 'register') {
      if (title) title.textContent = 'إنشاء حساب جديد';
      if (subtitle) {
        subtitle.textContent = 'ابدأ تجربتك واستمتع بحفظ مشاريعك سحابياً';
        subtitle.style.display = 'block';
      }
      if (submit) submit.textContent = 'إنشاء حساب';
      if (passwordGroup) passwordGroup.style.display = 'block';
      if (forgotBtn) forgotBtn.style.display = 'none';
      if (googleBtn) googleBtn.style.display = 'flex';
      if (googleDivider) googleDivider.style.display = 'flex';
      if (googleBtnText) googleBtnText.textContent = 'التسجيل بواسطة جوجل';
      if (nameGroup) nameGroup.style.display = 'block';
      if (emailLabel) emailLabel.textContent = 'البريد الإلكتروني أو رقم الهاتف';
      if (emailInput) emailInput.placeholder = 'example@email.com أو 010xxxxxxx';
      
      if (tabLogin) { tabLogin.classList.remove('btn-primary'); tabLogin.classList.add('btn-secondary'); }
      if (tabRegister) { tabRegister.classList.remove('btn-secondary'); tabRegister.classList.add('btn-primary'); }
      if (tabsContainer) tabsContainer.style.display = 'grid';
    } else if (mode === 'login') {
      if (title) title.textContent = 'تسجيل الدخول';
      if (subtitle) {
        subtitle.textContent = 'سجل دخولك للوصول إلى مشاريعك واشتراكاتك';
        subtitle.style.display = 'block';
      }
      if (submit) submit.textContent = 'دخول';
      if (passwordGroup) passwordGroup.style.display = 'block';
      if (forgotBtn) forgotBtn.style.display = 'inline-block';
      if (googleBtn) googleBtn.style.display = 'flex';
      if (googleDivider) googleDivider.style.display = 'flex';
      if (googleBtnText) googleBtnText.textContent = 'الدخول بواسطة جوجل';
      if (nameGroup) nameGroup.style.display = 'none';
      if (emailLabel) emailLabel.textContent = 'البريد الإلكتروني أو رقم الهاتف';
      if (emailInput) emailInput.placeholder = 'example@email.com أو 010xxxxxxx';
      
      if (tabLogin) { tabLogin.classList.remove('btn-secondary'); tabLogin.classList.add('btn-primary'); }
      if (tabRegister) { tabRegister.classList.remove('btn-primary'); tabRegister.classList.add('btn-secondary'); }
      if (tabsContainer) tabsContainer.style.display = 'grid';
    } else if (mode === 'forgot') {
      if (title) title.textContent = 'استعادة كلمة المرور';
      if (subtitle) {
        subtitle.textContent = 'أدخل بريدك الإلكتروني لإرسال رابط إعادة تعيين كلمة المرور';
        subtitle.style.display = 'block';
      }
      if (submit) submit.textContent = 'إرسال رابط استعادة كلمة المرور';
      if (passwordGroup) passwordGroup.style.display = 'none';
      if (forgotBtn) forgotBtn.style.display = 'none';
      if (googleBtn) googleBtn.style.display = 'none';
      if (googleDivider) googleDivider.style.display = 'none';
      if (nameGroup) nameGroup.style.display = 'none';
      if (emailLabel) emailLabel.textContent = 'البريد الإلكتروني';
      if (emailInput) emailInput.placeholder = 'example@email.com';
      
      if (tabsContainer) tabsContainer.style.display = 'none';
    }
  }

  /**
   * إعداد مستمعي الأحداث للواجهة
   */
  function setupUIEventListeners() {
    // 1. أزرار تفعيل الدخول
    document.getElementById('btn-login-trigger')?.addEventListener('click', () => {
      openAuthModal();
      setAuthMode('login');
    });

    document.getElementById('btn-register-trigger')?.addEventListener('click', () => {
      openAuthModal();
      setAuthMode('register');
    });

    // تبويبات الانتقال بين الدخول والتسجيل
    document.getElementById('tab-auth-login')?.addEventListener('click', () => {
      setAuthMode('login');
    });

    document.getElementById('tab-auth-register')?.addEventListener('click', () => {
      setAuthMode('register');
    });

    document.getElementById('btn-logout-trigger')?.addEventListener('click', async () => {
      sessionClaimed = false;
      if (isFirebaseAvailable && auth) {
        await auth.signOut();
        sessionStorage.removeItem(CACHE_KEY);
        showToast('تم تسجيل الخروج', 'info');
      } else {
        localStorage.removeItem('autorass_mock_user');
        sessionStorage.removeItem(CACHE_KEY);
        state.email = null;
        state.status = 'trial';
        state.plan = 'free';
        updateUI();
        updateSubscriptionPanel();
        showToast('تم تسجيل الخروج (المحاكاة)', 'info');
      }
    });

    document.getElementById('btn-activate-subscription')?.addEventListener('click', () => {
      const emailInput = document.getElementById('subscriber-email');
      if (emailInput) activateByEmail(emailInput.value.trim());
    });
    document.getElementById('btn-auth-switch')?.addEventListener('click', (e) => {
      if (currentAuthMode === 'register') {
        setAuthMode('login');
      } else if (currentAuthMode === 'login') {
        setAuthMode('register');
      } else if (currentAuthMode === 'forgot') {
        setAuthMode('login');
      }
    });

    document.getElementById('btn-forgot-password')?.addEventListener('click', (e) => {
      e.preventDefault();
      setAuthMode('forgot');
    });

    // تهيئة حالة الواجهة الافتراضية
    setAuthMode('register');

    document.getElementById('btn-auth-submit')?.addEventListener('click', () => {
      handleAuthSubmit();
    });

    document.getElementById('btn-google-auth')?.addEventListener('click', () => {
      handleGoogleAuthSubmit();
    });

    const triggerSubmitOnEnter = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAuthSubmit();
      }
    };
    document.getElementById('auth-name')?.addEventListener('keydown', triggerSubmitOnEnter);
    document.getElementById('auth-email')?.addEventListener('keydown', triggerSubmitOnEnter);
    document.getElementById('auth-password')?.addEventListener('keydown', triggerSubmitOnEnter);

    // Also support Enter key in subscription activation email input
    document.getElementById('subscriber-email')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-activate-subscription')?.click();
      }
    });

    // 3. أزرار تفعيل الدفع وفتح نافذة تأكيد الاشتراك
    document.getElementById('btn-whatsapp-paid')?.addEventListener('click', () => {
      const selectedRadio = document.querySelector('input[name="selected-sub-plan"]:checked');
      const plan = selectedRadio ? selectedRadio.value : 'monthly';
      openCheckoutModal(plan);
    });

    document.getElementById('btn-paywall-whatsapp')?.addEventListener('click', () => {
      const selectedRadio = document.querySelector('input[name="paywall-selected-sub-plan"]:checked');
      const plan = selectedRadio ? selectedRadio.value : 'monthly';
      openCheckoutModal(plan);
    });

    // مستمعات أحداث نافذة الدفع (Checkout Modal)
    document.querySelectorAll('input[name="checkout-plan"]').forEach(radio => {
      radio.addEventListener('change', () => {
        updateCheckoutPricing();
      });
    });

    document.getElementById('btn-apply-coupon')?.addEventListener('click', () => {
      const couponInput = document.getElementById('checkout-coupon');
      if (couponInput) {
        applyCouponCode(couponInput.value.trim());
      }
    });

    // تفعيل التحقق بمفتاح Enter في حقل الكوبون
    document.getElementById('checkout-coupon')?.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        applyCouponCode(e.target.value.trim());
      }
    });

    document.getElementById('btn-confirm-checkout')?.addEventListener('click', () => {
      confirmCheckoutWhatsApp();
    });

    // 4. مستمع التغييرات في تسجيل الدخول (Firebase Auth)
    if (isFirebaseAvailable && auth) {
      auth.onAuthStateChanged(async (user) => {
        userSubscriptionCache = {}; // Clear memory cache on auth change
        sessionClaimed = false;
        if (user) {
          state.userId = user.uid;
          state.userType = 'registered';
          await checkUserOrGuestSubscription(user.uid, 'registered');
          
          // توجيه للرئيسية إذا كان مسجلاً بالدخول ومتواجد في صفحة auth.html
          if (window.location.pathname.includes('auth.html')) {
            window.location.replace('index.html');
          }
        } else {
          state.userId = null;
          state.userType = 'guest';
          let guestId = localStorage.getItem("guestId");
          if (!guestId) {
            guestId = generateGuestId();
            localStorage.setItem("guestId", guestId);
          }
          state.guestId = guestId;
          await checkUserOrGuestSubscription(guestId, 'guest');
          
          if (sessionStorage.getItem('autorass_just_kicked') === 'true') {
            sessionStorage.removeItem('autorass_just_kicked');
            setTimeout(() => {
              alert("تم تسجيل الخروج من الجهاز الاخر");
              showToast("تم تسجيل الخروج من الجهاز الاخر", "warning");
            }, 100);
          }

          // إجبار المستخدمين غير المسجلين على الذهاب لـ auth.html
          const isBypassPage = window.location.pathname.includes('auth.html') || 
                               window.location.pathname.includes('subscription.html') || 
                               window.location.pathname.includes('admin.html');
          if (!isBypassPage) {
            window.location.replace('auth.html');
            return;
          }
        }
        saveToCache();
        updateUI();
        updateSubscriptionPanel();
      });
    }
  }
  function openAuthModal() {
    const modal = document.getElementById('modal-auth');
    if (modal) {
      setAuthMode('register');
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

  async function transferGuestDataToUser(guestId, uid, name) {
    if (!guestId || !uid || guestId === uid) return;
    if (!isFirebaseAvailable || !db) return;

    try {
      console.log(`Migrating data from guest ${guestId} to user ${uid}...`);
      
      // 1. Fetch guest user document
      const guestDocRef = db.collection('guests').doc(guestId);
      const guestDoc = await guestDocRef.get();
      
      let guestData = {};
      if (guestDoc.exists) {
        guestData = guestDoc.data();
      }

      // 2. Prepare user document updates (preserving settings, current, and subscription status)
      const userDocRef = db.collection('users').doc(uid);
      const userUpdate = {
        userType: 'registered',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (auth && auth.currentUser) {
        userUpdate.email = auth.currentUser.email || null;
        userUpdate.name = name || auth.currentUser.displayName || auth.currentUser.email.split('@')[0];
      }

      // Copy settings if present in guest
      if (guestData.settings) {
        userUpdate.settings = guestData.settings;
      }
      
      // Copy current auto-save state
      if (guestData.current) {
        userUpdate.current = guestData.current;
      }

      // Copy fingerprint and device specifications
      if (guestData.fingerprint) {
        userUpdate.fingerprint = guestData.fingerprint;
      }
      if (guestData.deviceId) {
        userUpdate.deviceId = guestData.deviceId;
      }
      if (guestData.firstDeviceRegister) {
        userUpdate.firstDeviceRegister = guestData.firstDeviceRegister;
      }

      // Copy subscription / trial parameters to new user
      if (guestData.startDate) {
        userUpdate.startDate = guestData.startDate;
      }
      if (guestData.trialDays !== undefined) {
        userUpdate.trialDays = guestData.trialDays;
      }
      if (guestData.isPaid !== undefined) {
        userUpdate.isPaid = guestData.isPaid;
      }
      if (guestData.subscriptionEnd !== undefined) {
        userUpdate.subscriptionEnd = guestData.subscriptionEnd;
      }
      if (guestData.isBlocked !== undefined) {
        userUpdate.isBlocked = guestData.isBlocked;
      }
      if (guestData.requestedPlan !== undefined) {
        userUpdate.requestedPlan = guestData.requestedPlan;
      }
      if (guestData.requestedPlanDate !== undefined) {
        userUpdate.requestedPlanDate = guestData.requestedPlanDate;
      }
      if (guestData.subscription) {
        userUpdate.subscription = guestData.subscription;
      }

      // Merge into the user document
      const cleanUserUpdate = (typeof ProjectsManager !== 'undefined' && ProjectsManager.sanitizeForFirestore)
        ? ProjectsManager.sanitizeForFirestore(userUpdate)
        : userUpdate;
      await userDocRef.set(cleanUserUpdate, { merge: true });

      // 3. Migrate projects
      const projectsSnap = await db.collection('projects')
        .where('ownerId', '==', guestId)
        .get();

      if (!projectsSnap.empty) {
        const batch = db.batch();
        projectsSnap.forEach(doc => {
          batch.update(doc.ref, {
            ownerId: uid,
            ownerType: 'registered',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        console.log(`Migrated ${projectsSnap.size} projects from guest to user.`);
      }

      // 4. Delete all matching guest documents from guests collection to avoid duplicates or cache bypass leftovers
      const deletePromises = [];
      if (guestId) {
        deletePromises.push(db.collection('guests').doc(guestId).delete());
      }
      if (state.fingerprint) {
        const snapByFingerprint = await db.collection('guests')
          .where('fingerprint', '==', state.fingerprint)
          .get();
        snapByFingerprint.forEach(doc => {
          deletePromises.push(doc.ref.delete());
        });
      }
      if (state.deviceId) {
        const snapByDeviceId = await db.collection('guests')
          .where('deviceId', '==', state.deviceId)
          .get();
        snapByDeviceId.forEach(doc => {
          deletePromises.push(doc.ref.delete());
        });
      }
      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
        console.log(`Deleted ${deletePromises.length} matching guest visitor records from Firestore.`);
      }

      // 5. Update local state and clear guest identifier from storage
      localStorage.removeItem("guestId");
      state.guestId = null;
      state.userId = uid;
      state.userType = 'registered';

    } catch (e) {
      console.error("Error migrating guest data to user:", e);
    }
  }

  async function handleAuthSubmit() {
    const nameInput = document.getElementById('auth-name');
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const errorEl = document.getElementById('auth-error-msg');
    
    const name = nameInput ? nameInput.value.trim() : '';
    const rawEmailOrPhone = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    const isSignUp = currentAuthMode === 'register';

    if (isSignUp && !name) {
      if (errorEl) {
        errorEl.textContent = 'يرجى إدخال الاسم الكامل أو اسم المطبعة';
        errorEl.style.display = 'block';
      }
      return;
    }

    if (!rawEmailOrPhone) {
      if (errorEl) {
        errorEl.textContent = 'يرجى إدخال البريد الإلكتروني أو رقم الهاتف';
        errorEl.style.display = 'block';
      }
      return;
    }

    if (currentAuthMode !== 'forgot' && !password) {
      if (errorEl) {
        errorEl.textContent = 'يرجى إدخال كلمة المرور';
        errorEl.style.display = 'block';
      }
      return;
    }

    // تحديد نوع المدخل وتطبيعه
    let normalizedEmail = rawEmailOrPhone;
    const isEmail = rawEmailOrPhone.includes('@');

    if (!isEmail) {
      // رقم هاتف: تنظيف الرموز والمسافات
      const cleanPhone = rawEmailOrPhone.replace(/[\s\-\(\)]/g, '');
      const isPhoneRegex = /^\+?[0-9]{6,15}$/;
      if (!isPhoneRegex.test(cleanPhone)) {
        if (errorEl) {
          errorEl.textContent = 'يرجى إدخال رقم هاتف صحيح';
          errorEl.style.display = 'block';
        }
        return;
      }
      normalizedEmail = `${cleanPhone}@autorass-phone.com`;
    }

    if (isFirebaseAvailable && auth) {
      try {
        if (errorEl) errorEl.style.display = 'none';

        if (currentAuthMode === 'forgot') {
          if (!isEmail) {
            if (errorEl) {
              errorEl.textContent = 'استعادة كلمة المرور تلقائياً غير متاحة لحسابات أرقام الهواتف. يرجى التواصل مع الدعم الفني عبر واتساب لمساعدتك.';
              errorEl.style.display = 'block';
            }
            return;
          }
          showToast('جاري إرسال رابط استعادة كلمة المرور...', 'info');
          await auth.sendPasswordResetEmail(normalizedEmail);
          showToast('✉️ تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني بنجاح!', 'success');
          setAuthMode('login');
          if (passwordInput) passwordInput.value = '';
          return;
        }

        if (isSignUp) {
          showToast('جاري إنشاء الحساب...', 'info');
          const guestIdBeforeSignUp = localStorage.getItem("guestId");
          const userCredential = await auth.createUserWithEmailAndPassword(normalizedEmail, password);
          const newUid = userCredential.user.uid;
          
          if (name) {
            try {
              await userCredential.user.updateProfile({
                displayName: name
              });
            } catch (pErr) {
              console.warn("Failed to set Firebase displayName:", pErr);
            }
          }

          try {
            await transferGuestDataToUser(guestIdBeforeSignUp, newUid, name);
          } catch (err) {
            console.error("Error during guest migration:", err);
          }
          
          showToast('🎉 تم إنشاء الحساب وتسجيل الدخول بنجاح!', 'success');
        } else {
          showToast('جاري تسجيل الدخول...', 'info');
          const guestIdBeforeSignIn = localStorage.getItem("guestId");
          const userCredential = await auth.signInWithEmailAndPassword(normalizedEmail, password);
          const newUid = userCredential.user.uid;
          
          try {
            await transferGuestDataToUser(guestIdBeforeSignIn, newUid, null);
          } catch (err) {
            console.error("Error during guest migration:", err);
          }
          
          showToast('👋 تم تسجيل الدخول بنجاح!', 'success');
        }

        if (nameInput) nameInput.value = '';
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
        closeModal('modal-auth');
      } catch (e) {
        if (errorEl) {
          errorEl.textContent = getAuthErrorMessage(e.code) || e.message;
          errorEl.style.display = 'block';
        }
      }
    } else {
      // وضع المحاكاة المحلية
      if (currentAuthMode === 'forgot') {
        showToast('محاكاة: تم إرسال رابط استعادة كلمة المرور إلى البريد الإلكتروني ✅', 'success');
        setAuthMode('login');
        return;
      }

      localStorage.setItem('autorass_mock_user', JSON.stringify({ email: normalizedEmail, name }));
      state.email = normalizedEmail;
      state.name = name;
      state.status = 'trial';
      state.plan = 'free';
      saveToCache();
      updateUI();
      updateSubscriptionPanel();
      closeModal('modal-auth');
      showToast('تم تسجيل الدخول بنجاح (وضع محاكاة محلي) ✅', 'success');
    }
  }

  async function handleGoogleAuthSubmit() {
    const errorEl = document.getElementById('auth-error-msg');
    
    if (isFirebaseAvailable && auth) {
      try {
        if (errorEl) errorEl.style.display = 'none';
        showToast('جاري تسجيل الدخول بواسطة جوجل...', 'info');
        
        const guestIdBeforeSignIn = localStorage.getItem("guestId");
        
        const provider = new firebase.auth.GoogleAuthProvider();
        const userCredential = await auth.signInWithPopup(provider);
        const newUid = userCredential.user.uid;
        
        try {
          await transferGuestDataToUser(guestIdBeforeSignIn, newUid);
        } catch (err) {
          console.error("Error during guest migration:", err);
        }
        
        showToast('👋 تم تسجيل الدخول بواسطة جوجل بنجاح!', 'success');
        closeModal('modal-auth');
      } catch (e) {
        console.error("Google Auth error:", e);
        if (errorEl) {
          errorEl.textContent = getAuthErrorMessage(e.code) || e.message;
          errorEl.style.display = 'block';
        }
      }
    } else {
      // وضع المحاكاة المحلية
      const mockEmail = "google-user@example.com";
      localStorage.setItem('autorass_mock_user', JSON.stringify({ email: mockEmail }));
      state.email = mockEmail;
      state.status = 'trial';
      state.plan = 'free';
      saveToCache();
      updateUI();
      updateSubscriptionPanel();
      closeModal('modal-auth');
      showToast('تم تسجيل الدخول بواسطة جوجل (وضع محاكاة محلي) ✅', 'success');
    }
  }

  function getAuthErrorMessage(code) {
    const messages = {
      'auth/invalid-email': 'البريد الإلكتروني المدخل غير صالح.',
      'auth/user-disabled': 'تم تعطيل هذا الحساب.',
      'auth/user-not-found': 'لم يتم العثور على مستخدم بهذا البريد الإلكتروني.',
      'auth/wrong-password': 'كلمة المرور غير صحيحة.',
      'auth/email-already-in-use': 'هذا البريد الإلكتروني مستخدم بالفعل من قبل حساب آخر.',
      'auth/weak-password': 'كلمة المرور ضعيفة جداً. يجب أن تتكون من 6 أحرف على الأقل.',
      'auth/missing-email': 'يرجى إدخال البريد الإلكتروني.',
      'auth/network-request-failed': 'فشل في الاتصال بالشبكة. يرجى التحقق من اتصالك بالإنترنت.'
    };
    return messages[code] || null;
  }

  function closePaywall() {
    const overlay = document.getElementById('paywall-overlay');
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = 'auto';
  }

  function showToast(msg, type = 'info') {
    if (window.AppUI && window.AppUI.showToast) {
      window.AppUI.showToast(msg, type);
    }
  }

  function isAdmin() {
    if (auth && auth.currentUser) {
      const email = (auth.currentUser.email || '').toLowerCase();
      const uid = auth.currentUser.uid;
      const lowerAdmins = ADMIN_EMAILS.map(e => e.toLowerCase());
      return lowerAdmins.includes(email) || ADMIN_UIDS.includes(uid);
    }
    return false;
  }

  return {
    init,
    subscribePlan,
    activateByEmail,
    verifyAccess,
    getState: () => ({ ...state }),
    isTrial: () => state.status === 'trial',
    shouldShowWatermark: () => {
      if (state.status !== 'trial') return false;
      if (!state.trialExpires) return false;
      const remainingMs = state.trialExpires - Date.now();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      return remainingMs >= 0 && remainingMs <= threeDaysMs;
    },
    isPaid: () => state.status === 'paid',
    isExpired: () => state.status === 'expired',
    isAdmin,
    getSubscriptionInfo,
    renderSubscriptionStatus,
    loadUserSubscription,
    incrementLimit
  };

})();

window.ProtectionSystem = ProtectionSystem;
window.getSubscriptionInfo = ProtectionSystem.getSubscriptionInfo;
window.renderSubscriptionStatus = ProtectionSystem.renderSubscriptionStatus;
window.loadUserSubscription = ProtectionSystem.loadUserSubscription;
window.isAdmin = ProtectionSystem.isAdmin;
