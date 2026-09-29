# Materio Core

Materio is an all-in-one study app: library resources, PDF reader, notebooks,
flashcards, community rooms, AI search and interview prep — on web, Android
and desktop from a single SvelteKit codebase.

- Web app: `https://getmaterio.app`
- Repository: `https://github.com/Materioa/core`

## Stack

- SvelteKit 2 + Svelte 5 + Vite 8 + Tailwind CSS 4
- Capacitor 8 for the Android shell (`android/`)
- Tauri 2 for the desktop shell (`src-tauri/`)
- Cloudflare Workers via `@sveltejs/adapter-cloudflare` (`wrangler.jsonc`)
- MongoDB, Supabase Auth, OpenRouter / HuggingFace for AI features

## Getting started

Requirements: Node 20+, npm. Optional: Bun, Rust + Tauri CLI (desktop),
Android SDK (mobile).

```bash
npm install
npm run dev        # web dev server (Vite)
```

Copy `.env.example` to `.env` and fill in API keys and service URLs. Never
commit `.env` — secrets are synced to Cloudflare with `npm run env:push`,
which reads from the local `.env` via `scripts/push-env.mjs`.

## Scripts

| Command              | What it does                                     |
| -------------------- | ------------------------------------------------ |
| `npm run dev`        | Start the Vite dev server                        |
| `npm run build`      | Production web build (runs `scripts/prebuild.mjs` first) |
| `npm run preview`    | Preview the production build locally             |
| `npm run deploy`     | Build, deploy to Cloudflare Workers, push env    |
| `npm run env:push`   | Sync `.env` values to Worker secrets             |
| `npm run build:static` | Static build for Tauri / Capacitor (`BUILD_TARGET=static`) |
| `npm run tauri:dev` / `npm run tauri:build` | Desktop app develop / bundle |
| `npm run cap:sync`   | Sync the web build into the Android project      |
| `npm run icons:generate` | Regenerate app icons                        |

## Project layout

- `src/routes/` — pages and API routes (`src/routes/api/...`)
- `src/lib/components/` — UI components (modals, tabs, splash, search)
- `src/lib/server/` — server-only code (DB, handlers, mailer)
- `src/lib/utils/` — shared client utilities
- `static/` — bundled assets (fonts, images, fallback data files)
- `scripts/` — prebuild, env sync, icon generation
- `android/` — Capacitor Android project (`com.materio.app`)
- `src-tauri/` — Tauri desktop project (`com.materio.app`)
- `mcp/` — bundled MCP server binary resources
- `docs/` — additional documentation

## API

Versioned JSON APIs live under `src/routes/api/v2/` (search, forms,
promotions, releases, interviewer, billing, health, …). Native apps talk to
the production backend at `https://getmaterio.app`; on web, same-origin
relative paths are used.

## Native releases and OTA updates

- Android (`com.materio.app`): in-app self-update via DownloadManager +
  package installer; update metadata from `/api/releases/latest`, which
  tracks the latest GitHub release.
- Desktop (Tauri): built-in updater with restart; `materio://` protocol links
  focus the running window (single-instance).
- Publishing a GitHub release with fresh `Materio-Android.apk` /
  `Materio-Windows-Setup.exe` assets is what triggers update prompts on
  installed apps.

## Contributing

Keep changes scoped, match existing code style, and verify with a production
`npm run build` before pushing. Do not commit secrets, keystores, service
account files, or build artifacts.
