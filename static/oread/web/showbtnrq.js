// SECURE: Use IIFE to prevent global access and manipulation
(function () {
  'use strict';

  // Private variables - cannot be accessed from console
  let verifiedPlusStatus = false;
  let statusVerified = false;

  // Broad paid/admin matching (mirrors the /api/v2/profile server): plan
  // and role flags are spelled many ways across services (is_plus_user,
  // tier:'super', role:'owner', is_superuser, …). Accept the superset so a
  // spelling miss can never hide Plus-gated UI from entitled users.
  //
  // Product tier names: 'super' = admin tier, 'pro' = plus tier,
  // 'plus' = lite tier. Lite users get Thinklet but NEVER the save button.
  function normWord(v) {
    return String(v || '').trim().toLowerCase();
  }

  var PRO_TIERS = ['pro', 'super', 'admin', 'premium', 'lifetime', 'ultimate', 'vip', 'paid'];
  var LITE_WORDS = ['plus', 'lite'];
  var ADMIN_ROLES = ['admin', 'superadmin', 'super-admin', 'super', 'superuser', 'owner', 'root', 'staff'];

  // Save buttons: Plus-level (pro tier) or admin. Lite-only signals
  // (is_plus / isLite / tier 'plus' / role 'plus') are EXCLUDED here.
  function canSave(u) {
    if (!u || typeof u !== 'object') return false;
    if (u.isPlusUser === true || u.is_plus_user === true ||
      u.isPro === true || u.is_pro === true ||
      u.hasAdminPrivileges === true || u.has_admin_privileges === true ||
      u.isAdmin === true || u.is_admin === true ||
      u.isSuperUser === true || u.is_superuser === true ||
      u.isSuperAdmin === true || u.is_super_admin === true ||
      u.superuser === true || u.is_staff === true) return true;
    if (PRO_TIERS.indexOf(normWord(u.tier)) >= 0) return true;
    var role = normWord(u.role || u.user_role);
    if (role === 'pro' || ADMIN_ROLES.indexOf(role) >= 0) return true;
    return false;
  }

  // Thinklet: everything that can save, plus lite-tier signals.
  function canUseThinklet(u) {
    if (canSave(u)) return true;
    if (!u || typeof u !== 'object') return false;
    if (u.isLiteUser === true || u.is_lite_user === true ||
      u.is_plus === true || u.isPlus === true || u.plus === true) return true;
    var tier = normWord(u.tier);
    if (LITE_WORDS.indexOf(tier) >= 0) return true;
    var role = normWord(u.role || u.user_role);
    if (LITE_WORDS.indexOf(role) >= 0) return true;
    return false;
  }

  // Private helper functions
  function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/;SameSite=Strict`;
  }

  function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.startsWith(name + '=')) {
        return cookie.substring(name.length + 1);
      }
    }
    return null;
  }

  // Publish the verification verdict so sibling scripts (thinklet.js)
  // can reuse it instead of racing a second profile fetch.
  // Shape: { done, save, thinklet } — save excludes lite, thinklet includes it.
  function publishVerdict(save, thinklet) {
    try {
      window.__materioPlusVerified = { done: true, save: save === true, thinklet: thinklet === true };
    } catch (e) { /* ignore */ }
  }

  // Private function to toggle Plus-gated button visibility. Save buttons
  // need save-level access (Plus tier or admin — lite excluded); the
  // Thinklet AI button needs thinklet-level (includes lite). Unhiding is
  // safe: the Thinklet panel itself stays gated on its own verifiedAccess
  // check before opening.
  function toggleGatedButtons(save, thinklet) {
    // Only allow if status has been verified through proper channels
    if (!statusVerified) {
      console.warn('Unauthorized access attempt detected');
      return;
    }

    toggleDownloadButton(save);
    if (thinklet) {
      document.getElementById('thinkletButton')?.removeAttribute('hidden');
      document.getElementById('thinkletSeparator')?.removeAttribute('hidden');
    }
  }

  // Private function to toggle download button visibility
  function toggleDownloadButton(show) {
    // Only allow if status has been verified through proper channels
    if (!statusVerified) {
      console.warn('Unauthorized access attempt detected');
      return;
    }

    const downloadButton = document.getElementById('downloadButton');
    const secondaryDownloadButton = document.getElementById('secondaryDownload');
    const editorModeSeparator = document.getElementById('editorModeSeparator');

    if (show && verifiedPlusStatus) {
      downloadButton?.removeAttribute('hidden');
      secondaryDownloadButton?.removeAttribute('hidden');
      editorModeSeparator?.removeAttribute('hidden');
      setCookie('downloadVisible', 'true', 3);
    } else {
      downloadButton?.setAttribute('hidden', 'true');
      secondaryDownloadButton?.setAttribute('hidden', 'true');
      editorModeSeparator?.setAttribute('hidden', 'true');
      setCookie('downloadVisible', 'false', 3);
    }
  }

  // Server-side verification (REQUIRED for production)
  async function verifyPlusStatusFromServer() {
    try {
      // Get auth token from localStorage (both keys the app writes)
      const authToken = localStorage.getItem('materio_auth_token') || localStorage.getItem('token');
      if (!authToken) {
        // Not logged in, skip server verification
        publishVerdict(false);
        return false;
      }

      const isNative = window.location.hostname === 'tauri.localhost' ||
        window.location.protocol === 'tauri:' ||
        window.location.protocol === 'capacitor:' ||
        window.location.hostname === 'capacitor.localhost' ||
        (window.location.hostname === 'localhost' && window.location.port !== '5173');
      const profileUrl = isNative ? 'https://getmaterio.app/api/v2/profile' : '/api/v2/profile';

      const response = await fetch(profileUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (!response.ok) {
        throw new Error('Verification failed');
      }

      const data = await response.json();
      statusVerified = true;
      // Split gates: save needs Plus-level or admin (lite excluded),
      // Thinklet admits lite as well. See canSave / canUseThinklet.
      const save = canSave(data.user);
      const thinklet = canUseThinklet(data.user);
      try {
        console.info('[oread] plus check:', JSON.stringify({ save, thinklet, tier: data.user?.tier ?? null, role: data.user?.role ?? null }));
      } catch (e) { /* ignore */ }
      publishVerdict(save, thinklet);
      verifiedPlusStatus = save;
      return save;

    } catch (error) {
      console.error('Plus status verification failed:', error);
      statusVerified = false;
      publishVerdict(false);
      return false;
    }
  }

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', async () => {
    // SECURE: Verify plus status from server (recommended)
    verifiedPlusStatus = await verifyPlusStatusFromServer();

    // If server verification succeeded, show gated buttons accordingly
    if (statusVerified) {
      const v = window.__materioPlusVerified || {};
      toggleGatedButtons(v.save === true, v.thinklet === true);
      return;
    }

    // For non-plus users, check cookie preference (can be manipulated but harmless)
    const downloadVisible = getCookie('downloadVisible');
    statusVerified = true; // Allow cookie-based toggle for non-plus users
    publishVerdict(false, false);
    toggleDownloadButton(downloadVisible === 'true');
  });

  // OPTIONAL: Expose only read-only status checkers (no manipulation possible)
  Object.defineProperty(window, 'checkPlusStatus', {
    value: function () {
      return verifiedPlusStatus && statusVerified;
    },
    writable: false,
    configurable: false,
    enumerable: false
  });
  Object.defineProperty(window, '__materioCheckThinkletStatus', {
    value: function () {
      try {
        const v = window.__materioPlusVerified;
        return !!(v && v.done === true && v.thinklet === true && statusVerified);
      } catch (e) {
        return false;
      }
    },
    writable: false,
    configurable: false,
    enumerable: false
  });

})();
