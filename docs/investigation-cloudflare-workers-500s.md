# How Six Unrelated Bugs Hid Behind One Symptom

### A post-mortem of eliminating recurring 500s from a Cloudflare Workers app on a 10ms CPU budget

---

## TL;DR

A SvelteKit app on Cloudflare Workers was throwing recurring `500`s and `503`s. Over one working session the failure turned out to be **six independent bugs** that all presented as the same undifferentiated "server error." Two of them were self-inflicted during the debugging process itself.

The single most valuable thing I learned was not a fix. It was a **diagnostic method**: reading `cpuTimeMs`, `wallTimeMs`, `outcome`, and `scriptVersion` together tells you which *class* of bug you're looking at before you read a single line of application code.

If you take one thing from this: **on a serverless runtime, the most dangerous statement is an unbounded `await`.**

---

## Context

The system:

- **SvelteKit** → Cloudflare Workers (`adapter-cloudflare`)
- **MongoDB Atlas**, AWS Mumbai (`ap-south-1`)
- **Supabase** (Postgres + PostgREST) for analytics
- **Cloudflare free tier: 10ms CPU per invocation**, 128MB memory

The reported symptom was vague and unhelpful: "the site sometimes 500s." My probes confirmed it was real — a sustained 30-round loop caught crashes the user could reproduce, and the production logs showed thousands of `outcome: "exception"` events per day.

What followed was a lesson in how badly wrong you can be while being completely plausible.

---

## Why my approach failed for the first five hours

I began the way everyone does: form a hypothesis, change code, deploy, observe. This produced **four wrong theories, one of which I shipped to production**.

| # | Theory | Verdict | How it was disproved |
|---|--------|---------|---------------------|
| 1 | Poisoned Mongo connection pool | Wrong | Connection-string/allowlist checks all fine; warm requests worked |
| 2 | Cross-ocean latency (Atlas far from edge PoP) | Wrong | User confirmed Atlas is Mumbai — near the edge. Retracted immediately |
| 3 | Cursor `.sort()` wedges the driver | **Wrong — and I shipped it** | Local Node showed no penalty; production unchanged after deploy |
| 4 | Memory exhaustion in aggregation | Half-right | Fixed a real leak, but the actual failure was CPU |
| 5 | Mongo connect races | Partly right | Led to the compat flag, which was genuinely necessary |

Theory 3 deserves special condemnation. I narrowed the problem to `.sort()` by elimination, explicitly labelled it *"a hypothesis, not a finding,"* and then deployed it anyway. It changed nothing. **Flagging a guess as a guess does not make deploying it acceptable.**

What finally broke the deadlock was the user pasting raw Cloudflare log JSON. Two fields in it — `cpuTimeMs` and `wallTimeMs` — separated two bugs that had looked identical for hours.

---

## Finding 0: Learn to read the telemetry triangle

Every Cloudflare Workers error event carries four fields that, read together, classify the failure:

| Field | Meaning |
|---|---|
| `outcome` | `exception`, `exceededCpu`, or success |
| `cpuTimeMs` | CPU actually consumed |
| `wallTimeMs` | Total elapsed |
| `scriptVersion.id` | Which build served this |

Two bugs, both surfacing as "500":

```
releases        outcome=exception  wallTimeMs=3125  cpuTimeMs=3
forms/popups    outcome=exceededCpu wallTimeMs=322  cpuTimeMs=64
```

These demand completely different investigations:

- **3ms CPU but 3.1 seconds wall** → the CPU never ran. *A timer elapsed.* Look for timeouts, not hot loops.
- **64ms CPU against a 10ms budget** → a genuinely expensive operation. Find the code doing work.

Then there is the most valuable trick in this whole post:

```
scriptVersion: e1b0cd32   ← stale, already fixed
scriptVersion: 2f05c500   ← current, still broken
```

When a bug hunt spans multiple deploys, **pasted logs are a mix of old and new builds.** I spent time investigating failures that had been fixed hours earlier. Always check `scriptVersion` before believing a log line.

---

## Finding 1: workerd cancels events with no pending work

> **The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response.**

This is the signature behind most of the session's failures, and it is uniquely nasty for three reasons:

1. **Nothing throws.** There is no stack trace, because no exception was ever created.
2. **`handleError` never fires**, because control never reaches your error boundary.
3. **It's indistinguishable from a bug** if you don't know the message.

The cause is almost always an unbounded `await`:

```js
const { data, error } = await supabaseQuery();   // no timer
```

If that I/O never settles, the event has **zero pending work**. The runtime's contract is: if nothing is scheduled and no response will ever be produced, kill it. From its perspective the worker genuinely hung.

### The fix

Race every external await against a timer you own:

```js
async function withTimeout(promise, ms, label) {
  let timer;
  const guarded = promise.finally(() => clearTimeout(timer));
  guarded.then(() => {}, () => {});          // always observe late outcomes
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([guarded, timeout]);
}
```

Two details that matter:

- The timer keeps a **real pending job** on the event loop, so the runtime never sees an idle event.
- `guarded.then(() => {}, () => {})` prevents a promise that settles *after* the timeout from becoming an unhandled rejection — which on a serverless runtime is itself a crash.

### What this fixed

Every unbounded await I could find, which turned out to be the majority of the session's 500s:

- `forEachDailyStatsRow` — Supabase page fetch behind the leaderboard
- `fetchLeaderboardIdentityMap` — identity lookup
- `fetchPdfViewStatsViaRpc` — PDF view counts
- **`merge_daily_stats`** — the analytics ingest
- `findActiveModerationRule` — Mongo moderation lookup
- `notebooks` list — Mongo `find().sort().toArray()`

That last category deserves emphasis. An unbounded `merge_daily_stats` doesn't just error — a stalled Supabase call **silently discards your analytics data**, and no UI anywhere shows you. Invisible data loss is worse than a visible 500.

### Verification

The signal that proved it wasn't just masked:

```
before:  [500]  69ms crashed=true   ← runtime killed the event
after:   [500] 5083ms crashed=false  ← our own JSON: "notebooks list timed out after 5000ms"
```

`crashed=false` is the important part. The request still fails when Mongo is genuinely slow — but it fails *predictably*, through our own error path, with a message.

| Endpoint | Before | After |
|---|---|---|
| `leaderboard` (with `userId`) | 2/3 runtime-killed | **3/3 OK** |
| `notebooks` | 2/3 runtime-killed | handled JSON 500 |

---

## Finding 2: Promises don't belong to a request

> **A promise was resolved or rejected from a different request context than the one it was created in... Continuations for that request are unlikely to run safely and have been canceled.**

workerd scopes I/O to a single request. The standard serverless pattern — cache a client on the isolate and share it across requests — runs straight into this. Request A creates the database connection, A finishes, the connection settles *inside request B*, and B's continuations get cancelled.

**The fix is a compatibility flag**, named in the warning itself:

```jsonc
// wrangler.jsonc
"compatibility_flags": [
  "nodejs_compat",
  "no_handle_cross_request_promise_resolution"
]
```

Verified by the warning disappearing from live logs entirely.

This finding is worth internalising because **the "obvious" optimisation causes the bug.** Caching a client per isolate is standard advice everywhere else, and it's correct here *only* with this flag.

---

## Finding 3: Error 1102 means CPU, not memory

The analytics read endpoints started returning:

```
Error 1102: Worker exceeded resource limits
```

I read that as memory and built a streaming rewrite. Wrong. `1102` covers **both** memory and CPU, and the runtime logs disambiguate it:

```
Error: Worker exceeded CPU time limit.     ← not memory at all
```

The free tier allows **10ms CPU**. My aggregation was scanning every `user_daily_stats` row since April and unnesting JSON in JavaScript. No amount of memory tuning fixes that.

The real problem was textbook **missing query pushdown**:

```js
// ✗ Fetch ALL history, then filter to 7 days in JS
filterRowsByTimeframe(await fetchAllRows(), 'weekly', date)

// ✓ Let the database do it
client.from('user_daily_stats')
  .select('user_id, anon_id, metrics, date')
  .gte('date', sevenDaysAgo)
```

Two changes fixed the leaderboard completely:

1. **Push the timeframe filter into the query** — ~6 months of rows became 7 days.
2. **Select only the columns used** — `usermeta` was a large JSON blob that neither aggregation ever read. I had been parsing megabytes to discard them.

| Leaderboard | Before | After |
|---|---|---|
| 10-parallel burst | 57/60 | **60/60** |
| 18-parallel burst | 45/72 (62%) | **68/72 (94%)** |

Note the honest caveat in that last row: 18 concurrent requests from one IP is a synthetic stress test, not a user-impact estimate. It's excellent for *finding* bugs and misleading as an SLO.

---

## Finding 4: Move aggregation into the database

The `today` timeframe for view counts had no date bound to push down — it's genuinely all-time. No amount of JavaScript optimisation makes that fit in 10ms.

The only correct answer was to stop doing it in the Worker:

```sql
create or replace function public.get_pdf_view_stats(p_pdf text)
returns table (total_reads numeric, unique_readers bigint)
language sql stable security definer set search_path = public
as $$
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
```

**Critical process point: get the schema, don't infer it.** I nearly wrote this against a `stat_date` column. Querying the live table first revealed the real column is `date` — my guess would have failed at creation time:

```
column user_daily_stats.stat_date does not exist
```

| | Before | After |
|---|---|---|
| `analytics-views` latency | ~1300ms | **~650ms** |
| Fallback warnings in logs | present | **gone** |

The worker calls the RPC first and falls back to the old scan, so deploying the code *before* running the migration was safe.

---

## Finding 5: Cache stampedes exhaust the connection budget

A page load fans several requests onto one cold isolate. With no single-flight, all concurrent misses run the producer. Health checks made **three outbound fetches each**:

```
10 concurrent health polls × 3 fetches = ~40 outbound connections
Cloudflare's hard ceiling:                 6
```

Starved fetches never settle → hang → runtime cancels the event. Same signature as Finding 1, completely different cause.

```js
const inFlight = new Map();   // key -> { promise, at }
```

Concurrent misses collapse onto one producer run, so outbound pressure scales with **distinct keys** rather than request count.

**But this is where I introduced a new bug.** My first version removed map entries only in `.finally()`:

```js
const pending = build(key).finally(() => inFlight.delete(keyId));
```

If the producer *never settles*, `.finally()` never runs, the entry lives forever, and every subsequent request awaits a corpse — a 30-second hang on every request. I had fixed this exact poison pattern in the Mongo layer earlier and then recreated it in the cache.

```js
const INFLIGHT_MAX_AGE_MS = 10000;

function joinableInFlight(keyId) {
  const entry = inFlight.get(keyId);
  if (!entry) return null;
  if (Date.now() - entry.at > INFLIGHT_MAX_AGE_MS) {
    inFlight.delete(keyId);          // treat stale entries as dead
    return null;
  }
  return entry;
}
```

One subtlety worth calling out: a `Response` body can only be read once. Coalescing callers onto a shared `Response` makes followers receive an empty body unless every waiter gets `.clone()`.

---

## Finding 6: The Cache API was redundant and harmful

`releases` died with `wallTimeMs: 3125, cpuTimeMs: 3` — 3ms of CPU at 3.1 seconds of wall time. That is not a hot path; it's **a timer elapsing**. It matched a `3000ms` timeout in my own cache wrapper: `caches.default.match()` was wedging on every cached request.

The decisive evidence had been sitting in an earlier probe all along:

```
Cache-Control: public, max-age=14400, s-maxage=300
CF-Cache-Status: HIT          ← the CDN was already caching correctly
X-Edge-Cache: MISS            ← a stale header baked into the cached copy
```

Cloudflare's CDN was doing the caching properly via `s-maxage`. The in-Worker Cache API was redundant *and* was the thing causing the outage. Removing it also removed a dangling platform promise from every cached request.

The misleading `X-Edge-Cache: MISS` on every response nearly sent me down the wrong path — it was simply the header from the original MISS, stored inside the cached copy.

---

## Finding 7: `distinct()` is not free

`forms/popups` reported `cpuTimeMs: 64` against a 10ms budget. The culprit:

```js
// ✗ Unbounded aggregations, executed in the Worker
distinct('formId',     { userId: visitorId })
distinct('formType',   { 'user.userId': visitorId })
```

`distinct()` scans the collection and materialises every distinct value. Plus an unprojected `find().sort().toArray()` pulling every field of every wizard config. Replaced with bounded, projected finds:

```
cpuTimeMs: 64 (exceededCpu)  →  median 69ms, 8/8 OK
```

---

## Finding 8: Telemetry shouldn't hard-fail on auth

Users saw `401` on the analytics endpoint, meaning **analytics was silently collecting nothing**. The cause:

```js
if (token && !verifyToken(token)) {
  return json({ error: 'Invalid analytics auth token' }, { status: 401 });
}
```

An expired session token meant every flush was rejected until the client refreshed it. Telemetry is best-effort; it must never die on a stale credential.

The fix drops the *attribution* while still recording the data. One security detail matters — if a token was present but invalid, the client-supplied `userId` must be **ignored entirely**, otherwise anyone could claim another account:

```js
data.p_user_id = decoded?.id || (!tokenRejected && validRawUserId ? rawUserId : null);
```

---

## The meta-lesson

Roughly two-thirds of this session produced **confident, well-reasoned, wrong** diagnoses. The pattern was identical every time: I formed a theory from symptoms available to me, and the symptom set was compatible with several unrelated causes.

What worked was narrowing the hypothesis space with **evidence that discriminated between causes**, not evidence that merely confirmed one:

- `cpuTimeMs: 3` vs `64` → timer vs expensive operation
- `wallTimeMs: 3125` matching a `3000ms` timeout → the Cache API, not Mongo
- `scriptVersion` → which logs were even still relevant
- `outcome: exception` vs `exceededCpu` → two unrelated bugs
- a live `console.warn` → the function that wasn't found, without any guessing

**Cheap discriminators beat expensive confirmation.** A twenty-second log read would have saved several multi-minute deploy cycles.

The second lesson: **I created two of the eight bugs myself** — the in-flight poison and the misdiagnosed memory/CPU split. Optimising a system under pressure degrades your ability to reason about it. Instrument first, then change.

---

## A checklist for serverless reliability

1. **Never `await` I/O without a timer.** On a runtime that kills idle events, this is the difference between a graceful 500 and an unexplainable one.
2. **Observe late promise settlements** (`promise.then(() => {}, () => {})`) so timeouts don't create unhandled rejections.
3. **Read `cpuTimeMs`, `wallTimeMs`, `outcome`, `scriptVersion` together** before reading code.
4. **Push filtering into the database.** Fetching everything and filtering in the Worker will eventually exceed the CPU budget.
5. **`select()` only what you read.** An unused JSON column can be the largest thing you parse.
6. **Add single-flight to any cache**, and bound in-flight entries by age.
7. **Stay under platform connection limits** — know your provider's ceiling.
8. **Prefer the platform CDN** over an in-process cache; verify with `CF-Cache-Status`.
9. **Cache the compatibility flags your shared-state pattern requires.**
10. **Never ship a labelled hypothesis.** If it isn't proven, it's not ready.
11. **Add a `handleError` hook early.** Without one, unhandled throws are invisible — no stack, no message, just a status code.
12. **Verify migrations against the live schema**, not your assumption of it.

---

## Result

| Metric | Before | After |
|---|---|---|
| Sustained 30-round loop | 3 crashes | **0 anomalies** |
| 10-parallel burst | 57/60 | **60/60** |
| 18-parallel burst | 45/72 | **68/72** |
| `forms/popups` | 64ms CPU (6× budget) | **69ms median, 8/8** |
| `releases` | exception @3125ms | **8/8, 79ms median** |
| `leaderboard` (`userId`) | 2/3 killed | **3/3 OK** |
| `analytics-views` | ~1300ms | **~650ms** |
| Analytics ingest on stale token | silent 401, data lost | **records anonymously** |

Shipped as **v2.1.90** (Android + Windows).

---

### A closing note on what wasn't fixed

Some things remained open, and listing them matters more than the wins:

- **6 unbounded Mongo awaits** in forms and sharelink lookups — same bug shape as Finding 1, off the critical path, left untouched because I hadn't reproduced them. *Inferred, not verified.*
- **Search CPU under concurrency** — never genuinely fixed; an earlier apparent improvement turned out to be collateral damage from a poisoned cache entry disappearing.
- **`Promise will never complete`** on notifications — a genuinely different signature (abandoned promise, not a hang).
- **Intermittent 502s** — no handler returns 502, pointing at the edge rather than application code.

Knowing the boundary of what you actually fixed is part of fixing it. "We eliminated the hangs we could reproduce" is true. "There are no more hangs" is not — and the `handleError` hook added along the way means the next one will finally arrive with a stack trace attached.