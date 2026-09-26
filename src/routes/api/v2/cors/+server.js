import { json } from '@sveltejs/kit';
import { corsHeaders } from '$lib/server/cors-origins.js';

export const prerender = false;

export async function OPTIONS({ request }) {
  const origin = request.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin)
  });
}

export async function GET() {
  return json({ error: 'This function only handles OPTIONS requests' }, { status: 405 });
}

export async function POST() {
  return json({ error: 'This function only handles OPTIONS requests' }, { status: 405 });
}

export async function PUT() {
  return json({ error: 'This function only handles OPTIONS requests' }, { status: 405 });
}

export async function DELETE() {
  return json({ error: 'This function only handles OPTIONS requests' }, { status: 405 });
}
