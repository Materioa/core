import { handleHealthGet, handleHealthPost, handleHealthOptions } from '$lib/server/health-handler.js';

export const prerender = false;

export async function GET(event) {
  return handleHealthGet(event);
}

export async function POST(event) {
  return handleHealthPost(event);
}

export async function OPTIONS(event) {
  return handleHealthOptions(event);
}
