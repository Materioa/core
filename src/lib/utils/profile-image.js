/**
 * Profile Image Module (ESM)
 * Handles user profile image display, dropdown functionality, account card updates,
 * and version badge switching based on user privileges.
 */

import { setCookie, getCookie } from './utils.js';
import { getAppUrls, getLoginUrl, getOverviewUrl } from './app-urls.js';

const LOCAL_STORAGE_TOKEN_KEY = 'token';
const LEGACY_STORAGE_TOKEN_KEY = 'materio_auth_token';
const LOCAL_STORAGE_USER_KEY = 'user';
const LEGACY_STORAGE_USER_KEY = 'materio_user';

/**
 * Returns verification badge inline SVG for consistent rendering without external icon fonts.
 * @param {'admin'|'pro'|'plus'} type 
 * @returns {string}
 */
function getBadgeCheckSvg(type) {
  const title = type === 'admin' ? 'Admin' : (type === 'pro' ? 'Pro User' : 'Plus User');
  return `<svg class="hgi hgi-checkmark-badge-01 verified-badge ${type}" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="${title}" aria-label="${title}" style="display: inline-block; vertical-align: middle; margin-left: 4px;">
    <path d="M18.9905 19H19M18.9905 19C18.3678 19.6175 17.2393 19.4637 16.4479 19.4637C15.4765 19.4637 15.0087 19.6537 14.3154 20.347C13.7251 20.9374 12.9337 22 12 22C11.0663 22 10.2749 20.9374 9.68457 20.347C8.99128 19.6537 8.52349 19.4637 7.55206 19.4637C6.76068 19.4637 5.63218 19.6175 5.00949 19C4.38181 18.3776 4.53628 17.2444 4.53628 16.4479C4.53628 15.4414 4.31616 14.9786 3.59938 14.2618C2.53314 13.1956 2.00002 12.6624 2 12C2.00001 11.3375 2.53312 10.8044 3.59935 9.73817C4.2392 9.09832 4.53628 8.46428 4.53628 7.55206C4.53628 6.76065 4.38249 5.63214 5 5.00944C5.62243 4.38178 6.7556 4.53626 7.55208 4.53626C8.46427 4.53626 9.09832 4.2392 9.73815 3.59937C10.8044 2.53312 11.3375 2 12 2C12.6625 2 13.1956 2.53312 14.2618 3.59937C14.9015 4.23907 15.5355 4.53626 16.4479 4.53626C17.2393 4.53626 18.3679 4.38247 18.9906 5C19.6182 5.62243 19.4637 6.75559 19.4637 7.55206C19.4637 8.55858 19.6839 9.02137 20.4006 9.73817C21.4669 10.8044 22 11.3375 22 12C22 12.6624 21.4669 13.1956 20.4006 14.2618C19.6838 14.9786 19.4637 15.4414 19.4637 16.4479C19.4637 17.2444 19.6182 18.3776 18.9905 19Z" stroke="currentColor"></path>
    <path d="M9 12.8929C9 12.8929 10.2 13.5447 10.8 14.5C10.8 14.5 12.6 10.75 15 9.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>`;
}

export function isUserLoggedIn() {
  if (typeof window === 'undefined') return false;
  const token = getCookie(LOCAL_STORAGE_TOKEN_KEY) ||
                getCookie(LEGACY_STORAGE_TOKEN_KEY) ||
                localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY) ||
                localStorage.getItem(LEGACY_STORAGE_TOKEN_KEY);

  if (!token) {
    if (localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY) || localStorage.getItem(LEGACY_STORAGE_TOKEN_KEY)) {
      localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
      localStorage.removeItem(LEGACY_STORAGE_TOKEN_KEY);
      localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
      localStorage.removeItem(LEGACY_STORAGE_USER_KEY);
    }
    return false;
  }
  return true;
}

export function getUserData() {
  if (typeof localStorage === 'undefined') return null;
  const userData = localStorage.getItem(LOCAL_STORAGE_USER_KEY) ||
                   localStorage.getItem(LEGACY_STORAGE_USER_KEY) ||
                   getCookie(LOCAL_STORAGE_USER_KEY) ||
                   getCookie(LEGACY_STORAGE_USER_KEY);
  if (!userData) return null;

  try {
    return typeof userData === 'string' ? JSON.parse(userData) : userData;
  } catch (error) {
    console.error('Error parsing user data:', error);
    return null;
  }
}

export function updateProfileImage(imgElement) {
  const user = getUserData();
  if (imgElement) {
    if (user?.profilePicture) {
      imgElement.src = user.profilePicture;
    } else {
      imgElement.src = '/assets/img/default-avatar.svg';
    }
  }
}

/**
 * Updates the #versionInfo element in the Settings tab based on user privileges.
 * Matches parent Materio main.js:
 *   - default: 4.8.svg (via #versionInfo::after)
 *   - admin: sup.svg (via #versionInfo.admin-user::after)
 *   - pro/plus: pro.svg (via #versionInfo.pro-user::after)
 *   - lite: plu.svg (via #versionInfo.plus-user::after)
 */
export function updateVersionInfo() {
  if (typeof document === 'undefined') return;
  const versionInfo = document.getElementById('versionInfo');
  if (!versionInfo) return;

  // Remove existing privilege classes
  versionInfo.classList.remove(
    'premium-user',
    'plus-user',
    'admin-user',
    'super-user',
    'pro-user'
  );

  const user = getUserData();
  const isLoggedIn = isUserLoggedIn();

  if (isLoggedIn && user) {
    if (user.hasAdminPrivileges || user.isAdmin) {
      versionInfo.classList.add('admin-user');
    } else if (user.isProUser || user.isPlusUser) {
      versionInfo.classList.add('pro-user');
    } else if (user.isLiteUser) {
      versionInfo.classList.add('plus-user');
    }
  }

  // Force reflow for SVG background update
  const display = versionInfo.style.display;
  versionInfo.style.display = 'none';
  versionInfo.offsetHeight;
  versionInfo.style.display = display;
}

/**
 * Updates account card in Settings tab with user profile picture, display name,
 * username, verification badge, and links.
 */
export function updateAccountCard(accountProfileImage, accountName, accountUsername) {
  const user = getUserData();
  const isLoggedIn = isUserLoggedIn();
  const accountLink = document.querySelector('.account-link');
  const accountCard = document.querySelector('.account-card');
  const targetUrl = isLoggedIn ? getOverviewUrl() : getLoginUrl();

  if (accountCard) {
    accountCard.onclick = () => {
      window.location.href = targetUrl;
    };
  }

  if (isLoggedIn && user) {
    // 1. Profile Picture
    if (accountProfileImage) {
      accountProfileImage.src = user.profilePicture || '/assets/img/default-avatar.svg';
    }

    // 2. Display Name & Verification Badge
    if (accountName) {
      const name = user.displayName || user.username || user.name || 'Materio User';
      let badgeHtml = '';

      if (user.hasAdminPrivileges || user.isAdmin) {
        badgeHtml = getBadgeCheckSvg('admin');
      } else if (user.isProUser || user.isPlusUser) {
        badgeHtml = getBadgeCheckSvg('pro');
      } else if (user.isLiteUser) {
        badgeHtml = getBadgeCheckSvg('plus');
      }

      accountName.innerHTML = `${name}${badgeHtml}`;
    }

    // 3. Username
    if (accountUsername) {
      accountUsername.textContent = user.username ? '@' + user.username : '';
    }

    // 4. Manage Account link -> accounts.getmaterio.app/overview
    if (accountLink) {
      accountLink.href = targetUrl;
      accountLink.setAttribute('rel', 'external');
      accountLink.setAttribute('aria-label', 'Manage Account');
    }
  } else {
    // Unauthenticated state
    if (accountProfileImage) {
      accountProfileImage.src = '/assets/img/default-avatar.svg';
    }
    if (accountName) {
      accountName.textContent = 'Log in to Materio Account';
    }
    if (accountUsername) {
      accountUsername.textContent = '';
    }
    if (accountLink) {
      accountLink.href = targetUrl;
      accountLink.setAttribute('rel', 'external');
      accountLink.setAttribute('aria-label', 'Log In to Materio Account');
    }
  }
}

export function showSettingsTab() {
  if (typeof window !== 'undefined' && window.__materioSetTab) {
    window.__materioSetTab('settings');
    return;
  }
  const tabLinks = document.querySelectorAll('.tab-link');
  const tabContents = document.querySelectorAll('.tab-content');
  const settingsContent = document.getElementById('settings');

  if (!settingsContent) return;

  tabLinks.forEach(tab => {
    tab.classList.remove('active');
    const icon = tab.querySelector('i');
    if (icon && !tab.querySelector('img')) {
      icon.classList.remove('fas');
      icon.classList.add('far');
    }
  });
  tabContents.forEach(content => content.classList.remove('active'));

  const profileIcon = document.querySelector('.profile-icon');
  if (profileIcon) {
    profileIcon.classList.add('active');
    const icon = profileIcon.querySelector('i');
    if (icon && !profileIcon.querySelector('img')) {
      icon.classList.remove('far');
      icon.classList.add('fas');
    }
  }

  settingsContent.classList.add('active');

  const searchResults = document.getElementById('quickSearchResults');
  if (searchResults) {
    searchResults.style.display = 'none';
  }

  setCookie('activeTab', 'settings', 7);
}

export function showDownloadsTab() {
  if (typeof window !== 'undefined' && window.__materioSetTab) {
    window.__materioSetTab('downloads');
    return;
  }
  const tabLinks = document.querySelectorAll('.tab-link');
  const tabContents = document.querySelectorAll('.tab-content');
  const downloadsContent = document.getElementById('downloads');

  if (!downloadsContent) return;

  tabLinks.forEach(tab => tab.classList.remove('active'));
  tabContents.forEach(content => content.classList.remove('active'));

  const profileIcon = document.querySelector('.profile-icon');
  if (profileIcon) {
    profileIcon.classList.add('active');
  }

  downloadsContent.classList.add('active');

  const searchResults = document.getElementById('quickSearchResults');
  if (searchResults) {
    searchResults.style.display = 'none';
  }

  setCookie('activeTab', 'downloads', 7);

  setTimeout(() => {
    document.dispatchEvent(new Event('downloadsTabOpened'));
  }, 100);
}

export function adjustDropdownParent() {
  if (typeof window === 'undefined') return;
  const profileDropdown = document.getElementById('profile-dropdown');
  const backdrop = document.getElementById('profile-dropdown-backdrop');
  const profileContainer = document.querySelector('.profile-icon-container');
  
  if (!profileDropdown || !profileContainer) return;
  
  const isMobile = window.innerWidth <= 768;
  const currentParent = profileDropdown.parentElement;
  
  if (isMobile) {
    if (currentParent !== document.body) {
      document.body.appendChild(profileDropdown);
      if (backdrop) document.body.appendChild(backdrop);
    }
  } else {
    if (currentParent !== profileContainer) {
      profileContainer.appendChild(profileDropdown);
      if (backdrop) profileContainer.appendChild(backdrop);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', adjustDropdownParent);
}

export function setProfileDropdownOpen(show) {
  adjustDropdownParent();
  const profileDropdown = document.getElementById('profile-dropdown');
  const backdrop = document.getElementById('profile-dropdown-backdrop');
  if (!profileDropdown) return;

  if (show) {
    document.body.classList.add('profile-dropdown-open');
    profileDropdown.classList.add('show');
    profileDropdown.setAttribute('aria-hidden', 'false');
    if (backdrop) backdrop.classList.add('show');
    
    const dropdownItems = profileDropdown.querySelectorAll('.dropdown-item');
    dropdownItems.forEach(item => item.setAttribute('tabindex', '0'));
    dropdownItems[0]?.focus();
  } else {
    document.body.classList.remove('profile-dropdown-open');
    profileDropdown.classList.remove('show');
    profileDropdown.setAttribute('aria-hidden', 'true');
    if (backdrop) backdrop.classList.remove('show');
    
    profileDropdown.querySelectorAll('.dropdown-item').forEach(item => item.setAttribute('tabindex', '-1'));
    profileDropdown.querySelectorAll('.has-submenu').forEach(p => p.classList.remove('submenu-open'));
  }
}

function handleOutsideClick(e) {
  const profileIconLink = document.querySelector('.profile-icon');
  const profileDropdown = document.getElementById('profile-dropdown');

  if (profileDropdown &&
    !profileIconLink?.contains(e.target) &&
    !profileDropdown.contains(e.target) &&
    !e.target.closest('#profile-dropdown-backdrop')) {
    setProfileDropdownOpen(false);
  }
}

function handleDropdownKeydown(e) {
  const profileDropdown = document.getElementById('profile-dropdown');
  const profileIconLink = document.querySelector('.profile-icon');

  if (!profileDropdown?.classList.contains('show')) return;

  const items = profileDropdown.querySelectorAll('.dropdown-item');
  const currentIndex = Array.from(items).indexOf(document.activeElement);

  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      setProfileDropdownOpen(false);
      profileIconLink?.focus();
      break;
    case 'ArrowDown':
      e.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
      break;
    case 'ArrowUp':
      e.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
      break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      if (document.activeElement?.classList.contains('dropdown-item')) {
        document.activeElement.click();
      }
      break;
  }
}

export function setupProfileDropdown(profileIconLink, profileDropdown) {
  if (!profileIconLink || !profileDropdown) return;

  profileIconLink.classList.add('has-dropdown');

  profileIconLink.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!e.target.closest('.profile-dropdown')) {
      const isShowing = profileDropdown.classList.contains('show');

      if (window.MaterioHaptics) {
        window.MaterioHaptics.vibrate(isShowing ? 'dropdownClose' : 'dropdownOpen');
      }

      setProfileDropdownOpen(!isShowing);
    }
  }, true);

  const settingsItem = profileDropdown.querySelector('.dropdown-item[data-action="settings"]');
  if (settingsItem) {
    settingsItem.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      if (window.MaterioHaptics) {
        window.MaterioHaptics.vibrate('select');
      }

      setProfileDropdownOpen(false);
      showSettingsTab();
    });
  }

  const downloadsItem = profileDropdown.querySelector('.dropdown-item[data-action="downloads"]');
  if (downloadsItem) {
    downloadsItem.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      if (window.MaterioHaptics) {
        window.MaterioHaptics.vibrate('select');
      }

      setProfileDropdownOpen(false);
      showDownloadsTab();
    });
  }

  profileDropdown.addEventListener('click', function (e) {
    const backBtn = e.target.closest('.submenu-back-btn');
    if (backBtn) {
      e.preventDefault();
      e.stopPropagation();
      const parent = backBtn.closest('.has-submenu');
      if (parent) {
        parent.classList.remove('submenu-open');
        if (window.MaterioHaptics) {
          window.MaterioHaptics.vibrate('dropdownClose');
        }
      }
      return;
    }

    const parent = e.target.closest('.has-submenu');
    if (!parent) return;

    if (e.target.closest('.dropdown-submenu')) return;

    e.preventDefault();
    e.stopPropagation();

    const isOpening = !parent.classList.contains('submenu-open');

    profileDropdown.querySelectorAll('.has-submenu').forEach(p => {
      if (p !== parent) p.classList.remove('submenu-open');
    });

    parent.classList.toggle('submenu-open');

    if (window.MaterioHaptics) {
      window.MaterioHaptics.vibrate(isOpening ? 'dropdownOpen' : 'dropdownClose');
    }
  });

  profileDropdown.addEventListener('click', function (e) {
    const item = e.target.closest('.dropdown-submenu .dropdown-item');
    if (!item || item.classList.contains('submenu-back-btn')) return;

    setProfileDropdownOpen(false);

    if (window.MaterioHaptics) {
      window.MaterioHaptics.vibrate('select');
    }
  });

  const backdrop = document.getElementById('profile-dropdown-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setProfileDropdownOpen(false);
    });
  }

  document.removeEventListener('click', handleOutsideClick);
  document.removeEventListener('keydown', handleDropdownKeydown);
  document.addEventListener('click', handleOutsideClick);
  document.addEventListener('keydown', handleDropdownKeydown);

  profileDropdown.setAttribute('aria-hidden', 'true');
}

if (typeof window !== 'undefined') {
  window.handleLogout = function () {
    localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
    localStorage.removeItem(LEGACY_STORAGE_TOKEN_KEY);
    localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
    localStorage.removeItem(LEGACY_STORAGE_USER_KEY);
    localStorage.removeItem('user_plan');

    document.cookie = LOCAL_STORAGE_TOKEN_KEY + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = LEGACY_STORAGE_TOKEN_KEY + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = LOCAL_STORAGE_USER_KEY + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = LEGACY_STORAGE_USER_KEY + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

    const sessionId = sessionStorage.getItem('materio_session_id');
    if (sessionId && navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_SESSION_ASSETS', sessionId: sessionId });
    }
    sessionStorage.removeItem('materio_session_id');
    sessionStorage.clear();

    if (window.MaterioHaptics) {
      window.MaterioHaptics.vibrate('success');
    }

    // Re-initialize UI state
    init();

    window.dispatchEvent(new CustomEvent('auth:logout'));

    setTimeout(() => {
      window.location.reload();
    }, 100);
  };

  window.setProfileDropdownOpen = setProfileDropdownOpen;
  window.showSettingsTab = showSettingsTab;
  window.showDownloadsTab = showDownloadsTab;
}

export function init() {
  if (typeof document === 'undefined') return;

  const profileImage = document.getElementById('profile-image');
  const settingsIcon = document.getElementById('settings-icon');
  const accountProfileImage = document.getElementById('account-profile-image');
  const accountName = document.getElementById('account-name');
  const accountUsername = document.getElementById('account-username');
  const profileDropdown = document.getElementById('profile-dropdown');
  const profileIconLink = document.querySelector('.profile-icon');

  const profileMenuItem = document.getElementById('profile-menu-item');
  const profileItemText = document.getElementById('profile-item-text');
  const profileOverviewLink = profileDropdown?.querySelector('a[href*="/account/profile"], a[href*="/overview"]');

  const isLoggedIn = isUserLoggedIn();
  const user = getUserData();

  // 1. Update Profile Menu Item inside dropdown
  if (profileMenuItem) {
    if (isLoggedIn) {
      profileMenuItem.classList.add('has-submenu');
      profileMenuItem.onclick = null;
      if (profileItemText) profileItemText.textContent = 'Profile';
      if (profileOverviewLink) {
        profileOverviewLink.href = getOverviewUrl();
        profileOverviewLink.setAttribute('rel', 'external');
      }
    } else {
      profileMenuItem.classList.remove('has-submenu');
      if (profileItemText) profileItemText.textContent = 'Account';
      // Clicking account when unauthenticated redirects to SSO login
      profileMenuItem.onclick = (e) => {
        if (!profileMenuItem.classList.contains('has-submenu') && !isUserLoggedIn()) {
          e.preventDefault();
          window.location.href = getLoginUrl();
        }
      };
    }
  }

  // 2. Update navbar avatar
  if (profileImage && settingsIcon) {
    if (isLoggedIn && user?.profilePicture) {
      profileImage.src = user.profilePicture;
      profileImage.style.display = 'block';
      settingsIcon.style.display = 'none';
    } else {
      profileImage.src = '/assets/img/default-avatar.svg';
      profileImage.style.display = 'block';
      settingsIcon.style.display = 'none';
    }

    setupProfileDropdown(profileIconLink, profileDropdown);
    adjustDropdownParent();
  }

  // 3. Update account card in settings
  updateAccountCard(accountProfileImage, accountName, accountUsername);

  // 4. Update version logo based on user privileges (4.8.svg vs sup.svg vs pro.svg)
  updateVersionInfo();

  // 5. Check URL for handoff code parameter (?handoff=... or ?code=...)
  if (typeof window !== 'undefined' && window.location.search) {
    const urlParams = new URLSearchParams(window.location.search);
    const handoffCode = urlParams.get('handoff') || urlParams.get('code');

    if (handoffCode) {
      const appUrls = getAppUrls(window.location.origin);
      
      const doExchange = async () => {
        try {
          let data = null;
          try {
            const res = await fetch('/api/v2/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: handoffCode, action: 'exchange' })
            });
            if (res.ok) data = await res.json();
          } catch {}

          if (!data || !data.token) {
            const direct = await fetch(`${appUrls.auth}/api/v2/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: handoffCode, action: 'exchange' })
            });
            data = await direct.json();
          }

          if (data && data.token) {
            const token = data.token;
            const receivedUser = data.user || null;

            localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, token);
            localStorage.setItem(LEGACY_STORAGE_TOKEN_KEY, token);
            setCookie(LOCAL_STORAGE_TOKEN_KEY, token, 7);
            setCookie(LEGACY_STORAGE_TOKEN_KEY, token, 7);

            if (receivedUser) {
              const uJson = JSON.stringify(receivedUser);
              localStorage.setItem(LOCAL_STORAGE_USER_KEY, uJson);
              localStorage.setItem(LEGACY_STORAGE_USER_KEY, uJson);
              setCookie(LOCAL_STORAGE_USER_KEY, uJson, 7);
              setCookie(LEGACY_STORAGE_USER_KEY, uJson, 7);
            }

            // Remove handoff code from URL
            urlParams.delete('handoff');
            urlParams.delete('code');
            const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '') + window.location.hash;
            window.history.replaceState({}, document.title, newUrl);

            // Re-render UI
            init();

            window.dispatchEvent(new CustomEvent('auth:login', { detail: { user: receivedUser, token } }));
          }
        } catch (err) {
          console.error('Handoff exchange failed:', err);
        }
      };

      doExchange();
    }
  }
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

export default {
  init,
  isUserLoggedIn,
  getUserData,
  updateProfileImage,
  updateAccountCard,
  updateVersionInfo,
  showSettingsTab,
  showDownloadsTab
};
