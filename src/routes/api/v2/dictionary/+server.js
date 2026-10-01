import {
	handleDictionaryGet,
	handleDictionaryOptions
} from '$lib/server/dictionary-handler.js';

export const prerender = false;

export async function GET(event) {
	return handleDictionaryGet(event);
}

export async function OPTIONS(event) {
	return handleDictionaryOptions(event);
}