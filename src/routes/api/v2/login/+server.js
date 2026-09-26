import { json } from '@sveltejs/kit';
import { getAppUrls } from '$lib/utils/app-urls.js';

export const prerender = false;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

export async function POST({ request, url }) {
  try {
    const body = await request.json().catch(() => ({}));
    const appUrls = getAppUrls(url.origin);
    const authEndpoint = `${appUrls.auth}/api/v2/login`;

    const authRes = await fetch(authEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('user-agent') ? { 'user-agent': request.headers.get('user-agent') } : {}),
        ...(request.headers.get('authorization') ? { 'authorization': request.headers.get('authorization') } : {})
      },
      body: JSON.stringify(body)
    });

    const data = await authRes.json().catch(() => ({ error: 'Invalid response from auth server' }));

    return json(data, {
      status: authRes.status,
      headers: corsHeaders
    });
  } catch (err) {
    console.error('Error forwarding /api/v2/login request:', err);
    return json({ error: err.message || 'Internal proxy error' }, {
      status: 500,
      headers: corsHeaders
    });
  }
}
