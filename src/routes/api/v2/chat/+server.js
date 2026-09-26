import { handleChatGet, handleChatPost, handleChatOptions } from '$lib/server/chat-handler.js';

export const prerender = false;

export async function GET(event) {
  return handleChatGet(event);
}

export async function POST(event) {
  return handleChatPost(event);
}

export async function OPTIONS(event) {
  return handleChatOptions(event);
}
