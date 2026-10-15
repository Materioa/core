// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		__TAURI_INTERNALS__?: unknown;
		__TAURI__?: unknown;
		Capacitor?: unknown;
		AndroidBridge?: unknown;
		__materioForceApp?: boolean;
		__landingForceApp?: boolean;
		__materioPosts?: Promise<unknown>;
		__materioHandleAndroidBack?: () => void;
	}
}

export {};
