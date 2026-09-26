<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { getAppUrls } from '$lib/utils/app-urls.js';
  import { setCookie } from '$lib/utils/utils.js';
  import { toApiUrl } from '$lib/config/api.js';

  let errorMsg = '';
  let statusText = 'Authenticating with Materio...';
  let isRetrying = false;

  onMount(async () => {
    const code = $page.url.searchParams.get('code') || $page.url.searchParams.get('handoff');
    const appUrls = getAppUrls(window.location.origin);
    const callbackUrl = window.location.origin + '/auth/callback';

    // Loop prevention: check how many times we've tried without completing
    const attempts = parseInt(sessionStorage.getItem('materio_auth_attempts') || '0', 10);

    if (!code) {
      if (attempts >= 2) {
        sessionStorage.removeItem('materio_auth_attempts');
        errorMsg = 'Login could not be completed. Please try again.';
        return;
      }
      sessionStorage.setItem('materio_auth_attempts', String(attempts + 1));
      errorMsg = 'No authentication code provided.';
      setTimeout(() => {
        window.location.href = `${appUrls.auth}/login?callback=${encodeURIComponent(callbackUrl)}`;
      }, 1500);
      return;
    }

    try {
      statusText = 'Exchanging session credentials...';
      let data = null;

      // 1. Attempt exchange via backend proxy (resolves to Cloudflare remote in native apps)
      const targetEndpoint = toApiUrl('/api/v2/login');
      try {
        const localRes = await fetch(targetEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'exchange', code })
        });
        if (localRes.ok) {
          data = await localRes.json();
        }
      } catch (e) {
        console.warn('Backend /api/v2/login exchange error:', e);
      }

      // 2. Fallback to direct auth server if local proxy didn't succeed
      if (!data || !data.token) {
        try {
          const directRes = await fetch(`${appUrls.auth}/api/v2/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'exchange', code })
          });
          if (directRes.ok) {
            data = await directRes.json();
          }
        } catch (e) {
          console.warn('Direct auth exchange error:', e);
        }
      }

      if (!data || !data.token) {
        throw new Error(data?.error || 'Authentication exchange failed');
      }

      // Successful exchange: clear loop counter
      sessionStorage.removeItem('materio_auth_attempts');

      // 3. Persist session tokens & user in localStorage & cookies
      const token = data.token;
      const user = data.user || null;

      localStorage.setItem('token', token);
      localStorage.setItem('materio_auth_token', token);
      setCookie('token', token, 7);
      setCookie('materio_auth_token', token, 7);

      if (user) {
        const userJson = JSON.stringify(user);
        localStorage.setItem('user', userJson);
        localStorage.setItem('materio_user', userJson);
        setCookie('user', userJson, 7);
        setCookie('materio_user', userJson, 7);
      }

      statusText = 'Login successful! Redirecting to app...';

      // Dispatch auth:login event for any active listeners
      window.dispatchEvent(new CustomEvent('auth:login', { detail: { user, token } }));

      // 4. Redirect to returnUrl or app root
      const returnUrl = sessionStorage.getItem('auth_redirect') || '/';
      sessionStorage.removeItem('auth_redirect');

      setTimeout(() => {
        window.location.assign(returnUrl);
      }, 300);

    } catch (err) {
      console.error('Handoff error:', err);
      errorMsg = err.message || 'Failed to authenticate';
      
      // Stop looping: if we failed, do not immediately auto-redirect again
      sessionStorage.removeItem('materio_auth_attempts');
    }
  });

  function retryLogin() {
    sessionStorage.removeItem('materio_auth_attempts');
    const appUrls = getAppUrls(window.location.origin);
    const callbackUrl = window.location.origin + '/auth/callback';
    window.location.href = `${appUrls.auth}/login?callback=${encodeURIComponent(callbackUrl)}`;
  }

  function goToApp() {
    window.location.assign('/');
  }
</script>

{#if errorMsg}
  <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #faf9f5; font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px;">
    <div style="max-width: 400px; width: 100%; background: #fff; border: 1px solid #e5e5e0; border-radius: 12px; padding: 28px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
      <div style="font-size: 32px; margin-bottom: 12px;">⚠️</div>
      <h2 style="font-size: 18px; font-weight: 600; color: #1c1917; margin-bottom: 8px;">Authentication Issue</h2>
      <p style="font-size: 14px; color: #78716c; margin-bottom: 20px; line-height: 1.5;">{errorMsg}</p>
      <div style="display: flex; gap: 10px;">
        <button on:click={retryLogin} style="flex: 1; padding: 10px 16px; background: #1c1917; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer;">
          Try Again
        </button>
        <button on:click={goToApp} style="flex: 1; padding: 10px 16px; background: #f5f5f4; color: #1c1917; border: 1px solid #e5e5e0; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer;">
          Open App
        </button>
      </div>
    </div>
  </div>
{:else}
  <div style="min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #faf9f5; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
    <div style="width: 32px; height: 32px; border: 3px solid #e5e5e0; border-top-color: #1c1917; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px;"></div>
    <p style="font-size: 14px; color: #78716c;">{statusText}</p>
  </div>
  <style>
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
{/if}
