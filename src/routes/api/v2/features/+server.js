import { handleFeaturesRequest, handleFeaturesOptions } from '$lib/server/features-handler.js';

export const prerender = false;

export async function GET(event) {
  return handleFeaturesRequest(event);
}

export async function POST(event) {
  return handleFeaturesRequest(event);
}

export async function PUT(event) {
  return handleFeaturesRequest(event);
}

export async function DELETE(event) {
  return handleFeaturesRequest(event);
}

export async function OPTIONS(event) {
  return handleFeaturesOptions(event);
}
