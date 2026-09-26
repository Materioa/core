---
title: Promotions System — Configuration & Capabilities
layout: post
date: '2025-11-30 12:00:00'
category: Documentation
excerpt: "How the Materio promotions system works: JSON schema, animation options, button/config tags, frequency controls, and tips to test and author promos."
summarize: true
permalink: /docs/promotions
hidden: true
---

# Promotions System — Configuration & Capabilities

This note describes the promotions (promo modal) system used across Materio: the JSON fields available in `assets/data/promo.json`, the supported animation and button options, frequency controls, and quick testing tips. It's written in the same practical style as the API docs so you can author promos confidently.

## Table of contents

1. [Overview](#overview)
2. [JSON Schema (key fields)](#json-schema-key-fields)
3. [Image / Media Animation Options](#image--media-animation-options)
4. [Buttons, Disclaimer & Options](#buttons-disclaimer--options)
5. [Frequency & Scheduling](#frequency--scheduling)
6. [How JS maps to CSS classes](#how-js-maps-to-css-classes)
7. [Authoring examples](#authoring-examples)
8. [Testing & debugging tips](#testing--debugging-tips)
9. [FAQ / Notes](#faq--notes)

---

## Overview

Promotions are configured through `assets/data/promo.json` (and deployed copies under `_site/`). The frontend JS (`assets/scripts/promotions.js`) reads that file, decides whether to show the modal (based on `enabled`, frequency, date range, and localStorage), and renders the modal UI. Images and videos can rotate, and simple animations are supported through classes like `slide-left`, `fade`, and `fade-scale`.

The system supports:
- One-off or recurring promos via `frequency` and `customFrequencyHours`.
- Limited-time offers with `startDate` / `endDate` and optional date display.
- Multiple images/videos with rotation and per-rotation animation config.
- Primary and secondary buttons with flexible link handling (internal anchors vs external links).
- A "Don't show again" option that persists in `localStorage`.

## JSON Schema (key fields)

Here are the most commonly used fields and what they do:

### Core Fields

- `enabled` (boolean): turn the promotion on/off.
- `category` (string): free-form tag to categorize promotions (e.g., "whats-new").
- `frequency` (string): how often to show — see Frequency section below.
- `customFrequencyHours` (number or "null"): used when `frequency` is `custom`.
- `title` (string): promo title displayed in modal.
- `description` (string): markdown-like text parsed by the script.
- `link` (string): primary action URL (can be `""`, `null`, or `#anchor`).

### Media Fields

- `media` (array): list of media URLs (images or videos). Supports both images and video files. If a video extension is detected (`.mp4`, `.webm`, `.ogg`, etc.), the script treats it as video.

> [!WARNING] *`images` is deprecated, while `images` is still supported for backward compatibility but `media` is preferred.*

- `mediaFit` (string): controls how media fits within the frame. See table below.
- `imageRotationInterval` (number): milliseconds between rotations.
- `imageAnimation` (object): describes per-rotation animation (see below).

#### `mediaFit` Options

| Value | Description |
|-------|-------------|
| `contain` | Scales media to fit within the frame **without cropping** (shows entire video/image) |
| `cover` | Scales media to fill the frame, **may crop edges** (default for backward compatibility) |
| `fill` | Stretches media to fill the frame (may distort aspect ratio) |
| `scale-down` | Like `contain`, but never scales up beyond original size |
| `none` | Original size (no scaling) |

**Tip**: Use `"mediaFit": "contain"` for videos to ensure the entire video is visible without cropping.

### Device Targeting

- `showOn` (string or array): controls which device types see the promotion.

#### `showOn` Options

| Value | Shows on |
|-------|----------|
| `"all"` | All devices (default if not specified) |
| `"desktop"` | Windows, Mac, Linux, ChromeOS only |
| `"mobile"` | Phones only (iPhone, Android phones) |
| `"tablet"` | Tablets only (iPad, Android tablets) |
| `["desktop", "mobile"]` | Multiple devices (array format) |

**Example**: To show a promo only on desktop:
```json
"showOn": "desktop"
```

To show on both desktop and tablet:
```json
"showOn": ["desktop", "tablet"]
```

### Scheduling Fields

- `isLimitedOffer`, `startDate`, `endDate`: control showing within a date range.
- `showDateInfo` (boolean): show human-friendly date in modal.

### UI Fields

- `buttons` (object): `primary` and `secondary` button configuration.
- `disclaimer` (object): controls small text below actions.
- `options` (object): e.g., `showDontShowAgain` and related text.

## Image / Media Animation Options

You can control how rotated images enter via `imageAnimation`. The JavaScript accepts two styles:

1. Shorthand: `{ "type": "slide", "direction": "left", "duration": 600 }`
2. Explicit type: `{ "type": "slide-left", "duration": 600 }`

Supported `type` values (script and CSS provide matching handlers):
- `slide-left`, `slide-right`, `slide-up`, `slide-down` — slide in from direction
- `slide` + `direction: left|right|up|down` — shorthand equivalent
- `fade` — simple opacity fade
- `fade-scale` — fade + subtle scale
- `cascade`, `flip`, `zoom`, `bounce` — additional options (tuned in CSS/JS)

`duration` is in milliseconds. The script sets a CSS custom property `--animation-duration` to the configured duration; CSS falls back to a default if not supplied.

Important: The JS applies the animation class to the incoming (active) media element. The outgoing element is hidden to avoid visual overlap. If you want a cross-slide (both in/out animate), we can add paired exit classes.

## Buttons, Disclaimer & Options

- `buttons.primary` and `buttons.secondary` — objects with `show` (boolean), `text`, and `icon` (font-awesome class or blank char). Primary button uses `link` from top-level if present.
- Anchor behaviour: if `link` starts with `#`, the script closes the modal and scrolls to the anchor instead of opening a new tab.
- Secondary button is often used as a dismiss / "Got it" / "Remind me later" control.
- `disclaimer` contains `show`, `text`, `linkText`, `linkUrl`.
- `options.showDontShowAgain` controls rendering of the checkbox and persists to `localStorage` when the user closes the promo.

## Frequency & Scheduling

`frequency` controls when a user sees a promo. Supported values implemented in `promotions.js`:

- `once` — show only once per browser (localStorage record)
- `everytime` — show every page load
- `custom` — use `customFrequencyHours` to define hours between shows
- `every-3hr`, `every-6hr`, `every-12hr`, `daily`, `every-3days` — fixed presets
- `random` — special behaviour: uses `promoRemindLaterTime` and a probabilistic window (script-specific)

The script stores `promoLastShown` and (for reminders) `promoRemindLaterTime` in `localStorage`.

### Limited-time offers

Set `isLimitedOffer: true` and include `startDate` / `endDate` (ISO-like string). The script will only show the promo while `now` falls inside that range.

## How JS maps to CSS classes

- `promotions.js` computes an `animationClass` (e.g. `slide-left`) and adds it to the active element (`<img>` or `<video>`).
- CSS should provide animations for those classes. In the repo we add `.slide-left`, `.slide-right`, `.fade`, `.fade-scale`, etc., and corresponding `@keyframes` in `assets/style/main.css`.

If you author a promo with `imageAnimation.type = "slide-left"` the script will respect that value directly. It also supports `{ type: 'slide', direction: 'left' }` for backwards compatibility.

## Authoring examples

Minimal promo (single image, simple fade):

```json
{
  "enabled": true,
  "title": "New: Materio Originals",
  "description": "Check out curated resources created by Materio.",
  "media": ["assets/img/covers/e6d2c600-a047-4a60-baa5-06adea6a054d.webp"],
  "mediaFit": "cover",
  "imageRotationInterval": 5000,
  "imageAnimation": { "type": "fade", "duration": 600 },
  "frequency": "everytime",
  "buttons": { "primary": { "show": true }, "secondary": { "show": true, "text": "Got it" } }
}
```

Slide-left rotation with video (using `contain` to prevent cropping):

```json
{
  "media": [
    "assets/media/promo-video.webm",
    "assets/img/covers/b.webp"
  ],
  "mediaFit": "contain",
  "imageRotationInterval": 3000,
  "imageAnimation": { "type": "slide-left", "duration": 450 }
}
```

Shorthand slide with direction:

```json
{
  "imageAnimation": { "type": "slide", "direction": "left", "duration": 450 }
}
```

Button example with internal anchor:

```json
{
  "link": "#quickSearchBox",
  "buttons": { "primary": { "show": true, "text": "Go to search" } }
}
```

If `link` is `""` or `null`, the primary button will simply close the modal (script handles this case).

## Testing & debugging tips

- Hard-refresh the page to pick up CSS/JS changes (or rebuild `_site` if you're testing the generated build).
- Use the browser console to trigger the modal without waiting for frequency checks:

```js
// Show modal immediately
testPromoModal()

// Force reload promotion data (fetches promo.json with cache-bust)
forceLoadPromo()

// Manually setup rotation with a short interval for testing
window.setupImageRotation && window.setupImageRotation(
  (promoData && promoData.media) || [],
  2000,
  { type: 'slide-left', duration: 450 }
)
```

- Inspect the active media element in devtools to confirm the animation class is added (e.g., `slide-left`).
- If it looks like a fade but you expected a slide:
  - Ensure CSS defines `.slide-left` and related `@keyframes` (we added them to `assets/style/main.css`).
  - Confirm the browser loaded the updated CSS file (network tab or hard refresh).
  - Check for inline styles overriding `transform` or `transition`.

## FAQ / Notes

- Q: Can I animate both outgoing and incoming images?
  - A: Not by default — the script animates the incoming media and hides the outgoing. We can add paired enter/exit classes for smoother cross-transitions.

- Q: Where are promo assets served from?
  - A: Usually under `/assets/img/covers/...` and referenced relative to the site root. When testing locally, ensure paths resolve to the dev server root.

- Q: How does the "Don't show again" checkbox work?
  - A: When enabled via `options.showDontShowAgain`, the close handler stores `promoDoNotShowAgain = 'true'` in `localStorage` and subsequent checks skip the promo.
