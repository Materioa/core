// SECURE: Use IIFE to prevent global access and manipulation
(function () {
  'use strict';

  // Private variables - cannot be accessed from console
  let verifiedPlusStatus = false;
  let statusVerified = false;

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
      // Get auth token from localStorage
      const authToken = localStorage.getItem('materio_auth_token');
      if (!authToken) {
        // Not logged in, skip server verification
        return false;
      }

      const response = await fetch('/api/v2/profile', {
        method: 'GET',
        credentials: 'include', // Send cookies for authentication
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
      // Check for Plus users OR Super users (admin privileges)
      return data.user?.isPlusUser === true || data.user?.hasAdminPrivileges === true;

    } catch (error) {
      console.error('Plus status verification failed:', error);
      statusVerified = false;
      return false;
    }
  }

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', async () => {
    // SECURE: Verify plus status from server (recommended)
    verifiedPlusStatus = await verifyPlusStatusFromServer();

    // If server verification succeeded, show button for plus users
    if (verifiedPlusStatus && statusVerified) {
      toggleDownloadButton(true);
      return;
    }

    // For non-plus users, check cookie preference (can be manipulated but harmless)
    const downloadVisible = getCookie('downloadVisible');
    statusVerified = true; // Allow cookie-based toggle for non-plus users
    toggleDownloadButton(downloadVisible === 'true');
  });

  // OPTIONAL: Expose only a read-only status checker (no manipulation possible)
  Object.defineProperty(window, 'checkPlusStatus', {
    value: function () {
      return verifiedPlusStatus && statusVerified;
    },
    writable: false,
    configurable: false,
    enumerable: false
  });

})();
