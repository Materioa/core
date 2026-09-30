# How Eight Unrelated Bugs Hid Behind One Symptom

*A forensic account of eliminating recurring 500s from a Cloudflare Workers app on a 10ms CPU budget*

> **Scope note.** This is a real investigation, reconstructed from working notes. Every number, log excerpt, and code sample is from the actual session. Where I was wrong, the wrongness is included deliberately — several of these diagnoses were confident, well-reasoned, and incorrect, and the record of *how* they failed is more instructive than the fixes.

---

## Table of contents

- [The system under investigation](#the-system-under-investigation)
- [The symptom, and why it was so unhelpfully vague](#the-symptom-and-why-it-was-so-unhelpfully-vague)
- [Part I — Method](#part-i--method)
  - [How I probed, and why it initially failed](#how-i-probed-and-why-it-initially-failed)
  - [The telemetry triangle](#the-telemetry-triangle)
  - [The single most useful field: `scriptVersion`](#the-single-most-useful-field-scriptversion)
  - [The four theories I got wrong](#the-four-theories-i-got-wrong)
  - [Theory 1 — "Poisoned Mongo connection pool"](#theory-1--poisoned-mongo-connection-pool)
  - [Theory 2 — "Atlas is far from the edge"](#theory-2--atlas-is-far-from-the-edge)
  - [Theory 3 — Cursor `.sort()` wedges the driver](#theory-3--cursor-sort-wedges-the-driver)
  - [Theory 4 — "Memory exhaustion"](#theory-4--memory-exhaustion)
- [Part II — The eight bugs](#part-ii--the-eight-bugs)
  - [Bug 1 — Unbounded `await`, and the runtime that kills idle events](#bug-1--unbounded-await-and-the-runtime-that-kills-idle-events)
  - [The signature](#the-signature)
  - [The mechanism](#the-mechanism)
  - [The fix](#the-fix)
  - [What was actually unbounded](#what-was-actually-unbounded)
  - [Verification](#verification)
  - [Bug 2 — Promises do not belong to a request](#bug-2--promises-do-not-belong-to-a-request)
  - [The signature](#the-signature)
  - [The mechanism](#the-mechanism)
  - [The fix](#the-fix)
  - [Why this one matters beyond the fix](#why-this-one-matters-beyond-the-fix)
  - [Bug 3 — `distinct()` and other unbounded work in the Worker](#bug-3--distinct-and-other-unbounded-work-in-the-worker)
  - [The signature](#the-signature)
  - [The cause](#the-cause)
  - [The fix](#the-fix)
  - [Verification](#verification)
  - [The generalisable lesson](#the-generalisable-lesson)
  - [Bug 4 — Missing query pushdown](#bug-4--missing-query-pushdown)
  - [The signature](#the-signature)
  - [Two compounding problems](#two-compounding-problems)
  - [The fix](#the-fix)
  - [Verification](#verification)
  - [Bug 5 — Error 1102: CPU, not memory](#bug-5--error-1102-cpu-not-memory)
  - [The misreading](#the-misreading)
  - [Why the streaming work stayed anyway](#why-the-streaming-work-stayed-anyway)
  - [The ordering that resolved it](#the-ordering-that-resolved-it)
  - [Bug 6 — Aggregation belongs in the database](#bug-6--aggregation-belongs-in-the-database)
  - [The migration](#the-migration)
  - [The process lesson: verify the schema, never infer it](#the-process-lesson-verify-the-schema-never-infer-it)
  - [Deployment ordering](#deployment-ordering)
  - [Verification](#verification)
  - [A known, deliberately unfixed edge case](#a-known-deliberately-unfixed-edge-case)
  - [Bug 7 — Cache stampedes and the connection budget](#bug-7--cache-stampedes-and-the-connection-budget)
  - [The mechanism](#the-mechanism)
  - [Two fixes](#two-fixes)
  - [A subtlety worth stating](#a-subtlety-worth-stating)
  - [Verification](#verification)
  - [Bug 8 — A cache layer that was both redundant and fatal](#bug-8--a-cache-layer-that-was-both-redundant-and-fatal)
  - [The signature](#the-signature)
  - [The evidence that had been available all along](#the-evidence-that-had-been-available-all-along)
  - [The fix](#the-fix)
  - [Verification](#verification)
  - [The lesson](#the-lesson)
- [Part III — Two bugs I created myself](#part-iii--two-bugs-i-created-myself)
  - [The poisoned in-flight entry](#the-poisoned-in-flight-entry)
  - [The connection-pool regression](#the-connection-pool-regression)
- [Part IV — Application-level defects](#part-iv--application-level-defects)
  - [Telemetry must not hard-fail on auth](#telemetry-must-not-hard-fail-on-auth)
  - [The fix, and the security detail that matters](#the-fix-and-the-security-detail-that-matters)
  - [A desktop updater gated on the wrong platform](#a-desktop-updater-gated-on-the-wrong-platform)
- [Part V — Operations](#part-v--operations)
  - [The CI path filter that silently skipped releases](#the-ci-path-filter-that-silently-skipped-releases)
  - [.github/workflows/build-and-release.yml](#githubworkflowsbuild-and-releaseyml)
  - [Explicit dispatch, bypassing the filter](#explicit-dispatch-bypassing-the-filter)
  - [Tag push — the path filter only applies to branch pushes, and the version](#tag-push--the-path-filter-only-applies-to-branch-pushes-and-the-version)
  - [is read straight from the tag. Both platforms build, exact version control.](#is-read-straight-from-the-tag-both-platforms-build-exact-version-control)
  - [There is no OTA](#there-is-no-ota)
  - [The Play Store fee, and what `installId` actually costs](#the-play-store-fee-and-what-installid-actually-costs)
- [Part VI — Synthesis](#part-vi--synthesis)
  - [The meta-lesson](#the-meta-lesson)
  - [Checklist for serverless reliability](#checklist-for-serverless-reliability)
  - [Results](#results)
  - [What remained unfixed](#what-remained-unfixed)
- [Appendix A — Reproducing the core finding](#appendix-a--reproducing-the-core-finding)
- [Appendix B — Glossary](#appendix-b--glossary)

## TL;DR

A SvelteKit application on Cloudflare Workers was throwing recurring `500`s. Over one working session, the failure resolved into **eight independent bugs**, all presenting as the same undifferentiated "server error." Two of them were self-inflicted during the debugging process.

Ranked by how much they cost to find:

1. **Unbounded `await`** — the runtime kills any event with zero pending work. This behind most of the 500s, and it produces no stack trace because nothing ever throws.
2. **Reading `cpuTimeMs` next to `wallTimeMs`** — 3ms CPU at 3.1 seconds of wall time is a *timer elapsing*, not a hot loop. One twenty-second log read broke a deadlock I'd been in for hours.
3. **`scriptVersion`** — when a hunt spans many deploys, your pasted logs are a mix of builds. I investigated failures that were already fixed.

If you take one operational rule: **on a serverless runtime with a request-scoped event loop, the most dangerous statement in your codebase is an unbounded `await`.**

If you take one process rule: **cheap discriminators beat expensive confirmations.** Most of my wasted time went into gathering evidence that was *compatible* with a hypothesis, when what I needed was evidence that *discriminated* between hypotheses.

---

## The system under investigation

| Component | Detail |
|---|---|
| Runtime | Cloudflare Workers, free tier |
| Framework | SvelteKit → `adapter-cloudflare` |
| Primary DB | MongoDB Atlas, AWS Mumbai (`ap-south-1`), 3 shards |
| Analytics store | Supabase (Postgres + PostgREST) |
| Hard CPU budget | **10 ms per invocation** |
| Hard memory budget | 128 MB |
| Outbound connection ceiling | **6 simultaneous** |
| Edge location observed | `BOM` (Mumbai) — client in Ahmedabad, India |
| Deployment | GitHub Actions → `wrangler deploy`, ~4m42s per build |

Those three limits — **10ms CPU, 128MB, 6 connections** — are the whole story. Almost every bug in this document is a violation of one of them, discovered late.

---

## The symptom, and why it was so unhelpfully vague

The report was: *"the site sometimes 500s."*

That is a genuinely difficult input, because under it lies an enormous hypothesis space. I had confirmed the failures were real — a 30-round sustained loop caught crashes the user could reproduce, and production logs showed thousands of `outcome: "exception"` events per day — but "real" and "understood" are very different states.

Everything that follows is an account of narrowing that space, including the parts where I narrowed it in the wrong direction and had to back out.

---

## Part I — Method

### How I probed, and why it initially failed

My first probes were sequential, single-request, warm-isolate tests. They were clean, repeatedly. This was actively misleading, and understanding *why* is the first real lesson.

A single sequential request to a warm isolate exercises almost none of the failure surface:

- **Warm isolate** → the Mongo connection is already established, so connection problems are invisible.
- **Sequential** → no concurrency, so stampedes and cross-request interference cannot occur.
- **Low volume** → CPU limits are per-invocation; one cheap request never approaches 10ms.
- **Fresh parameters** → I was defeating caches rather than exercising them, which hid the very bugs caching was masking.

The failure modes only appeared under **concurrent bursts onto cold isolates** — which is exactly what a real page load does. My probes were measuring the wrong thing with great precision.

The probe that finally worked:

```js
// Concurrent fan-out, and deliberately aimed at endpoints that are NOT
// behind the cache, so worker code + database work actually runs.
const buildBatch = (n) => Array.from({ length: n }, (_, i) => {
  const r = crypto.randomBytes(4).toString('hex');
  const paths = [
    `/api/v2/health?t=${r}`,                                    // not cached
    `/api/v2/features?action=analytics-views&pdfName=burst%20${r}`, // unique key
    `/api/v2/search?q=burst${r}&useAI=false`,                   // unique key
    `/api/v2/notifications?t=${r}`,
    `/api/v2/features?action=analytics-leaderboard&limit=20&anonId=burst${r}`,
    `/api/v2/forms/popups?userId=${r}-422a-b6ec-a5985da3d877`,
    `/api/v2/releases`,
    `/api/v2/examdata`
  ];
  return paths[i % paths.length];
});
```

Two design details worth stealing:

- **Cache-busting parameters were stripped from the cache key** by design (`BUSTER_PARAMS`), so `?t=` genuinely forced a cold path rather than accidentally serving a cached copy.
- **Failures were classified, not just counted** — distinguishing `cpu/memory-limit`, `promise-never-completes`, `worker-exception`, and `http-429`. This mattered: without it, a rate limiter correctly rejecting my hammering looked identical to a server fault.

Baseline on the first working probe, 6 rounds × 10 concurrent:

```
round 1: 9/10 ok  — worker-exception 4434ms /api/v2/health
round 3: 9/10 ok  — worker-exception 3321ms /api/v2/health
round 5: 9/10 ok  — worker-exception 3223ms /api/v2/health
TOTAL: 57 ok, 3 failed of 60
```

A reproducible, deterministic failure. That changed everything that followed.

---

### The telemetry triangle

Every Cloudflare Workers error event carries fields that, **read together**, classify the failure before you read any application code.

Two failures from the same session, both surfaced to the user as "500":

```
releases      outcome=exception    wallTimeMs=3125   cpuTimeMs=3
forms/popups  outcome=exceededCpu  wallTimeMs=322    cpuTimeMs=64
```

These demand completely different investigations:

| Observation | Deduction | Where to look |
|---|---|---|
| `cpuTimeMs` ≈ 3, `wallTimeMs` ≈ 3000+ | CPU never ran; a **timer elapsed** | Timeouts, wedged I/O, hanging awaits |
| `cpuTimeMs` = 64 vs a 10ms budget | Genuinely **expensive operation** | The code doing work |
| `outcome=exceededCpu` | Budget exceeded | Same as above |
| `outcome=exception`, low wall | Synchronous throw | The stack — if you have one |

The `releases` case is the one that unlocked the session. Three milliseconds of CPU across three seconds of wall time cannot be a slow code path. It is a **timer**, and the only 3000ms timer in that request path was in my own cache wrapper.

For contrast, here's what a genuine CPU failure looks like — note the completely different signature:

```
forms/popups  outcome=exceededCpu  wallTimeMs=322  cpuTimeMs=64
```

322ms wall, 64ms CPU. The CPU *ran*, and ran too long. No timeout involved.

---

### The single most useful field: `scriptVersion`

When pasted logs arrive from an investigation that has spanned many deploys, **they are a mixture of old and new builds.** This is easy to forget and it wasted real time.

```json
"scriptVersion": { "id": "e1b0cd32-da10-4bd3-93f9-c3dcc5f5d676" }  ← OLD
"scriptVersion": { "id": "2f05c500-ad8d-4eab-acd3-bd0d371dc6fd" }  ← CURRENT
```

In this session, four distinct script versions appeared across the pasted logs:

| Script version | Failures it produced | Status at time of report |
|---|---|---|
| `e1b0cd32` | `releases` @3125ms | **stale** — already fixed |
| `932ee9bf` | `notebooks` @11ms, `leaderboard` @68ms | stale |
| `1ccd14a0` | `notifications` @4565ms | stale |
| `2f05c500` | `notebooks` @4014ms, `leaderboard` @132ms | **current — genuinely open** |

I spent time investigating `releases` failures that had been fixed hours earlier. The moment I started sorting by `scriptVersion` first, the real backlog became obvious: **only two endpoints were actually still broken.**

**Rule: sort by `scriptVersion` before believing anything in a log.**

---

### The four theories I got wrong

These are included because a success story teaches nothing about how to avoid the failure mode.

### Theory 1 — "Poisoned Mongo connection pool"

**Hypothesis:** concurrent requests leak pool checkouts; a wedged checkout blocks everything on that isolate.

**Why it seemed plausible:** the original crash signature was suspiciously consistent, and Mongo does have wait-queue semantics that can hang.

**Why it was wrong:** the Atlas IP allowlist was open, the connection string was correct, and *warm* requests worked flawlessly. A poisoned pool cannot coexist with a healthy one on the same isolate. The premise didn't survive one round of checking.

**What survived:** the *mitigation* built while chasing it — bounded waits on every connection path — was genuinely necessary and remained in the final code. The diagnosis was wrong; the defensive work wasn't.

### Theory 2 — "Atlas is far from the edge"

**Hypothesis:** cold TLS handshakes cross an ocean, exceeding connect timeouts.

**Why it seemed plausible:** the logs showed ~2.4s cold connects, and "Mongo on Workers is slow" is a common complaint.

**Why it was wrong:** the user confirmed Atlas runs in **Mumbai (`ap-south-1`)**, and requests arrive at Cloudflare's **BOM** edge — roughly 30ms RTT. I retracted this immediately. There was no ocean.

**Lesson:** a plausible-sounding infrastructure story is still a story. One question would have killed it.

### Theory 3 — Cursor `.sort()` wedges the driver

**Hypothesis:** every query that hung used cursor `.sort()`; every query that worked did not. Ship the fix: sort in JS.

This one deserves public condemnation because of how I handled it. The elimination was real:

| Query | `.sort()`? | Result |
|---|---|---|
| `releases` `find({}).toArray()` | no | worked |
| `examdata` `findOne({})` | no | worked |
| `promotions` `find({}).sort(…).toArray()` | **yes** | **timed out** |
| `notifications` `find({}).sort(…).toArray()` | **yes** | **timed out** |

I labelled it explicitly as *"a hypothesis, not a finding"* and noted I couldn't confirm the mechanism from outside the runtime. Then I deployed it anyway.

It changed nothing. Local Node showed no `.sort()` penalty whatsoever — all query shapes ran 130–180ms warm. The runtime has no visibility into your source.

**Flagging a guess as a guess does not make shipping it acceptable.** The correct action was to keep investigating.

### Theory 4 — "Memory exhaustion"

**Hypothesis:** the analytics aggregation pulls too many rows into the 128MB limit.

**Why it seemed plausible:** `Error 1102: Worker exceeded resource limits` reads like a memory error, and accumulating 25,000 rows genuinely does risk it.

**Why it was wrong:** 1102 covers **both** memory and CPU. The runtime log disambiguates it:

```
Error: Worker exceeded CPU time limit.     ← CPU, not memory
```

The streaming rewrite I shipped *did* fix a real memory risk. But the actual constraint was the 10ms CPU budget, which streaming did nothing for. I was optimizing the wrong resource.

---

## Part II — The eight bugs

### Bug 1 — Unbounded `await`, and the runtime that kills idle events

This is the central finding, and the one that explains most of the session's 500s.

### The signature

```
Error: The Workers runtime canceled this request because it detected that
your Worker's code had hung and would never generate a response.
```

Three properties make this uniquely painful:

1. **Nothing throws.** No exception object is ever created.
2. **`handleError` never fires.** Control never reaches your error boundary — I added a hook specifically to capture this and it printed *nothing*, which was itself the diagnostic clue.
3. **It is indistinguishable from an application bug** if you don't know the message.

### The mechanism

workerd's contract is roughly: *if no work is scheduled and no response will ever be produced, terminate the event.* An unbounded `await` on I/O that never settles satisfies that precisely.

```js
// ✗ If this never settles: zero pending work → event cancelled
const { data, error } = await supabaseQuery();
```

The code is not slow. It is *suspended forever*, and from the runtime's perspective that is indistinguishable from a deadlock.

### The fix

Race every external await against a timer you own:

```js
async function withTimeout(promise, ms, label) {
  let timer;
  const guarded = promise.finally(() => clearTimeout(timer));
  // Always observe a late settlement. If the operation rejects AFTER we
  // timed out, an unobserved rejection is itself fatal on this runtime.
  guarded.then(() => {}, () => {});
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([guarded, timeout]);
}
```

Two details that are easy to get wrong:

- **The timer keeps a real pending job on the event loop.** That is the entire mechanism — it prevents the runtime from ever seeing an idle event.
- **Late settlements must be observed.** `promise.finally()` returns a new promise; if it rejects after the race resolved, that rejection is unhandled, and unhandled rejections are their own class of runtime failure.

### What was actually unbounded

Auditing for this pattern found six instances, several on critical paths:

| Location | Operation | Consequence of hanging |
|---|---|---|
| `forEachDailyStatsRow` | Supabase page fetch | Leaderboard 500 |
| `fetchLeaderboardIdentityMap` | Supabase identity lookup | Leaderboard 500 |
| `fetchPdfViewStatsViaRpc` | Supabase RPC | Views 500 |
| **`merge_daily_stats`** | **Supabase ingest** | **Analytics data silently discarded** |
| `findActiveModerationRule` | Mongo moderation lookup | Leaderboard 500 |
| `notebooks` list | Mongo `find().sort().toArray()` | Notebooks 500 |

The `merge_daily_stats` case is the most dangerous and the least visible. An unbounded ingest doesn't error — a stalled Supabase call **silently discards your analytics data**, and no UI anywhere reports it. Invisible data loss is strictly worse than a visible 500.

### Verification

The proof that this wasn't merely masking the symptom is the *shape* of the failure changing:

```
BEFORE  [500]   69ms  crashed=true     ← runtime killed the event
AFTER   [500] 5083ms  crashed=false    ← our own JSON: "notebooks list timed out after 5000ms"
```

`crashed=false` is the meaningful part. The request still fails when Mongo is genuinely slow — but it fails **predictably, through our own error path, with a message**, instead of vanishing.

| Endpoint | Before | After |
|---|---|---|
| `leaderboard` (with `userId`) | 2/3 runtime-killed | **3/3 OK** |
| `notebooks` | 2/3 runtime-killed | handled JSON 500 |

---

### Bug 2 — Promises do not belong to a request

### The signature

```
A promise was resolved or rejected from a different request context than the
one it was created in. However, the creating request has already been
completed or canceled. Continuations for that request are unlikely to run
safely and have been canceled.
```

### The mechanism

workerd scopes I/O to a single request. The standard serverless pattern — cache a database client on the isolate, reuse it across requests — collides with this directly:

1. Request A calls `getMongoDb()`, which starts a connection, and stores the pending promise in a module-level variable.
2. Request A completes and its context is torn down.
3. The connection finishes *during request B*.
4. workerd cancels B's continuations, because the promise B is awaiting was created in a context that no longer exists.

Result: B hangs with nothing pending → runtime cancels B. Same signature as Bug 1, completely different cause.

### The fix

Cloudflare names the remedy in the warning itself:

```jsonc
// wrangler.jsonc
"compatibility_flags": [
  "nodejs_compat",
  "no_handle_cross_request_promise_resolution"
]
```

Verified by the warning **disappearing from live logs entirely**.

### Why this one matters beyond the fix

This bug is caused by doing the *recommended* thing. "Reuse connections across requests instead of reconnecting per request" is correct advice in essentially every other serverless environment, and here it is the defect. It is only safe with a specific flag.

That inversion is worth internalising: **on workerd, per-isolate client caching is not automatically an optimisation. It is a hazard with a compatibility flag attached.**

---

### Bug 3 — `distinct()` and other unbounded work in the Worker

### The signature

```
forms/popups  outcome=exceededCpu  wallTimeMs=322  cpuTimeMs=64
```

64ms of CPU against a **10ms budget**. The operation ran, and ran far too long.

### The cause

```js
// ✗ Two unbounded aggregations, executed inside the Worker
const [runs, subs] = await Promise.all([
  collection.db.collection('form_responses').distinct('formId', { userId: visitorId }),
  collection.db.collection('form_submissions').distinct('formType', { 'user.userId': visitorId })
]);
```

`distinct()` is not a cheap field read. It is a full aggregation: scan the collection, collect every distinct value, return the whole set to the Worker, where it must then be materialised and de-duplicated. Two of them, in parallel, on every popup request.

Compounding it, the popup configs query was unprojected and uncapped:

```js
// ✗ Every field of every published wizard config
collection.find({ published: true, kind: { $in: [...] } }).sort({ updatedAt: -1 }).toArray()
```

### The fix

Bounded, projected finds — the data actually needed is "which form ids has this person answered," a small set:

```js
const [runs, subs] = await withMongoTimeout(
  Promise.all([
    collection.db.collection('form_responses')
      .find({ userId: visitorId }, { projection: { formId: 1, _id: 0 } })
      .limit(500).toArray(),
    collection.db.collection('form_submissions')
      .find({ 'user.userId': visitorId }, { projection: { formType: 1, _id: 0 } })
      .limit(500).toArray()
  ]),
  5000, 'popup done-ids lookup'
);
```

Plus a projection and cap on the configs query:

```js
collection.find({ published: true, kind: { $in: ['popup', 'wizard', 'form'] } })
  .sort({ updatedAt: -1 })
  .limit(25)
  .toArray()
```

### Verification

```
cpuTimeMs: 64 (exceededCpu)  →  median 69ms, 8/8 OK
```

### The generalisable lesson

**Any operation whose cost scales with collection size is a liability in the Worker.** `distinct()`, unfiltered `find()`, and unprojected reads all move unbounded work into a 10ms budget. If the Worker doesn't need to touch every document, make the *database* do the reduction.

---

### Bug 4 — Missing query pushdown

### The signature

The analytics read endpoints began returning 503s. Root cause was a textbook case of filtering in the wrong layer:

```js
// ✗ Fetch ALL history since April, then keep 7 days — in JavaScript
const rows = filterRowsByTimeframe(await fetchDailyStatsRows(), timeframe, requestedDateKey);
```

`filterRowsByTimeframe` was correct. It was just being handed six months of rows to discard five and a half months of.

### Two compounding problems

**1. The filter ran in the wrong place.** ~6 months of rows were fetched to use 7 days.

**2. The unused column.** The select was `*`, including `usermeta` — a large JSON blob containing session state, settings, engagement counters. Neither the leaderboard nor the view counter ever read it. I was parsing megabytes of JSON to discard them.

### The fix

```js
const ANALYTICS_COLUMNS = 'user_id, anon_id, metrics, date';

let query = client
  .from('user_daily_stats')
  .select(ANALYTICS_COLUMNS)
  .order('date', { ascending: false })
  .range(from, to);
if (sinceDate) query = query.gte('date', sinceDate);   // ← pushdown

const { data, error } = await supabaseWithTimeout(query, 'daily stats page');
```

`sinceDate` is derived from the timeframe, so a `today` view fetches one day and a `weekly` view fetches seven. The JavaScript predicate is retained as a correctness backstop, but now almost never filters anything out.

### Verification

| Leaderboard | Before | After |
|---|---|---|
| 10-parallel burst | 57/60 | **60/60** |
| 18-parallel burst | 45/72 (62%) | **68/72 (94%)** |

An honest caveat on the second row: **18 concurrent requests from a single IP is a synthetic stress test, not a user-impact estimate.** It is excellent for finding bugs and actively misleading as an SLO. Real page loads don't fan out that hard.

---

### Bug 5 — Error 1102: CPU, not memory

### The misreading

```
Error 1102: Worker exceeded resource limits
```

I read this as memory, and built a streaming rewrite that accumulated rows incrementally instead of wholesale. That rewrite **did** fix a genuine memory risk — the previous version could pull 25,000 full rows into a 128MB budget.

But it did not fix the reported failure, because 1102 is emitted for both resource classes. The runtime log is the disambiguator:

```
Error: Worker exceeded CPU time limit.
```

The actual constraint was the 10ms CPU budget, and **no amount of memory tuning addresses that.**

### Why the streaming work stayed anyway

Worth being precise: the memory fix was not wasted. It removed a real failure mode that would have surfaced as the table grew. It simply wasn't the bug in front of me. Defensive work built while chasing a wrong theory can still be correct work — as long as you verify which problem you actually solved.

### The ordering that resolved it

1. `Error 1102` → hypothesised memory
2. Streaming fix → real improvement, reported failure persisted
3. `wrangler tail` → *"Exceeded CPU Limit"*
4. `cpuTimeMs: 64` on a different endpoint → confirmed the real limit
5. Found the missing pushdown (Bug 4)

Step 3 is where the theory died. It should have arrived sooner.

---

### Bug 6 — Aggregation belongs in the database

Some queries have no date bound to push down. PDF view counts are **all-time** — they must consider every row, ever. No amount of JavaScript cleverness makes that fit in 10ms.

The only correct answer is to stop doing it in the Worker.

### The migration

```sql
-- Normaliser mirroring the JS implementation. Both sides MUST agree, or
-- per-PDF filters silently return zero.
create or replace function public.norm_pdf_name(t text)
returns text language sql immutable as $$
  select lower(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(t, ''), '\.pdf$', '', 'i'),
        '[-_]+', ' ', 'g'),
      '\s+', ' ', 'g')));
$$;

create or replace function public.get_pdf_view_stats(p_pdf text)
returns table (total_reads numeric, unique_readers bigint)
language sql stable security definer set search_path = public as $$
  with src as (
    select
      coalesce(nullif(btrim(u.user_id::text), ''), nullif(btrim(u.anon_id::text), '')) as rid,
      public.norm_pdf_name(e.key) as pdf,
      case when jsonb_typeof(e.value) = 'number'
           then (e.value #>> '{}')::numeric
           else coalesce(nullif(e.value ->> 'count', '')::numeric, 0)
      end as reads
    from user_daily_stats u
    cross join lateral jsonb_each(
      coalesce(u.metrics -> 'pdf_counts', u.metrics -> 'pdfs_read', '{}'::jsonb)
    ) as e(key, value)
  )
  select coalesce(sum(reads), 0)::numeric, count(distinct rid)::bigint
  from src
  where pdf = public.norm_pdf_name(p_pdf) and rid is not null and reads > 0;
$$;

create index if not exists user_daily_stats_date_idx
  on public.user_daily_stats (date desc);
```

### The process lesson: verify the schema, never infer it

I nearly wrote this against a `stat_date` column, because the JS `getRowDateKey()` helper tried several candidate names in sequence and `stat_date` was first. Querying the live table first revealed the truth:

```
COLUMNS: id, date, user_id, anon_id, metrics, usermeta, created_at, updated_at
```

```
{"code":"42703","message":"column user_daily_stats.stat_date does not exist"}
```

Had I skipped that check, the migration would have failed at creation with an opaque Postgres error, and I'd have lost time debugging SQL instead of schema.

### Deployment ordering

The worker was written to **try the RPC first, fall back to the old scan**, so code could ship before the migration existed:

```js
const viaRpc = await fetchPdfViewStatsViaRpc(normalizedPdfName);
if (viaRpc) return json({ /* ... */ });

// Fallback: streaming scan, still bounded
await forEachDailyStatsRow(/* ... */);
```

This is worth generalising: **ship the consumer before the producer when you can**, so neither side has to be deployed atomically.

### Verification

```
get_pdf_view_stats('verify doc alpha')  →  { total_reads: 11, unique_readers: 11 }
```

Exactly matching what the worker reported independently. Tail logs confirmed the fallback warning had disappeared — the RPC path was genuinely in use, not silently falling back.

| | Before | After |
|---|---|---|
| `analytics-views` latency | ~1300ms | **~650ms** |

### A known, deliberately unfixed edge case

Testing the normaliser surfaced a flaw:

```
norm_pdf_name('  padded name.pdf  ')  →  'padded name.pdf'    ✗ .pdf not stripped
```

The `\.pdf$` anchor fails because the string ends in whitespace. The **JS implementation has the identical flaw**, so the two agree perfectly — 0 mismatches across every test case — and nothing is currently miscounted.

End-to-end, though:

```
'verify doc alpha'         → total_reads: 11
'  verify doc alpha.PDF  ' → total_reads: 0
```

I chose not to fix it. Correcting it requires changing the SQL *and* deploying the JS in lockstep, and a half-applied normalisation change is precisely how counts silently start reporting zero. It only matters if a `pdfName` ever arrives padded — which it does not in practice.

**Sometimes the right fix is to document the inconsistency rather than risk a coordinated change for a hypothetical case.**

---

### Bug 7 — Cache stampedes and the connection budget

### The mechanism

A page load fans several requests onto one cold isolate. Without request coalescing, every concurrent miss runs the producer independently. And the health endpoint was expensive per call:

```js
const [supabaseStatus, cdnStatus, incidentStatus] = await Promise.all([
  checkSupabase(),      // fetch → supabase auth endpoint
  checkCdnAPI(),        // fetch → cdn.getmaterio.app
  checkIncidentIO()     // fetch → statuspage.incident.io
]);
// ... plus a Mongo connect and a find
```

So the arithmetic was:

```
10 concurrent health polls × 3 outbound fetches  ≈  40 outbound connections
Cloudflare's hard ceiling                          =   6
```

Starved fetches never settle → the event has nothing pending → runtime cancels it. **Identical signature to Bug 1, entirely different cause.**

### Two fixes

**1. Single-flight**, so outbound pressure scales with *distinct keys* rather than request count:

```js
const inFlight = new Map();   // keyId → { promise, at }

const entry = joinableInFlight(keyId);
if (entry) {
  try { return await joinInFlight(entry); }
  catch { /* stalled — produce fresh rather than park */ }
}
const record = { promise: build(key), at: Date.now() };
inFlight.set(keyId, record);
```

**2. Stop re-probing dependencies on every poll.** Health is polled on every page load; dependency reachability does not change second to second:

```js
const DEPS_TTL_MS = 30000;
let depsCache = null;
let depsInFlight = null;

async function getDependencyStatus() {
  const now = Date.now();
  if (depsCache && now - depsCache.at < DEPS_TTL_MS) return depsCache.value;
  if (depsInFlight) return depsInFlight;         // collapse concurrent polls
  depsInFlight = (async () => { /* ...checks... */ })().finally(() => { depsInFlight = null; });
  return depsInFlight;
}
```

I also removed health's Mongo version lookup entirely. It cost a 3-second stall per poll *and* reset the shared pool on timeout — to fetch a value that is a **build-time fact**, already present in the bundled release snapshot.

### A subtlety worth stating

A `Response` body can only be read once. Coalescing callers onto a shared `Response` without cloning gives followers an **empty body**:

```js
return (await pending).clone();   // every waiter gets its own readable body
```

Easy to introduce a new bug while fixing one.

### Verification

| | Before | After |
|---|---|---|
| health, 10-parallel burst | 3/60 failing | **0/60** |
| health in production logs | frequent `worker-exception` | **absent entirely** |

---

### Bug 8 — A cache layer that was both redundant and fatal

### The signature

```
releases  outcome=exception  wallTimeMs=3125  cpuTimeMs=3
```

Three milliseconds of CPU across three-plus seconds. Not a hot path — **a timer**. The only 3000ms timer in that request path was `caches.default.match()` in my own cache wrapper.

`caches.default` was wedging on every cached request.

### The evidence that had been available all along

From an earlier probe, sitting unexamined:

```
Cache-Control: public, max-age=14400, s-maxage=300
CF-Cache-Status: HIT
X-Edge-Cache: MISS
```

Read carefully:

- **`CF-Cache-Status: HIT`** — Cloudflare's CDN was already caching these responses correctly.
- **`s-maxage=300`** — that header was doing exactly what it was designed to do.
- **`X-Edge-Cache: MISS` on every response** — I read this as "the in-Worker cache is broken." It wasn't. It was the `MISS` header from the original request, **stored inside the cached copy** and replayed forever after.

So the in-Worker Cache API was *redundant* — the CDN layer above it was already doing the job — and it was *actively causing the outage*.

### The fix

Two layers, neither of which can wedge:

```js
// Layer 1: per-isolate in-memory TTL map — no platform I/O
const memCache = new Map();
const MAX_MEM_ENTRIES = 200;

// Layer 2: Cloudflare's CDN, via response headers
res.headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
```

`caches.default` was removed entirely. This also eliminated a dangling platform promise from every cached request.

### Verification

```
releases                → 8/8 OK, median 79ms
features?action=releases → 8/8 OK, median 85ms
```

From `exception @3125ms` to clean.

### The lesson

`X-Edge-Cache: MISS` on a response that is demonstrably being served from cache is a **diagnostic header lying to you** — because it was captured at store time and never updated. A diagnostic that can be wrong is worse than no diagnostic, because it confidently misdirects.

---

## Part III — Two bugs I created myself

### The poisoned in-flight entry

The single-flight fix in Bug 7 was initially written as:

```js
const pending = build(key).finally(() => inFlight.delete(keyId));
inFlight.set(keyId, pending);
```

Entries were removed **only when the producer settled**. If the producer never settled, `.finally()` never ran, the entry lived forever, and every subsequent request for that key awaited a dead promise:

```
GET /api/v2/notifications  →  Canceled @ 30s   (repeatedly, every round)
```

The fix bounds entry lifetime:

```js
const INFLIGHT_MAX_AGE_MS = 10000;

function joinableInFlight(keyId) {
  const entry = inFlight.get(keyId);
  if (!entry) return null;
  if (Date.now() - entry.at > INFLIGHT_MAX_AGE_MS) {
    inFlight.delete(keyId);       // treat a stale entry as dead
    return null;
  }
  return entry;
}

async function joinInFlight(entry) {
  const shared = await Promise.race([
    entry.promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('in-flight producer stalled')), INFLIGHT_MAX_AGE_MS))
  ]);
  return shared.clone();
}
```

**The aggravating detail:** I had already fixed this exact poison pattern in the Mongo layer earlier in the same session — the "retire a never-settling attempt" comment is still in `mongodb.js`. I then recreated it verbatim in a different file.

What made it visible was a subtlety specific to this app: **`?t=` cache-busters are stripped from the cache key by design.** So every notification request in my probe shared a *single* key. One dead entry blocked all of them, every round.

The same poisoned entry was also starving the isolate — those hung requests each held Mongo operations for 30 seconds — which is why `search` CPU failures disappeared as a side effect. **A symptom disappearing for unrelated reasons is a warning sign, not a fix.**

### The connection-pool regression

While fixing cache stampedes I set:

```js
maxPoolSize: 4,        // correct — below Cloudflare's 6-connection ceiling
maxIdleTimeMS: 5000    // ✗ regression I introduced
```

The reasoning for 5000 was "release idle sockets fast so they don't occupy slots." The effect was the opposite. With request gaps exceeding 5 seconds — which is most gaps in low-traffic apps — **every read paid a fresh cold handshake** of roughly 2.4 seconds.

The symptom was distinctive:

```
709ms, 5091ms, 209ms, 5093ms, 315ms, 5180ms, 212ms, 5103ms
```

Perfectly alternating fast and slow — two isolates, one healthy and one permanently exhausted, round-robined by anycast. I initially misread this as rate limiting or a slow query.

Reverting to 30s:

```
notifications: 4/8 timeouts, median 5091ms  →  0/8 timeouts, median 87ms
```

**A ~60× improvement from a one-line revert.** The lesson: when a "fix" makes latency dramatically worse, check whether it was ever addressing the thing you measured.

---

## Part IV — Application-level defects

### Telemetry must not hard-fail on auth

Users saw this in the console:

```
POST /api/v2/features?action=analytics  401 (Unauthorized)
```

Meaning **analytics was silently collecting nothing.** The cause:

```js
const token = getTokenFromHeaders(request.headers);
const decoded = token ? verifyToken(token) : null;

if (token && (!decoded || !decoded.id || !ANALYTICS_UUID_REGEX.test(decoded.id))) {
  return json({ error: 'Invalid analytics auth token' }, { status: 401 });
}
```

An expired session token caused **every** flush to be rejected until the client refreshed it. Best-effort telemetry was gated on credential freshness.

### The fix, and the security detail that matters

Drop the *attribution* while still recording the data:

```js
let decoded = null;
let tokenRejected = false;
if (token) {
  decoded = verifyToken(token);
  if (!decoded || !decoded.id || !ANALYTICS_UUID_REGEX.test(decoded.id)) {
    decoded = null;
    tokenRejected = true;
  }
}

// Identity-mismatch guard still applies when the token verified
if (!tokenRejected && data.rawUserId && decoded?.id && data.rawUserId !== decoded.id) {
  return json({ error: 'User identity mismatch in analytics payload' }, { status: 403 });
}

// Critically: if a token was PRESENT but rejected, rawUserId must be ignored
// entirely — otherwise anyone can claim another account by sending garbage.
data.p_user_id = decoded?.id
  || (!tokenRejected && data.rawUserId && ANALYTICS_UUID_REGEX.test(data.rawUserId)
        ? data.rawUserId
        : null);
```

The naive fix — deleting the 401 and trusting `rawUserId` — would have introduced an **impersonation vulnerability**. Making a system more forgiving requires checking what the strictness was protecting.

Verified across all cases: garbage token, empty bearer, unsigned JWT, and bad-token-plus-`rawUserId` all return `200 {"success":true}`.

### A desktop updater gated on the wrong platform

Users on Windows reported being stuck on "Checking for updates…" while the mobile app correctly detected a new version.

Three separate defects:

**1. An unawaitable native call.** The Tauri updater plugin's `check()` was awaited with no timeout. The release pipeline ships no updater signatures, so that call could never settle — the `await` hung, the caller's `finally` never ran, and the spinner never cleared. Now time-boxed at 4s with fallthrough.

**2. Android gates applied to desktop.** The entire update flow was gated on Android APK availability, even on Windows:

```js
const apkAvailable = androidInfo.available !== false && Boolean(androidInfo.downloadUrl);
if (!apkAvailable) { showToastMessage('You are on the latest version!'); return; }
```

An Android-only release made Windows updates invisible. Desktop now branches first and reads `data.windows`.

**3. Wrong version compared.** The comparison used the *Android* version against the local Tauri version.

The message is now specific enough to be diagnosable:

> *"You have the latest Windows build (v2.1.77). No newer Windows download is published yet."*

versus the old, misleading *"You are on the latest version!"*

---

## Part V — Operations

### The CI path filter that silently skipped releases

A subtle failure with real consequences, and a good illustration of **green CI meaning nothing**.

```yaml
### .github/workflows/build-and-release.yml
ANDROID=false
WINDOWS=false
echo "$FILES" | grep -Eq '^(android/|capacitor\.config\.json)' && ANDROID=true || true
if echo "$FILES" | grep -Eq '^(src-tauri/|\.github/workflows/build-and-release\.yml)'; then
  ANDROID=true
  WINDOWS=true
fi
```

Branch pushes touching neither path build **neither app** — and the run still reports **success**, because skipping every job trivially satisfies "all jobs succeeded."

The observable evidence:

```
completed  success  Fix notifications cache-miss storm…  Build & Release Apps  master  push  14s
completed  success  Root-cause the worker kills…        Build & Release Apps  master  push  11s
```

**11–14 seconds.** An Android APK build takes ~2m30s; a Tauri build ~6m15s. Duration alone proves nothing was built.

The chain of events:

1. I added Capacitor plugins, ran `npx cap sync android`, which modified `android/**`
2. That tripped the Android filter → Android built → **v2.1.79 shipped with an APK only**
3. Nothing touched `src-tauri/` → Windows skipped → **Windows stranded on v2.1.77**
4. The run reported success throughout
5. Windows users got "no update available" — which looked like an app bug and wasn't

**I caused this**, by a change that had nothing to do with releases.

Two mitigations, both used:

```bash
### Explicit dispatch, bypassing the filter
gh workflow run "Build & Release Apps" -f platform=both

### Tag push — the path filter only applies to branch pushes, and the version
### is read straight from the tag. Both platforms build, exact version control.
git tag -a v2.1.90 -m "..." && git push origin v2.1.90
```

**Recommendations:** default to building both, or fail loudly when the filter skips. A green check that means "nothing happened" is actively dangerous — it actively concealed a broken release for hours.

### There is no OTA

Assumed throughout that existing installs would receive updates over the air. Two independent confirmations that this was never true:

- `@capacitor/live-updater` is **not** in `package.json`; `capacitor.config.json` has no live-update block
- The "background in-app updates" in the release notes is `AndroidBridge.downloadAndInstallUpdate(apkUrl)` — a **full APK download and install** after a user tap

So "old ones will receive OTA" was wrong twice over: no app was built, and even when one is, delivery is a manual install.

One silver lining: because delivery is a real install rather than OTA, native plugins ship correctly. An OTA update can only deliver web assets — **native plugin code requires a new binary.** Any change to `@capacitor/device` or `@capacitor/app` is invisible to OTA.

### The Play Store fee, and what `installId` actually costs

Two unrelated costs that were conflated:

- The **$25 one-time** fee is Google's *Play Console developer account* registration. It applies to publishing **any** app, including one that collects zero data.
- **`installId` is free.** Capacitor's `Device.getId()` generates a UUID locally on the device. No API call, no Google service, no cost.
- The **Data Safety form only exists inside Play Console.** No Play account → nothing to declare.

Corollary worth noting: because the analytics ingest sends `p_user_id`, logged-in users' `installId` rows get merged into `user_daily_stats` keyed to their account. That makes it **linked to a user identity** rather than anonymous, which changes two answers on the form — it must be disclosed as linked, and it stops being exempt from account-deletion requests.

---

## Part VI — Synthesis

### The meta-lesson

Roughly two-thirds of this session produced confident, well-reasoned, incorrect diagnoses. The pattern was constant: **I formed a theory from the symptoms available to me, and the symptom set was compatible with several unrelated causes.**

What broke each deadlock was narrowing the hypothesis space with **evidence that discriminated between causes** — not evidence that merely confirmed the one I already had:

| Evidence | What it discriminated |
|---|---|
| `cpuTimeMs: 3` vs `64` | Timer elapsed vs expensive operation |
| `wallTimeMs: 3125` matching a 3000ms timeout | Cache API, not Mongo |
| `scriptVersion` | Which failures were still real |
| `outcome: exception` vs `exceededCpu` | Two unrelated bugs behind one symptom |
| A live `console.warn` naming a missing function | Zero guessing required |
| `crashed=false` vs `true` | Runtime kill vs our own error path |

**A twenty-second log read would have saved several multi-minute deploy cycles.** The expensive failure was not the wrong theory — it was failing to look for the cheap discriminator first.

The second lesson is less comfortable: **I created two of the eight bugs myself.** An in-flight cache poison that hung requests for 30 seconds, and a `maxIdleTimeMS` regression that added ~2.4 seconds to nearly every read. Optimising a system under pressure degrades your ability to reason about it — every change adds state that future-me must hold in their head. Instrument first, then change.

### Checklist for serverless reliability

1. **Never `await` I/O without a timer.** On a runtime that kills idle events, this is the difference between a graceful 500 and an unexplainable one.
2. **Observe late promise settlements** (`promise.then(() => {}, () => {})`) so timeouts don't manufacture unhandled rejections.
3. **Read `cpuTimeMs`, `wallTimeMs`, `outcome`, `scriptVersion` together** before reading application code.
4. **Push filtering into the database.** Fetching everything and filtering in the Worker will eventually exceed any CPU budget.
5. **`select()` only what you read.** An unused JSON column can be the largest thing you parse.
6. **Prefer bounded, projected finds** over `distinct()` or unfiltered scans.
7. **Add single-flight to any cache, and bound in-flight entries by age.** A settled-only cleanup guarantees a corpse entry if the producer ever hangs.
8. **Clone `Response` bodies before sharing them.** One read per response, always.
9. **Prefer the platform CDN** over an in-process cache, and verify it's actually working via status headers.
10. **Check your provider's connection ceiling** and size pools beneath it.
11. **Confirm which compatibility flags your shared-state pattern requires.** Per-isolate client caching is a hazard, not an optimisation, without one.
12. **Never ship a labelled hypothesis.** If it isn't proven, it isn't ready.
13. **Add a `handleError` hook early.** Without one, unhandled throws are invisible — no stack, no message, just a status code.
14. **Verify migrations against the live schema**, never against your assumption of it.
15. **Ship the consumer before the producer** where possible, so neither side needs atomic deployment.

### Results

| Metric | Before | After |
|---|---|---|
| Sustained 30-round loop | 3 crashes | **0 anomalies** |
| 10-parallel burst | 57/60 | **60/60** |
| 18-parallel burst | 45/72 | **68/72** |
| 11-parallel burst (full endpoint set) | 50/55 | **53/55** |
| `forms/popups` | 64ms CPU (6× budget) | **69ms median, 8/8** |
| `releases` | exception @ 3125ms | **8/8, 79ms median** |
| `leaderboard` (with `userId`) | 2/3 runtime-killed | **3/3 OK** |
| `notebooks` | 2/3 runtime-killed | handled JSON 500 |
| `notifications` | 4/8 timeouts, 5091ms median | **0/8, 87ms median** |
| `analytics-views` latency | ~1300ms | **~650ms** |
| Analytics on stale token | silent 401, data lost | **records anonymously** |
| Cold-isolate CPU limit, `health` | recurring | **eliminated** |

Shipped as **v2.1.90** — Android (54.2 MB) and Windows (78.8 MB + MSI), both confirmed available through the release API.

### What remained unfixed

Listed deliberately, because knowing the boundary of what you fixed is part of fixing it.

- **Six unbounded Mongo awaits** in form-submission and sharelink/LLM handlers. Same bug shape as Bug 1, off the critical path, **left untouched because they were inferred rather than reproduced.**
- **`Promise will never complete`** on notifications — a genuinely different signature from the hang: an abandoned promise rather than an idle event. Not diagnosed.
- **Search CPU under concurrency.** Never properly fixed. An apparent earlier improvement turned out to be collateral damage from a poisoned cache entry disappearing, which I explicitly flagged at the time and did not claim as a fix.
- **Intermittent 502s** on `examdata` and `features?action=releases`. No application handler returns 502, which points at the edge rather than application code. Unexplained.
- **A CI path filter** that reports success while building nothing.

"We eliminated the hangs we could reproduce" is true. "There are no more hangs" is not — and the `handleError` hook added along the way means the next one will arrive with a stack trace attached, which is the only reason to be optimistic about closing the remaining gap rather than guessing at it.

---

## Appendix A — Reproducing the core finding

The unbounded-`await` hang is straightforward to demonstrate without any application code, which is exactly what makes it worth understanding.

```js
// Add a route that awaits I/O which never settles.
export async function GET() {
  await new Promise(() => {});   // never resolves
  return new Response('unreachable');
}
```

Request it and observe:

- **No stack trace** in any error view
- **`handleError` never fires**
- `outcome: "exception"`, `cpuTimeMs` near zero
- Runtime log: *"your Worker's code had hung and would never generate a response"*

Then add a timer and observe the request complete normally:

```js
export async function GET() {
  await Promise.race([
    new Promise(() => {}),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
  ]);
}
```

That contrast is the whole lesson in two snippets: **the runtime does not detect slowness, it detects the absence of pending work.**

## Appendix B — Glossary

| Term | Meaning in this context |
|---|---|
| **Isolate** | A worker's execution context. Module-level state persists across requests handled by the same isolate, which is what makes shared clients possible — and hazardous. |
| **Cross-request promise resolution** | A promise created during request A settling during request B. workerd cancels B's continuations unless the compatibility flag is set. |
| **Crossed request** | The resulting cancellation event. |
| **Outcome: `exception`** | The event threw, or the runtime terminated it. Does not distinguish the two. |
| **Outcome: `exceededCpu`** | CPU budget exhausted. Independent of memory. |
| **Error 1102** | Emitted for **either** memory or CPU exhaustion. Disambiguate from the runtime log message. |
| **Single-flight** | Collapsing concurrent cache misses for one key onto a single producer run. |
| **Query pushdown** | Moving filtering, sorting, and aggregation into the database rather than the application. |
| **Distinct** | A MongoDB aggregation returning every unique value of a field — full collection scan, unbounded result. |
| **Degraded response** | A valid 200 served from a fallback source because the primary was unavailable. Must not occupy a cache at full TTL. |
| **Stampede** | Many concurrent requests missing the same cache key and all invoking the expensive producer simultaneously. |