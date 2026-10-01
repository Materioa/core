import {
	handleDictionaryGet,
	handleDictionaryPost,
	handleDictionaryOptions
} from '$lib/server/dictionary-handler.js';

export const prerender = false;

export async function GET(event) {
	return handleDictionaryGet(event);
}

export async function POST(event) {
	return handleDictionaryPost(event);
}

export async function OPTIONS(event) {
	return handleDictionaryOptions(event);
}