/**
 * Landing billing helper — mirrors the accounts billing plans.
 * Plus (UI) -> DB is_lite_user, Pro (UI) -> DB is_plus_user.
 * Checkout is created DIRECTLY against the accounts billing API (Razorpay).
 */
import { getAppUrls } from './app-urls.js';

export const LANDING_PLANS = {
  plus: {
    id: 'plus',
    label: 'Plus',
    fullLabel: 'Materio Plus',
    priceInr: 199,
    blurb: 'For everyday learners who want more AI and more space.',
    cta: 'Choose Plus',
    features: [
      '20 messages per day in Thinklet',
      'AI Summaries in Insightroom Posts',
      'Increased rate limits',
      'More Customization',
      'Create 10 Notebooks with cloud sync'
    ]
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    fullLabel: 'Materio Pro',
    priceInr: 349,
    blurb: 'For power learners who want everything, unlimited.',
    cta: 'Choose Pro',
    features: [
      'Early access to new features',
      'Download PDFs',
      'No Ratelimits',
      '50 messages per day in Thinklet',
      'AI Summaries in Insightroom + Exclusive Posts',
      '50 Notebooks with Cloud sync',
      'More Customization and Other Exclusive Perks'
    ]
  },
  weekly: {
    id: 'weekly',
    label: 'Weekly Pass',
    fullLabel: 'Materio Pro · Weekly Pass',
    priceInr: 79,
    blurb: 'Full Pro access for 7 days.',
    cta: 'Get Weekly Pass',
    features: [
      'Full Pro access for 7 days',
      'Early access to new features',
      'Download PDFs',
      'No Ratelimits',
      '50 messages per day in Thinklet',
      'AI Summaries in Insightroom + Exclusive Posts',
      '50 Notebooks with Cloud sync',
      'More Customization and Other Exclusive Perks'
    ]
  }
};

function readCookie(name) {
	try {
		const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
		return m ? decodeURIComponent(m[1]) : '';
	} catch {
		return '';
	}
}

export function readToken() {
	try {
		// Local session first, then the shared cross-app SSO cookie
		// (accounts/auth set `materio_token` on .getmaterio.app) so logged-in
		// users are never bounced to a create-account form.
		return (
			localStorage.getItem('token') ||
			localStorage.getItem('materio_auth_token') ||
			readCookie('materio_token') ||
			readCookie('token') ||
			''
		);
	} catch {
		return readCookie('materio_token') || readCookie('token') || '';
	}
}

export function accountsBase() {
  try {
    return getAppUrls().accounts || 'https://accounts.getmaterio.app';
  } catch {
    return 'https://accounts.getmaterio.app';
  }
}

function loadRazorpayScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Razorpay Checkout'));
    document.head.appendChild(s);
  });
}

/**
 * Start checkout directly from the landing page.
 * - Logged out: send to auth signup, then bounce to the pay screen.
 * - Logged in + live keys: open the Razorpay subscription modal right here,
 *   then land on Materio ID once authorized.
 * - Logged in + test mode: go to the accounts custom pay screen.
 * Returns a string error message on failure, or null while redirecting.
 */
export async function startLandingCheckout(planId, opts = {}) {
  const plan = LANDING_PLANS[planId];
  if (!plan) return 'Unknown plan';
  const base = (opts.accountsBase || accountsBase()).replace(/\/$/, '');
  const token = opts.token ?? readToken();

  if (!token) {
    const next = `${base}/upgrade/pay?plan=${planId}`;
    const signup = opts.signupUrl || `${base.replace('accounts.', 'auth.')}/signup?callback=${encodeURIComponent(next)}`;
    window.location.href = signup;
    return null;
  }

  let data;
  try {
    const res = await fetch(`${base}/api/v2/billing/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ plan: planId })
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Already subscribed etc — fall back to managing in Materio ID.
      if (res.status === 409) {
        window.location.href = `${base}/upgrade`;
        return null;
      }
      throw new Error(data.error || 'Checkout failed');
    }
  } catch (err) {
    // Last resort: custom pay screen handles auth + test checkout itself.
    try {
      window.location.href = `${base}/upgrade/pay?plan=${planId}`;
      return null;
    } catch {}
    return err?.message || 'Checkout failed';
  }

  // Test mode → custom pay screen.
  if (data.url) {
    window.location.href = data.url;
    return null;
  }

  // Live mode → Razorpay subscription modal, direct from landing.
  if (data.subscriptionId && data.keyId) {
    try {
      await loadRazorpayScript();
      const rzp = new window.Razorpay({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: 'Materio',
        description: `${plan.fullLabel} — ₹${plan.priceInr}/month, auto-renews`,
        theme: { color: '#EB5E28' },
        handler: () => {
          window.location.href = `${base}/upgrade?payment=success&plan=${planId}`;
        },
        modal: { ondismiss: () => {} }
      });
      rzp.open();
      return null;
    } catch (err) {
      window.location.href = `${base}/upgrade/pay?plan=${planId}`;
      return null;
    }
  }

  window.location.href = `${base}/upgrade/pay?plan=${planId}`;
  return null;
}
