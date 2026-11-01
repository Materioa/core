import { json } from '@sveltejs/kit';
import { getMongoDb } from '$lib/server/mongodb.js';
import { corsHeaders } from '$lib/server/cors-origins.js';

export const prerender = false;

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function GET({ request }) {
  try {
    const db = await getMongoDb();
    const wallpapers = await db
      .collection('wallpapers')
      .find({})
      .sort({ isDefault: -1, createdAt: 1 })
      .toArray();

    const formatted = wallpapers.map((w) => ({
      id: w._id.toString(),
      name: w.name || '',
      slug: w.slug || '',
      type: w.type || 'standard',
      isDefault: !!w.isDefault,
      desktopImage: w.desktopImage || '',
      mobileImage: w.mobileImage || w.desktopImage || '',
      slots: Array.isArray(w.slots) ? w.slots : [],
      startDate: w.startDate || null,
      endDate: w.endDate || null
    }));

    return json({ success: true, wallpapers: formatted }, { headers: corsHeaders });
  } catch (err) {
    console.error('Error fetching wallpapers in exodus:', err);
    return json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
  }
}
