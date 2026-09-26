import { handleFeaturesRequest, handleFeaturesOptions } from '$lib/server/features-handler.js';

export const prerender = false;

export const GET = (event) => handleFeaturesRequest(event);
export const POST = (event) => handleFeaturesRequest(event);
export const PUT = (event) => handleFeaturesRequest(event);
export const DELETE = (event) => handleFeaturesRequest(event);
export const OPTIONS = (event) => handleFeaturesOptions(event);
