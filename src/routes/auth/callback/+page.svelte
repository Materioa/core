<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { getAppUrls } from '$lib/utils/app-urls.js';
  import { setCookie } from '$lib/utils/utils.js';

  let errorMsg = '';
  let statusText = 'Authenticating with Materio...';

  onMount(async () => {
    const code = $page.url.searchParams.get('code') || $page.url.searchParams.get('handoff');
    const appUrls = getAppUrls(window.location.origin);
    const callbackUrl = window.location.origin + '/auth/callback';

    if (!code) {
      errorMsg = 'No authentication code provided.';
      setTimeout(() => {
        window.location.href = `${appUrls.auth}/login?callback=${encodeURIComponent(callbackUrl)}`;
      }, 1500);
      return;
    }

    try {
      statusText = 'Exchanging session credentials...';
      let data = null;

      // 1. Attempt local API proxy first
      try {
        const localRes = await fetch('/api/v2/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'exchange', code })
        });
        if (localRes.ok) {
          data = await localRes.json();
        }
      } catch (e) {
        console.warn('Local /api/v2/login exchange failed, attempting direct auth call...', e);
      }

      // 2. Fallback to direct auth server if local proxy didn't succeed
      if (!data || !data.token) {
        const directRes = await fetch(`${appUrls.auth}/api/v2/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'exchange', code })
        });
        data = await directRes.json();
      }

      if (!data || !data.token) {
        throw new Error(data?.error || 'Authentication exchange failed');
      }

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

      statusText = 'Login successful! Redirecting...';

      // Dispatch auth:login event for any active listeners
      window.dispatchEvent(new CustomEvent('auth:login', { detail: { user, token } }));

      // 4. Redirect to returnUrl or settings
      const returnUrl = sessionStorage.getItem('auth_redirect') || '/settings';
      sessionStorage.removeItem('auth_redirect');

      setTimeout(() => {
        window.location.assign(returnUrl);
      }, 200);

    } catch (err) {
      console.error('Handoff error:', err);
      errorMsg = err.message || 'Failed to authenticate';
      setTimeout(() => {
        window.location.href = `${appUrls.auth}/login?callback=${encodeURIComponent(callbackUrl)}`;
      }, 2500);
    }
  });
</script>

<!-- Headless handoff page: exchanges the SSO code and redirects.
     Renders nothing by design (no spinner/status UI). -->
