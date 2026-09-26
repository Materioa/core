---
title: Post Front-matters — Fields, Usage & Best Practices
layout: post
date: '2025-11-30 15:00:00'
category: Documentation
excerpt: "Reference for post front-matter keys used in this site: meanings, examples, common pitfalls (YAML quoting, dates), and templates authors can reuse."
summarize: true
permalink: /docs/frontmatters
hidden: true
no-ads: true
---

# Post Front-matters — Fields, Usage & Best Practices

This document explains the YAML front-matter keys used across the Materio site, gives common templates you can copy, and highlights pitfalls (for example: unquoted strings containing `:` break YAML). Use this as a quick authoring reference when creating or editing `_posts` entries.

## Why front-matter matters

Front-matter is how Jekyll (and many static-site setups) receives metadata for a page or post. It controls where a post appears, which layout to use, SEO hints (excerpt/image), visibility, and more. Invalid YAML here will break the build (see earlier YAML parsing error example).

## Common fields you will see in this repo

- `title` (string) — The post title shown in lists and the page `<title>`.
- `layout` (string) — Which layout template to use (e.g., `post`, `page`, `documentation`).
- `date` (string / datetime) — Publication date/time. Format used in this repo: `'YYYY-MM-DD HH:MM:SS'` (wrap in quotes to be safe).
- `category` (string) — A single category. Many posts use `Documentation` or other categories.
- `tags` (array) — A list of tags used for filtering/search (optional): `tags: [yaml, guides]`.
- `excerpt` (string) — Short summary used in lists and meta; if it contains `:` or other special characters, wrap it in quotes.
- `image` (string) — Path to a cover image (relative to site root).
- `summarize` (boolean) — Used in our templates to control whether the post is summarized on index pages.
 - `summarize` (boolean) — Used in our templates to control whether the post is summarized on index pages.
- `no-ads` (boolean) — When `true` the `post` layout will emit `data-no-ads="true"` and `assets/scripts/post.js` will skip injecting in-article ads for that post. Useful for sponsor posts, documentation, or internal notes where ads are inappropriate.
- `permalink` (string) — When present, overrides the generated URL.
- `hidden` (boolean) — When `true`, hides the post from lists/indexes (still published).
- `author` (string/object) — Who wrote the post (optional; check `_data/authors.yml` for site authorship conventions).
- `draft` (boolean) — If true, Jekyll may skip publishing depending on build flags (commonly used locally).

Other keys you might encounter depending on needs:
- `redirect_from` (array|string) — Build-time redirects.
- `canonical` (string) — Canonical URL for SEO.
- `robots` (string) — `noindex` / `nofollow` hints if needed.

## YAML safety tips and common pitfalls

- Always quote strings that contain `:` or begin with characters that YAML treats specially. Example:

  - Bad (unquoted excerpt containing colon):

    ```yaml
    excerpt: How the Materio promotions system works: JSON schema, ...
    ```

    This will produce a YAML parse error.

  - Good:

    ```yaml
    excerpt: "How the Materio promotions system works: JSON schema, ..."
    ```


    ## Keys Used By Templates & Client-side Scripts

    The templates (especially `_layouts/post.html`) and the client-side scripts (`assets/scripts/post.js` and `assets/scripts/post-base.js`) rely on a small set of front-matter keys and on a couple of in-content tag syntaxes. Below is a canonical reference you can copy into posts and rely on to get the expected runtime behavior.

    - `visibility` (string) — If set to `'private'` the `post` layout emits `data-visibility="private"` on the main post container (`<main class="post-container">`). Client scripts and some templates use this to hide/show private posts.

    - `category` (string) — A single category value. The `post` layout sets `data-category="{{ page.category }}"` on the main post container. Client scripts read that attribute to decide ad-injection and for client-side filtering on index pages.

    - `categories` (array) — A list of categories; used by templates for display (joined and shown in the date/category pill). Use `categories: [one, two]` when needed.

    - `previous_post` / `next_post` (string) — Optional URLs used by the template to render previous/next navigation buttons.

    - `title`, `date`, `excerpt`, `permalink`, `hidden`, `author` — Standard metadata used by templates (author resolves to entries in `_data/authors.yml`). `excerpt` should be quoted if it contains `:`.

    - `image` (string) — Cover media; the template checks whether `page.image` contains video extensions (`.mp4`, `.webm`, `.mov`) and will render a video cover when appropriate. Otherwise an `<img>` is emitted.

    - `summarize` (boolean) — When `true` the template renders the AI Summary UI block (`#ai-summary-section`). Client-side summary actions (in `post.js`) will activate within that block.

    - `toc` (boolean) — The layout checks `page.toc != false`; by default the TOC is shown. Set `toc: false` to suppress the generated in-page TOC.

  ### Author & Share Row Flags

  The `post` layout supports a small set of front-matter boolean flags authors can use to hide the author/share UI that normally appears under a post's title. These are useful for short notes, automated posts, or when you want to suppress share/print/listen affordances on a per-post basis.

  - `hide_author_share_row` (boolean) — When `true` the entire author/share row is not rendered.
  - `hide_author` (boolean) — When `true` the author column is suppressed but other controls (listen/share/print) remain if present.
  - `hide_listen` (boolean) — When `true` the "listen" audio control is not rendered.
  - `hide_share` (boolean) — When `true` the share button/menu is not rendered.
  - `hide_print` (boolean) — When `true` the print action/icon is not rendered.

  Defaults: all flags default to `false` (behaviour unchanged). Use `true` in the post front-matter to hide the corresponding UI.

  Example — hide the whole author/share row:

  ```yaml
  ---
  title: Minimal Announcement
  layout: post
  date: '2025-11-30 15:00:00'
  category: Announcement
  excerpt: "Short announcement."
  hide_author_share_row: true
  ---
  ```

  Example — hide only the share and print controls:

  ```yaml
  ---
  title: Internal Note
  layout: post
  date: '2025-11-30 15:00:00'
  category: Documentation
  excerpt: "Internal guidance."
  hide_share: true
  hide_print: true
  ---
  ```

  Client-side keys and behaviors (authors should be aware):

    - data-attributes emitted by templates:
      - `data-category` — mapped from `page.category`; read by `injectInArticleAds()` and by the home/index filtering scripts.
      - `data-visibility` — mapped when `page.visibility == 'private'`; used by several client-side filters and by home page listing code.

    - In-content tags parsed by `assets/scripts/post.js`:

      - **Attachment tag** — Embeds a downloadable file with preview:
        `[attachment:/path/to/file.pdf:Display Name]`

      - **Video tag** — Embeds a video player:
        `[video: /path/to/video.mp4]`
        
        
        Or as a cover video:
        `[video: /path/to/video.mp4:cover]`

    - Code blocks and language hints:
      - `assets/scripts/post-base.js` detects language labels using common patterns (Rouge `language-...` classes, highlight.js classes, `pre` classes) and will also read `data-language` on the `code` or `pre` elements. Authors can set the language explicitly by using fenced code blocks (```js) which generate `language-...` classes, or by adding `data-language="python"` to the `pre`/`code` when needed.

    - Ads & user-exemptions:
      - `post.js` reads the `materio_user` entry in `localStorage` (if present) and parses it to skip ad injection for Plus/Super users (`user.isPlusUser` or `user.hasAdminPrivileges`). This is not front-matter but affects runtime behavior.
      - `injectInArticleAds()` also checks the post category and has a built-in excluded list: `['Announcement', "What's New", 'Legal']`. If the post category is missing or matches one of those, ads are not injected.

    - Print / QR generation:
      - The print header and QR are created only on pages with a `.post-container` (i.e., posts using the `post` layout). No additional front-matter is required for print, but the presence of `page.visibility`/`page.category` affects whether the header is inserted (the script checks for the post container before proceeding).

- Prefer single-quoted or double-quoted timestamps in front-matter if you include a time portion: `date: '2025-11-30 15:00:00'`.
- Lists should be YAML sequences: `tags: [education, algorithms]` or:

  ```yaml
  tags:
    - education
    - algorithms
  ```

- Indentation matters — use 2 spaces consistently for nested objects.
- If you see `mapping values are not allowed` or `found character that cannot start any token`, open the front-matter and look for unescaped `:` or stray characters.

## Common templates (copy-paste)

Minimal post (public listing):

```yaml
---
title: My Post Title
layout: post
date: '2025-11-30 15:00:00'
category: Documentation
excerpt: "Short description — quote if you include ':' or special chars."
image: /assets/img/covers/example.webp
tags: [howto, docs]
permalink: /posts/my-post
---
```

Hidden / internal doc (published but not in lists):

```yaml
---
title: Internal Notes
layout: post
date: '2025-11-30 15:00:00'
category: Documentation
excerpt: "Internal guide for maintainers."
hidden: true
---
```

Redirecting old URL(s) to new permalink:

```yaml
---
title: Renamed Post
layout: post
date: '2024-05-20 12:00:00'
permalink: /docs/renamed
redirect_from:
  - /old/path/renamed-post
  - /old/alias
---
```

Advanced metadata (author, canonical, robots):

```yaml
---
title: Deep Dive: Feature X
layout: post
date: '2025-10-01 09:30:00'
category: Guides
tags: [feature-x, developer]
author: jinansh
canonical: https://materioa.netlify.app/docs/feature-x
robots: noindex
---
```

## Quick validation & testing steps

- Before committing: run a YAML linter on modified posts if you have one (many editors have plugins).
- Build locally (Jekyll) to surface YAML/front-matter errors quickly:

```powershell
# If you use Bundler and Jekyll
# bundle exec jekyll build
# or serve locally
# bundle exec jekyll serve --incremental
```

- Check the terminal output — a YAML parsing error will point to the file and line number.
- On CI, ensure build flags treat drafts/hidden consistently. If your local build shows a parse error, fix the quoting/indentation and rebuild.

## Best practices & style

- Keep front-matter minimal for short posts; move long metadata into the post body or data files (`_data`).
- Use `hidden: true` for ephemeral or maintenance posts that must be published but not shown in lists.
- Prefer `permalink` for canonical location when migrating old content.
- Use `tags` for filtering and `category` for broad grouping.
- Use `author` values that correspond to `_data/authors.yml` entries so author pages render correctly.

## Troubleshooting checklist (when a post fails to build)

1. Open the post and inspect the first block (`---` to `---`) for unquoted strings with `:`.
2. Validate indentation and list syntax (`- item` under `tags:`).
3. Ensure the file starts with `---` and ends the front-matter with `---` before the content.
4. Run a local build to get a line/column pointer to the error.
5. If you still can't find it, temporarily remove parts of the front-matter (binary search) until the build error disappears, then re-add carefully.

---

## GitHub-style Callouts / Alerts

Materio supports GitHub-flavored markdown alerts using the `[!TYPE]` syntax inside blockquotes. These are automatically styled with icons (FontAwesome or Hugeicons based on user preference) and beautiful gradient backgrounds.

### Available Callout Types

| Type | Usage | Purpose |
|------|-------|---------|
| `[!NOTE]` | General information | Useful info users should know |
| `[!TIP]` | Helpful advice | Tips for doing things better |
| `[!IMPORTANT]` | Key information | Critical info to achieve goals |
| `[!WARNING]` | Urgent attention | Issues needing immediate attention |
| `[!CAUTION]` | Risk advisory | Warns about negative outcomes |

### Syntax

> [!NOTE]
> Useful information that users should know, even when skimming content.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.


### Color Reference

**Light Mode Gradients:**

| Callout | Start Color | End Color |
|---------|-------------|-----------|
| NOTE | `#b3d9f7` | `#d6ebfc` |
| TIP | `#b8e6c1` | `#d4f0da` |
| IMPORTANT | `#dbb8eb` | `#ead4f2` |
| WARNING | `#f5d88a` | `#faebc2` |
| CAUTION | `#f5b3b3` | `#f9d4d4` |

**Dark Mode Gradients:**

| Callout | Start Color | End Color |
|---------|-------------|-----------|
| NOTE | `#1a3a5c` | `#1e2a3a` |
| TIP | `#1b3d1f` | `#1e2e1f` |
| IMPORTANT | `#3d1a47` | `#2e1e2e` |
| WARNING | `#4a3000` | `#3e2e1e` |
| CAUTION | `#4a1a1a` | `#3e1e1e` |

### Icon Support

Icons are rendered using either **FontAwesome** or **Hugeicons** depending on the `materio_ota_hugeicons` localStorage flag:

| Callout | FontAwesome | Hugeicons |
|---------|-------------|-----------|
| NOTE | `fa-solid fa-circle-info` | `hgi-stroke hgi-information-circle` |
| TIP | `fa-solid fa-lightbulb` | `hgi-stroke hgi-bulb` |
| IMPORTANT | `fa-solid fa-circle-exclamation` | `hgi-stroke hgi-alert-circle` |
| WARNING | `fa-solid fa-triangle-exclamation` | `hgi-stroke hgi-alert-02` |
| CAUTION | `fa-solid fa-hand` | `hgi-stroke hgi-stop-sign` |

### Additional Blockquote Classes

You can also use CSS classes directly on blockquotes for custom styling:

```markdown
> This is a success message.
{: .success}

> This is an info message.
{: .info}

> "This is a styled quote."
{: .quote}
```

---

## Link Cards (Promotional Info Cards)

Link Cards allow you to attach promotional info cards below specific links in your post content. These cards display an image, title, and excerpt, making internal product links more engaging and visually prominent.

### How It Works

1. Define card data in the post's front-matter using `link_cards`
2. The system automatically matches links in your content by their **link text**
3. A styled card appears below the matching link with an arrow pointing to it

### Front-matter Syntax

```yaml
---
title: Your Post Title
layout: post
link_cards:
  - id: "Materio Originals"
    image: "/assets/img/covers/example.webp"
    title: "Materio Originals"
    excerpt: "Short description of what this link leads to."
  - id: "Another Feature"
    image: "/assets/img/covers/feature.webp"
    title: "Another Feature"
    excerpt: "Description for another promotional link."
---
```

### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Yes | Text to match against link text (case-insensitive). The link with matching text will get the card. |
| `image` | string | No | Path to the card's preview image (150×128px recommended). |
| `title` | string | Yes | Title displayed on the card. |
| `excerpt` | string | No | Short description text (2 lines max). |
| `badge` | string | No | Optional badge label (e.g., "Exclusive", "New"). |

### Example Usage

**In front-matter:**

```yaml
link_cards:
  - id: "Materio Originals"
    image: "/assets/img/covers/8abb551b-2bb4-4879-800e-e936a1c44632.webp"
    title: "Materio Originals"
    excerpt: "A brand-new category of resources created, curated, and refined entirely by Materio."
```

**In your markdown content:**

```markdown
Check out [Materio Originals](https://materioa.vercel.app/originals) for exclusive study materials.
```

The card will automatically appear below the "Materio Originals" link.

### Card Features

- **Dismissable**: Users can close the card via the × button (only removes the card, link stays)
- **Clickable**: Clicking the card opens the link in a new tab
- **Dynamic arrow**: The arrow pointing to the link repositions on window resize
- **Dark mode support**: Cards automatically adapt to dark theme
- **Responsive**: Works on all screen sizes with fixed 150×128px image

### Best Practices

- Use for internal promotional links (features, products, important pages)
- Keep excerpts concise (under 100 characters)
- Use high-quality square or landscape images
- Match the `id` exactly to your link text for reliable matching
