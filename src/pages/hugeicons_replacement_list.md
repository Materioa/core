# Materio Hugeicons SVG Migration Inventory

This document provides a comprehensive inventory of all icons used throughout the Materio codebase (HTML templates, JavaScript components, post processing scripts, and styles) to prepare for replacing all icon fonts with inline/external Hugeicons SVGs.

---

## 1. Navigation & Header Icons
| Icon Name | FontAwesome Class | Context / Location | Suggested Hugeicon SVG |
| :--- | :--- | :--- | :--- |
| **Home** | `fa-house-chimney` / `fa-home` | Navigation menu, home tab | `home-09` |
| **Chat / Discussions** | `fa-comments` / `fa-comment` | Community & discussion tabs | `chat` |
| **Notifications** | `fa-bell` | Header notifications icon | `notification-01` |
| **AI / Assistant** | `fa-robot` | Finder / AI Mode toggle | `robot` |
| **Reading / Mode** | `fa-lightbulb-on` / `fa-book-open` | Read mode toggle, notebook header | `book-open-02` |
| **Settings** | `fa-cog` / `fa-gear` | Settings tab icon | `settings-01` |
| **Search** | `fa-search` / `fa-magnifying-glass` | Search modal, quick search | `search-01` |
| **Keyboard** | `fa-keyboard` / `far fa-keyboard` | Keyboard shortcuts button & modal | `keyboard` |

---

## 2. Actions & Controls Icons
| Icon Name | FontAwesome Class | Context / Location | Suggested Hugeicon SVG |
| :--- | :--- | :--- | :--- |
| **Plus / Add** | `fa-circle-plus` / `fa-plus` | Dynamic forms, notebook add | `plus-sign-circle` |
| **Refresh** | `fa-refresh` / `fa-rotate` | Reload & refresh actions | `refresh` |
| **Download** | `fa-download` / `fa-folder-arrow-down` | PDF downloads & material saved | `download-01` |
| **Trash / Delete** | `fa-trash` / `fa-trash-can` | Delete note / clear cache | `delete-02` |
| **Play** | `fa-play` | Audio / promo video player | `play` |
| **Pause** | `fa-pause` | Audio / promo video player | `pause` |
| **Arrows Navigation** | `fa-arrow-up`, `fa-arrow-left`, `fa-arrow-right`, `fa-arrow-down` | Button navigation, wizard | `arrow-up-01`, `arrow-left-01`, `arrow-right-01`, `arrow-down-01` |
| **Chevrons** | `fa-chevron-right`, `fa-chevron-left`, `fa-chevron-down`, `fa-chevron-up` | Submenu expanders & wizard steps | `arrow-right-01`, `arrow-left-01`, `arrow-down-01`, `arrow-up-01` |
| **Close** | `fa-times` / `fa-xmark` | Modal close buttons | `cancel-01` |
| **Check / Success** | `fa-check` / `fa-circle-check` | Success alerts, completed items | `tick-01` / `checkmark-badge-01` |
| **Bookmark** | `fa-bookmark-plus` / `fa-book-bookmark` | Save material / bookmark | `bookmark-02` |
| **Expand / Compress** | `fa-expand` / `fa-compress` | Fullscreen toggle | `square-arrow-diagonal-01` |

---

## 3. Rich Text & Notebook Editor Icons
| Icon Name | FontAwesome Class | Context / Location | Suggested Hugeicon SVG |
| :--- | :--- | :--- | :--- |
| **Bold** | `fa-bold` | Rich text formatting toolbar | `text-bold` |
| **Italic** | `fa-italic` | Rich text formatting toolbar | `text-italic` |
| **Underline** | `fa-underline` | Rich text formatting toolbar | `text-underline` |
| **Strikethrough** | `fa-strikethrough` | Rich text formatting toolbar | `text-strikethrough` |
| **Bullet List** | `fa-list-ul` | Notebook formatting | `list-view` |
| **Ordered List** | `fa-list-ol` | Notebook formatting | `note-01` |
| **Check List** | `fa-square-check` | Notebook task list | `task-01` |
| **Link** | `fa-link` | Insert URL / link to PDF | `link-01` |
| **Image** | `fa-image` | Insert image | `image-01` |
| **Code** | `fa-code` | Code blocks | `code-01` |
| **Math / Formulas** | `fa-square-root-variable` | Math equations | `math` |
| **Quote** | `fa-quote-left` | Blockquotes | `quote-up` |
| **PDF File** | `fa-file-pdf` | Downloadable PDF attachment | `pdf-01` |
| **Attachment** | `fa-paperclip` | File attachment | `attachment-01` |
| **AI Sparkles** | `fa-wand-magic-sparkles` / `fa-sparkles` | AI summaries / Magic tools | `magic-wand-01` |
| **Save / Disk** | `fa-floppy-disk` | Save note | `disk` |

---

## 4. Status, Badges & Callout Icons
| Icon Name | FontAwesome Class | Context / Location | Suggested Hugeicon SVG |
| :--- | :--- | :--- | :--- |
| **Info** | `fa-circle-info` | Tooltips, alert callouts | `information-circle` |
| **Warning** | `fa-exclamation-triangle` | Caution callouts, bug reports | `alert-02` |
| **Error / Alert** | `fa-circle-exclamation` | Error messages | `alert-circle` |
| **Checkmark Badge** | `fa-badge-check` | Plus/Super verified user badge | `checkmark-badge-01` |
| **Star** | `fa-star` | Leaderboard top rank / rating | `star` |
| **GitHub** | `fa-github` | Developer link | `github` |

---

## Next Steps for SVG Replacement
1. **SVG Sprite / Asset Pool**: Create an inline SVG sprite file or icon map module in `assets/img/hugeicons/` containing clean `<svg>` strings for the 45 icons listed above.
2. **Helper Renderer**: Use an SVG renderer helper `renderHugeicon(name, options)` to replace font classes with inline `<svg class="hugeicon hugeicon-{name}">`.
