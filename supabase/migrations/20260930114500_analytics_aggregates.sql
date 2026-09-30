-- Analytics aggregates moved into Postgres.
--
-- WHY: the Worker used to fetch every user_daily_stats row since April and
-- unnest metrics->'pdf_counts' itself. On Cloudflare's free tier (10ms CPU per
-- invocation) that reliably trips:
--     Error 1102: Worker exceeded resource limits
--     "Error: Worker exceeded CPU time limit."
-- observed on /api/v2/features?action=analytics-views and action=analytics-leaderboard.
--
-- Doing the jsonb_each sum server-side returns one row, so the Worker does no
-- per-row work at all. Schema used here was verified against the live table:
--   user_daily_stats(id, date, user_id, anon_id, metrics, usermeta, created_at, updated_at)
--   metrics = {"pdf_counts":{"<pdf>":{"count":N,"time_sec":N}},"total_reading_sec":N}
-- Note the date column is `date` -- there is no `stat_date`.

-- ---------------------------------------------------------------------------
-- 1. Name normaliser. Mirrors normalizeAnalyticsPdfName() in
--    src/lib/server/features-handler.js: lowercase, strip .pdf, [-_]+ -> ' ',
--    collapse whitespace, trim. Both sides must agree or per-PDF filters
--    silently return zero.
-- ---------------------------------------------------------------------------
create or replace function public.norm_pdf_name(t text)
returns text
language sql
immutable
as $$
  select lower(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(t, ''), '\.pdf$', '', 'i'),
        '[-_]+', ' ', 'g'),
      '\s+', ' ', 'g')));
$$;

-- ---------------------------------------------------------------------------
-- 2. All-time read + unique-reader counts for a single PDF.
--    Powers action=analytics-views (the "N reads" shown on a PDF).
--    Handles both the object form ({"count":N,"time_sec":N}) and the legacy
--    bare-number form, and falls back to pdfs_read if pdf_counts is absent.
-- ---------------------------------------------------------------------------
create or replace function public.get_pdf_view_stats(p_pdf text)
returns table (total_reads numeric, unique_readers bigint)
language sql
stable
security definer
set search_path = public
as $$
  with src as (
    select
      coalesce(nullif(btrim(u.user_id::text), ''), nullif(btrim(u.anon_id::text), '')) as rid,
      public.norm_pdf_name(e.key) as pdf,
      case
        when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric
        else coalesce(nullif(e.value ->> 'count', '')::numeric, 0)
      end as reads
    from user_daily_stats u
    cross join lateral jsonb_each(
      coalesce(u.metrics -> 'pdf_counts', u.metrics -> 'pdfs_read', '{}'::jsonb)
    ) as e(key, value)
  )
  select
    coalesce(sum(reads), 0)::numeric as total_reads,
    count(distinct rid)::bigint as unique_readers
  from src
  where pdf = public.norm_pdf_name(p_pdf)
    and rid is not null
    and reads > 0;
$$;

-- ---------------------------------------------------------------------------
-- 3. Per-reader rollup over a trailing window (default 7 days).
--    Server-side counterpart of action=analytics-leaderboard. Optional: the
--    Worker currently pushes .gte('date', ...) into PostgREST and aggregates
--    in JS, which already fits the CPU budget. Use this if the table grows
--    enough that even the bounded scan gets tight.
-- ---------------------------------------------------------------------------
create or replace function public.get_leaderboard_rollup(p_days int default 7)
returns table (
  reader_id text,
  is_anon boolean,
  total_reads numeric,
  total_read_sec numeric,
  unique_pdfs bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with src as (
    select
      coalesce(nullif(btrim(u.user_id::text), ''), nullif(btrim(u.anon_id::text), '')) as rid,
      (u.user_id is null) as anon,
      public.norm_pdf_name(e.key) as pdf,
      case
        when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric
        else coalesce(nullif(e.value ->> 'count', '')::numeric, 0)
      end as reads,
      case
        when jsonb_typeof(e.value) = 'number' then 0::numeric
        else coalesce(
          nullif(e.value ->> 'time_sec', '')::numeric,
          nullif(e.value ->> 'duration_sec', '')::numeric,
          0)
      end as read_sec
    from user_daily_stats u
    cross join lateral jsonb_each(
      coalesce(u.metrics -> 'pdf_counts', u.metrics -> 'pdfs_read', '{}'::jsonb)
    ) as e(key, value)
    where u.date >= (current_date - (greatest(coalesce(p_days, 7), 1) - 1))
  )
  select
    rid,
    bool_and(anon) as is_anon,
    coalesce(sum(reads), 0)::numeric as total_reads,
    coalesce(sum(read_sec), 0)::numeric as total_read_sec,
    count(distinct pdf)::bigint as unique_pdfs
  from src
  where rid is not null
  group by rid;
$$;

-- ---------------------------------------------------------------------------
-- 4. Index to keep both functions cheap as the table grows.
-- ---------------------------------------------------------------------------
create index if not exists user_daily_stats_date_idx
  on public.user_daily_stats (date desc);

-- ---------------------------------------------------------------------------
-- Verify after running:
--   select * from public.get_pdf_view_stats('verify doc alpha');
--   select * from public.get_leaderboard_rollup(7)
--     order by total_read_sec desc limit 10;
-- Expect one row from the first, and entries whose total_read_sec are sane
-- (the Worker discards rows above 16h/day as suspicious).
-- ---------------------------------------------------------------------------