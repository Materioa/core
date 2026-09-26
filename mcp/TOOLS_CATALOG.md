# Materio MCP Server — Tool Catalog & Architecture Reference

This document provides the definitive catalog of all 29 tools registered on the Materio MCP Server (`mcp.getmaterio.app`), deployed via Cloudflare Workers (`D:\v4\materio\svelte\mcp`).

All tools adhere strictly to the simplified **`word_word`** (`snake_case`) naming convention and are protected by Materio ID OAuth Access Tiers.

---

## 1. Complete Active Toolset

### A. Course Navigation, Search & Content Grounding

| # | Tool Name | Access Tier | Primary Purpose |
|---|---|---|---|
| 1 | `resource_library` | Public | Hierarchical catalog explorer across all 8 semesters (including Semester 7), subjects, chapters, and question banks. |
| 2 | `finder` | Public | Resource location discovery powered by Materio Search API & TypeSafe AI Jev System 1 decision engine. Locates exact syllabus topics without returning giant text chunks. |
| 3 | `snap_search` | Public | Primary vectorless keyword retrieval (Postgres FTS `tsvector`) across actual textbook chunks. |
| 4 | `deep_think` | 🔒 **Plus / Admin** | Semantic vector synthesis (pgvector embeddings) for complex conceptual queries. |
| 5 | `share_link_generator` | Public | Generates verified, masked end-user links (`https://getmaterio.app/?share=...`). Hard-asserts against exposing raw CDN URLs. |
| 6 | `lookup_external_sources` | Public | Educational fallback lookup on GeeksforGeeks / Exa when syllabus context is insufficient. |

### B. Campus Community & Notifications (Public Read)

| # | Tool Name | Access Tier | Primary Purpose |
|---|---|---|---|
| 7 | `check_current_exams` | Public | Reads active exam schedules, semester dates, and seating configurations (`/api/v2/examdata`). |
| 8 | `active_promotions` | Public | Reads currently active student discounts, seasonal offers, and public banners (`/api/v2/promotions`). |
| 9 | `notifications` | Public | Reads university alerts, exam circulars, and academic notifications (`/api/v2/notifications-feed`). |

### C. InsightRoom Blog & Editorial Content

| # | Tool Name | Access Tier | Primary Purpose |
|---|---|---|---|
| 10 | `read_insightroom_posts` | Public | Lists published InsightRoom articles (`room.getmaterio.app/api/posts`). |
| 11 | `read_insightroom_post` | Public | Reads the full rendered article body for an InsightRoom post. |

### D. Personal Cloud Notebooks (User-Scoped)

*Strictly private: Each user can only read, sync, or delete their own notebooks.*

| # | Tool Name | Access Tier | Primary Purpose |
|---|---|---|---|
| 12 | `get_all_notebooks` | **Pro / Admin** | Retrieves the authenticated caller's cloud notebooks (`/api/v2/features?action=notebooks&subAction=list`). |
| 13 | `create_notebook` | **Pro / Admin** | Creates a cloud notebook or exports LLM chat sessions directly to Materio Notebooks. |
| 14 | `update_notebook` | **Pro / Admin** | Updates the title or content of an existing notebook owned by the user. |
| 15 | `delete_notebook` | **Pro / Admin** | Deletes a cloud notebook owned by the user. |

### E. Super / Admin Management (`accessTier === 'super'`)

| # | Tool Name | Access Tier | Primary Purpose |
|---|---|---|---|
| 16 | `edit_exam_data` | **Admin** | Creates or updates semester exam schedules, dates, and seating configs (`POST /api/v2/examdata`). |
| 17 | `list_all_promotions` | **Admin** | Admin view of all promotions, including disabled and expired campaigns (`/api/v2/promotions?all=true`). |
| 18 | `create_promotion` | **Admin** | Creates a new promotional campaign banner (`POST /api/v2/promotions`). |
| 19 | `update_promotion` | **Admin** | Edits promotion dates, details, or toggles active state (`PUT /api/v2/promotions`). |
| 20 | `delete_promotion` | **Admin** | Deletes a promotion from the database (`DELETE /api/v2/promotions?id=...`). |
| 21 | `create_notification` | **Admin** | Broadcasts an academic notice or alert (`POST /api/v2/notifications`). |
| 22 | `update_notification` | **Admin** | Edits an existing notification (`PUT /api/v2/notifications`). |
| 23 | `delete_notification` | **Admin** | Deletes an announcement (`DELETE /api/v2/notifications?id=...`). |

### F. Document Export

| # | Tool Name | Access Tier | Primary Purpose |
|---|---|---|---|
| 24 | `generate_document` | Public | Exports markdown content to downloadable PDF, DOCX, or MD files via Supabase storage. |

---

## 2. Purge & Migration Log

The following legacy tools have been permanently purged and consolidated:

| Purged Tool | Replacement | Reason |
|---|---|---|
| `GlobalSearch` | `finder` | Inefficient broad scans replaced by live search API with TypeSafe Jev System 1 ranking. |
| `SemesterNavigator` | `resource_library({})` | Consolidated into hierarchical catalog explorer. |
| `CourseDirectory` | `resource_library({ semester })` | Consolidated into hierarchical catalog explorer. |
| `ConceptExplorer` | `resource_library({ topic })` & `finder` | Redundant intermediate explorer eliminated. |
| `KnowledgeAtlas` | `resource_library({})` | Redundant catalog duplicate eliminated. |
| `ResourceAccess` | `share_link_generator` | Purged to prevent raw internal CDN URL exposure. |
| `ResourceLibrary` | `resource_library` | Renamed to standard `word_word` format. |
| `Finder` | `finder` | Renamed to standard `word_word` format. |
| `SnapSearch` | `snap_search` | Renamed to standard `word_word` format. |
| `DeepThink` | `deep_think` | Renamed to standard `word_word` format. |
| `ShareLinkGenerator` | `share_link_generator` | Renamed to standard `word_word` format. |
| `LookupExternalSources` | `lookup_external_sources` | Renamed to standard `word_word` format. |
| `DiagramGenerator` | `diagram_generator` | Renamed to standard `word_word` format. |
| `DiagramValidator` | `diagram_validator` | Renamed to standard `word_word` format. |
| `GenerateDiagramFromRequest` | `generate_diagram_from_request` | Renamed to standard `word_word` format. |
| `CreateWorksheetPaper` | `create_worksheet_paper` | Renamed to standard `word_word` format. |
| `CreateOrEditPaperTemplate` | `create_or_edit_paper_template` | Renamed to standard `word_word` format. |

---

## 3. Two-Tier Retrieval Architecture (Discovery vs. Grounding)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. RESOURCE DISCOVERY (Where does the topic live?)          │
│    • resource_library: Hierarchical browsing of syllabus    │
│    • finder: Natural language lookup across resource.lib    │
│      RETURNS: { semester, subject, category, topic }        │
│      (NO GIANT BOOK TEXT RETURNED)                          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CONTENT GROUNDING (What does the book actually say?)     │
│    • snap_search: Fast keyword FTS chunk retrieval          │
│    • deep_think: Semantic vector synthesis (Plus/Admin)     │
│      RETURNS: Actual textbook excerpts                      │
│      (MANDATORY BEFORE ANSWERING CONCEPT QUESTIONS)         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. SHARING (Deliver link to student)                        │
│    • share_link_generator: Generates https://getmaterio.app/│
│      ?share=<maskId> (zero internal CDN URLs exposed)       │
└─────────────────────────────────────────────────────────────┘
```
