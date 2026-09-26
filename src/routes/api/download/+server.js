import { GET as getWindows } from './windows/+server.js';
import { GET as getAndroid } from './android/+server.js';
import { json } from '@sveltejs/kit';

export async function GET(event) {
	const platform = event.url.searchParams.get('platform') || event.url.searchParams.get('os');
	if (platform === 'android' || platform === 'apk') {
		return getAndroid(event);
	}
	if (platform === 'windows' || platform === 'win' || platform === 'msi' || platform === 'exe') {
		return getWindows(event);
	}
	return json({
		windows: '/api/download/windows',
		android: '/api/download/android'
	});
}
