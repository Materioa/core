<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { getAppUrls } from '$lib/utils/app-urls.js';
  import { setCookie } from '$lib/utils/utils.js';
  import { toApiUrl } from '$lib/config/api.js';

  let errorMsg = '';
  let statusText = 'Authenticating with Materio...';

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

<svelte:head>
  <title>Authenticating | Materio</title>
</svelte:head>

<div class="auth-callback-container">
  {#if errorMsg}
    <div class="auth-content">
      <p class="auth-error-text">{errorMsg}</p>
      <div class="auth-button-group">
        <button class="auth-btn auth-btn-primary" on:click={retryLogin}>
          Try Again
        </button>
        <button class="auth-btn auth-btn-secondary" on:click={goToApp}>
          Open App
        </button>
      </div>
    </div>
  {:else}
    <div class="auth-content">
      <div class="dots-bounce" aria-hidden="true">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
      <p class="auth-status-text">{statusText}</p>
    </div>
  {/if}
</div>

<style>
  .auth-callback-container {
    min-height: 100vh;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg, #faf9f5);
    color: var(--text, #1c1917);
    font-family: var(--font-primary, var(--font-body, 'OpenRunde', 'Open Runde', -apple-system, sans-serif));
    padding: 24px;
    box-sizing: border-box;
    transition: background 0.2s ease, color 0.2s ease;
  }

  :global(body.dark-mode) .auth-callback-container,
  :global(html.dark-mode) .auth-callback-container {
    background: var(--bg, #121212);
    color: var(--text, #f4f4f5);
  }

  .auth-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    max-width: 380px;
    width: 100%;
    animation: fadeIn 0.25s ease-out;
  }

  /* 3 Dots Bouncing Animation */
  .dots-bounce {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 18px;
    height: 24px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-primary, #ff8400);
    display: inline-block;
    animation: bounce 1.4s infinite ease-in-out both;
  }

  .dot:nth-child(1) {
    animation-delay: -0.32s;
  }

  .dot:nth-child(2) {
    animation-delay: -0.16s;
  }

  .dot:nth-child(3) {
    animation-delay: 0s;
  }

  @keyframes bounce {
    0%, 80%, 100% {
      transform: scale(0.6);
      opacity: 0.35;
    }
    40% {
      transform: scale(1.15) translateY(-6px);
      opacity: 1;
    }
  }

  .auth-status-text {
    font-size: 15px;
    font-weight: 450;
    color: var(--text, #1c1917);
    opacity: 0.75;
    margin: 0;
    line-height: 1.5;
    letter-spacing: -0.01em;
  }

  .auth-error-text {
    font-size: 15px;
    font-weight: 450;
    color: var(--text, #1c1917);
    opacity: 0.85;
    margin: 0 0 24px 0;
    line-height: 1.5;
  }

  :global(body.dark-mode) .auth-status-text,
  :global(html.dark-mode) .auth-status-text {
    color: var(--text, #f4f4f5);
    opacity: 0.75;
  }

  :global(body.dark-mode) .auth-error-text,
  :global(html.dark-mode) .auth-error-text {
    color: var(--text, #f4f4f5);
    opacity: 0.85;
  }

  /* Buttons displayed directly on background without card wrapper */
  .auth-button-group {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
  }

  .auth-btn {
    flex: 1;
    min-width: 120px;
    padding: 10px 20px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: transform 0.15s ease, background-color 0.15s ease, opacity 0.15s ease, border-color 0.15s ease;
    border: none;
    outline: none;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .auth-btn:active {
    transform: scale(0.97);
  }

  .auth-btn-primary {
    background: var(--color-primary, #ff8400);
    color: #ffffff;
  }

  .auth-btn-primary:hover {
    background: var(--color-primary-hover, #e67300);
  }

  .auth-btn-secondary {
    background: rgba(128, 128, 128, 0.12);
    color: var(--text, #1c1917);
    border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  }

  :global(body.dark-mode) .auth-btn-secondary,
  :global(html.dark-mode) .auth-btn-secondary {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text, #f4f4f5);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .auth-btn-secondary:hover {
    background: rgba(128, 128, 128, 0.18);
  }

  :global(body.dark-mode) .auth-btn-secondary:hover,
  :global(html.dark-mode) .auth-btn-secondary:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
