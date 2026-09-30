import os from 'os';
import fs from 'fs';
import path from 'path';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { supabase } from '$lib/server/supabase.js';
import { getMongoDb } from './mongodb.js';
import { cachedResponse, isCacheableRequest } from './edge-cache.js';
import { logError, getErrorsLastHour } from './error-tracker.js';
import { sendIncidentEmail, sendAlertEmail, ALERT_EMAIL } from './mailer.js';
import { getBugReportTemplate, getAlertTemplate, escapeHtml } from './email-templates.js';
import { corsHeaders } from './cors-origins.js';

const OPENROUTER_API_KEY =
  env.OPENROUTER_API_KEY ||
  process.env.OPENROUTER_API_KEY ||
  env.NETLIFY_OPENROUTER_API_KEY ||
  process.env.NETLIFY_OPENROUTER_API_KEY;

const SUMMARY_MODELS = [
  'openai/gpt-oss-20b:free',
  'google/gemma-3-27b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
];

const INCIDENT_IO_SUMMARY_URL = 'https://statuspage.incident.io/materio/api/v1/summary';

const SPAM_CONFIG = {
  maxReportsPerIP: 10,
  ipWindowMinutes: 60,
  minDescriptionLength: 20,
  maxReportsPerSession: 6,
  sessionWindowMinutes: 30,
  duplicateWindowMinutes: 60,
  similarityThreshold: 0.8,
  bannedPatterns: [
    /(.)\1{10,}/,
    /^[a-z]{1,3}$/i,
    /https?:\/\/[^\s]+/gi,
    /buy|sell|cheap|discount|click here|subscribe|winner/gi,
  ],
};

const INCIDENT_AUTO_CONFIG = {
  clusterThreshold: 2,
  clusterWindowHours: 3,
  cooldownMinutes: 30,
};

let VERSION = '4.6.0.1';
try {
  const possiblePaths = [
    path.join(process.cwd(), 'assets/data/releases.json'),
    path.join(process.cwd(), '../assets/data/releases.json'),
    path.join(process.cwd(), 'static/assets/data/releases.json'),
    path.resolve('static/assets/data/releases.json'),
    path.resolve('assets/data/releases.json')
  ];
  for (const releasesPath of possiblePaths) {
    if (fs.existsSync(releasesPath)) {
      const releases = JSON.parse(fs.readFileSync(releasesPath, 'utf8'));
      if (releases && releases.length > 0) {
        VERSION = releases[0].version;
      }
      break;
    }
  }
} catch (err) {
  console.error('Failed to read releases.json:', err.message);
}

const BUILD_COMMIT = env.BUILD_COMMIT || process.env.BUILD_COMMIT || process.env.COMMIT_REF || 'Production';
const REGION = process.env.AWS_REGION || process.env.AWS_LAMBDA_FUNCTION_REGION || process.env.NETLIFY_REGION || 'unknown';

let BUILD_ID = 'unknown';
let BUILD_TIME = 'unknown';
try {
  const historyPaths = [
    path.join(process.cwd(), '_data/build_history.json'),
    path.join(process.cwd(), '../_data/build_history.json')
  ];
  for (const historyPath of historyPaths) {
    if (fs.existsSync(historyPath)) {
      const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      if (history && history.length > 0) {
        BUILD_ID = history[0].build_id;
        BUILD_TIME = history[0].timestamp;
      }
      break;
    }
  }
} catch (err) {
  console.error('Failed to read build_history.json:', err.message);
}

async function checkSupabase() {
  if (!supabase) return { status: 'skipped', message: 'Supabase not configured' };

  const startTime = Date.now();
  try {
    // Lightweight REST ping. The old auth.getSession() call can wedge
    // on edge runtimes (storage/lock backed); a plain fetch always
    // settles and proves the same thing for health purposes.
    // Auth service health endpoint (PostgREST root 401s on apikey-only
    // pings). Same proof of life, correct status code.
    const res = await boundedFetch(`${supabase.supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabase.supabaseKey }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    await res.arrayBuffer().catch(() => null);
    const latency = Date.now() - startTime;
    return { status: 'connected', latencyMs: latency };
  } catch (err) {
    const latency = Date.now() - startTime;
    logError('supabase', err.message);
    return { status: 'error', message: err.message, latencyMs: latency };
  }
}

// Bounded fetch helper: dependency checks must never hang the worker.
// A plain fetch without a signal can pend forever on the edge; the abort
// guarantees every check settles within a few seconds.
async function boundedFetch(url, { timeoutMs = 4000, ...init } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkCdnAPI() {
  const startTime = Date.now();
  try {
    const res = await boundedFetch('https://cdn.getmaterio.app/api/health', {
      method: 'GET',
      headers: { 'User-Agent': 'Materio-Health-Check' }
    });
    const latency = Date.now() - startTime;

    if (!res.ok) throw new Error(`Status ${res.status}`);
    await res.json().catch(() => ({}));

    return {
      status: 'ok',
      message: 'CDN is healthy',
      responseStatus: res.status,
      latencyMs: latency
    };
  } catch (err) {
    const latency = Date.now() - startTime;
    logError('cdn_api', err.message);
    return {
      status: 'error',
      message: err.message,
      latencyMs: latency
    };
  }
}

async function checkInternetConnection() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('https://www.google.com/favicon.ico', {
      method: 'HEAD',
      signal: controller.signal
    }).catch(() => null);
    clearTimeout(timeout);
    return !!res;
  } catch {
    return false;
  }
}

async function checkIncidentIO() {
  try {
    const res = await boundedFetch(INCIDENT_IO_SUMMARY_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });

    if (!res.ok) {
      return { hasIncident: false, incident: null };
    }

    const data = await res.json();
    const ongoingIncidents = data.ongoing_incidents || [];
    const inProgressMaintenances = data.in_progress_maintenances || [];

    if (ongoingIncidents.length > 0) {
      const incident = ongoingIncidents[0];
      return {
        hasIncident: true,
        incident: {
          id: incident.id,
          name: incident.name,
          impact: incident.current_worst_impact || 'partial_outage',
          status: incident.status,
          url: incident.url
        }
      };
    }

    if (inProgressMaintenances.length > 0) {
      const maintenance = inProgressMaintenances[0];
      return {
        hasIncident: true,
        incident: {
          id: maintenance.id,
          name: maintenance.name,
          impact: 'maintenance',
          status: 'in_progress',
          url: maintenance.url
        }
      };
    }

    return { hasIncident: false, incident: null };
  } catch {
    return { hasIncident: false, incident: null };
  }
}

function textSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

function containsSpamPatterns(text) {
  return SPAM_CONFIG.bannedPatterns.some((pattern) => pattern.test(text));
}

async function validateBugReport(report, clientIP, sessionId) {
  if (!report.title || report.title.trim().length < 5) {
    return { valid: false, reason: 'Bug title must be at least 5 characters' };
  }
  if (!report.description || report.description.trim().length < SPAM_CONFIG.minDescriptionLength) {
    return { valid: false, reason: `Description must be at least ${SPAM_CONFIG.minDescriptionLength} characters` };
  }
  if (!report.severity || !['critical', 'major', 'minor', 'cosmetic'].includes(report.severity)) {
    return { valid: false, reason: 'Invalid severity level' };
  }
  if (!report.affectedArea) {
    return { valid: false, reason: 'Affected area is required' };
  }

  const combinedText = `${report.title} ${report.description} ${report.stepsToReproduce || ''}`;
  if (containsSpamPatterns(combinedText)) {
    return { valid: false, reason: 'Report contains disallowed content' };
  }

  try {
    const db = await getMongoDb();
    const reportsCollection = db.collection('bug_reports');
    const now = new Date();

    const ipWindowStart = new Date(now.getTime() - SPAM_CONFIG.ipWindowMinutes * 60 * 1000);
    const recentByIP = await reportsCollection.countDocuments({
      'meta.ip': clientIP,
      reportedAt: { $gte: ipWindowStart }
    });
    if (recentByIP >= SPAM_CONFIG.maxReportsPerIP) {
      return { valid: false, reason: 'Too many reports from this network. Please try again later.' };
    }

    if (sessionId) {
      const sessionWindowStart = new Date(now.getTime() - SPAM_CONFIG.sessionWindowMinutes * 60 * 1000);
      const recentBySession = await reportsCollection.countDocuments({
        'meta.sessionId': sessionId,
        reportedAt: { $gte: sessionWindowStart }
      });
      if (recentBySession >= SPAM_CONFIG.maxReportsPerSession) {
        return { valid: false, reason: 'You have submitted too many reports recently. Please wait before submitting again.' };
      }
    }

    const dupWindowStart = new Date(now.getTime() - SPAM_CONFIG.duplicateWindowMinutes * 60 * 1000);
    const recentReports = await reportsCollection
      .find({ reportedAt: { $gte: dupWindowStart } }, { projection: { title: 1, description: 1 } })
      .sort({ reportedAt: -1 })
      .limit(50)
      .toArray();

    for (const existing of recentReports) {
      const titleSim = textSimilarity(report.title, existing.title || '');
      const descSim = textSimilarity(report.description, existing.description || '');
      if (titleSim >= SPAM_CONFIG.similarityThreshold && descSim >= SPAM_CONFIG.similarityThreshold) {
        return { valid: false, reason: 'A very similar report has already been submitted recently. Thank you!' };
      }
    }
  } catch (err) {
    console.error('Spam check MongoDB error (allowing report):', err.message);
  }

  return { valid: true };
}

async function generateAISummary(reports) {
  const reportLines = reports.map(
    (r) => `[${r.severity.toUpperCase()}] ${r.title} — ${r.affectedArea}: ${r.description.substring(0, 300)}`
  );

  const prompt = `Summarize this user incident cluster for a status page incident.

Include:
- Root symptom
- Affected system
- User impact
- Time pattern
- Confidence level

Reports:
${reportLines.join('\n')}

Respond in plain text only (no markdown, no bullet symbols, no asterisks). Keep it under 6 lines. Be concise and direct.`;

  if (!OPENROUTER_API_KEY) {
    return null;
  }

  for (const model of SUMMARY_MODELS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://materioa.vercel.app',
          'X-Title': 'Materio Incident Monitor'
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are a concise incident summarizer for a web application called Materio. Output plain text only. No markdown formatting, no bullet points, no asterisks.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 300
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) continue;

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text && text.length > 20) return text;
    } catch {
      continue;
    }
  }

  return null;
}

async function buildIncidentSummary(reports) {
  const areas = [...new Set(reports.map((r) => r.affectedArea))];
  const severities = reports.map((r) => r.severity);
  const worstSeverity = ['critical', 'major', 'minor', 'cosmetic'].find((s) => severities.includes(s)) || 'minor';
  const timestamps = reports.map((r) => new Date(r.reportedAt).toISOString());
  const timeRange = `${timestamps[0]} to ${timestamps[timestamps.length - 1]}`;
  const rootSymptom = reports[0].title;
  const confidence = reports.length >= 5 ? 'High' : reports.length >= 3 ? 'Medium' : 'Low';

  let summary = await generateAISummary(reports);

  if (!summary) {
    const affectedSystems = areas.join(', ');
    const userImpact =
      worstSeverity === 'critical'
        ? 'Users unable to use core functionality.'
        : worstSeverity === 'major'
          ? 'Significant feature degradation affecting user workflows.'
          : 'Minor inconvenience affecting some users.';

    const reportLines = reports.map(
      (r) => `[${r.severity.toUpperCase()}] ${r.title} — ${r.affectedArea}: ${r.description.substring(0, 200)}`
    );

    summary = [
      `Root Symptom: ${rootSymptom}`,
      `Affected System: ${affectedSystems}`,
      `User Impact: ${userImpact}`,
      `Time Pattern: ${reports.length} reports between ${timeRange}`,
      `Confidence Level: ${confidence}`,
      '',
      'Reports:',
      ...reportLines
    ].join('\n');
  }

  return {
    name: `[Auto] ${rootSymptom} (+${reports.length - 1} related)`,
    summary,
    severity: worstSeverity,
    affectedAreas: areas,
    reportCount: reports.length,
    aiGenerated: summary !== null
  };
}

async function checkAndCreateIncident() {
  try {
    const db = await getMongoDb();
    const reportsCollection = db.collection('bug_reports');
    const incidentsCollection = db.collection('auto_incidents');
    const now = new Date();

    const cooldownStart = new Date(now.getTime() - INCIDENT_AUTO_CONFIG.cooldownMinutes * 60 * 1000);
    const recentIncident = await incidentsCollection.findOne(
      { createdAt: { $gte: cooldownStart } },
      { sort: { createdAt: -1 } }
    );
    if (recentIncident) return null;

    const windowStart = new Date(now.getTime() - INCIDENT_AUTO_CONFIG.clusterWindowHours * 60 * 60 * 1000);
    const recentReports = await reportsCollection
      .find({
        reportedAt: { $gte: windowStart },
        status: { $ne: 'spam' },
        _incidentCreated: { $ne: true }
      })
      .sort({ reportedAt: 1 })
      .toArray();

    if (recentReports.length < INCIDENT_AUTO_CONFIG.clusterThreshold) return null;

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todaysReports = recentReports.filter((r) => new Date(r.reportedAt) >= todayStart);

    const cluster = todaysReports.length >= recentReports.length ? todaysReports : recentReports;
    const incidentData = await buildIncidentSummary(cluster);

    let emailResult = null;
    if (incidentData.severity !== 'cosmetic') {
      try {
        emailResult = await sendIncidentEmail(incidentData);
      } catch (err) {
        console.error('Failed to send incident email:', err.message);
      }
    }

    const incidentRecord = {
      createdAt: now,
      reportIds: cluster.map((r) => r._id),
      reportCount: cluster.length,
      name: incidentData.name,
      summary: incidentData.summary,
      severity: incidentData.severity,
      affectedAreas: incidentData.affectedAreas,
      aiGenerated: incidentData.aiGenerated || false,
      emailSent: emailResult
        ? {
            success: emailResult.success,
            messageId: emailResult.messageId || null,
            error: emailResult.error || null
          }
        : null
    };

    await incidentsCollection.insertOne(incidentRecord);
    await reportsCollection.updateMany(
      { _id: { $in: cluster.map((r) => r._id) } },
      { $set: { _incidentCreated: true, _incidentId: incidentRecord._id } }
    );

    return incidentRecord;
  } catch (err) {
    console.error('Incident automation error:', err.message);
    return null;
  }
}

async function handleBugReport(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body is required' }, { status: 400 });
  }

  const clientIP =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const sessionId = body.sessionId || null;

  const requiredFields = ['title', 'severity', 'description', 'affectedArea'];
  for (const field of requiredFields) {
    if (!body[field] || (typeof body[field] === 'string' && !body[field].trim())) {
      return json({ error: `${field} is required` }, { status: 400 });
    }
  }

  const report = {
    title: body.title.trim(),
    severity: body.severity,
    affectedArea: body.affectedArea,
    description: body.description.trim(),
    stepsToReproduce: body.stepsToReproduce ? body.stepsToReproduce.trim() : null,
    email: body.email || null,
    reportedAt: new Date(),
    status: 'open',
    meta: {
      ip: clientIP,
      userAgent: request.headers.get('user-agent') || 'unknown',
      referrer: request.headers.get('referer') || null,
      origin: request.headers.get('origin') || null,
      sessionId: sessionId,
      appVersion: VERSION
    },
    _incidentCreated: false,
    _incidentId: null
  };

  const validation = await validateBugReport(body, clientIP, sessionId);
  if (!validation.valid) {
    return json(
      {
        success: true,
        message: 'Bug report submitted successfully. Thank you for helping improve Materio!',
        reportId: 'filtered'
      },
      { status: 201 }
    );
  }

  try {
    const db = await getMongoDb();
    const reportsCollection = db.collection('bug_reports');
    const insertResult = await reportsCollection.insertOne(report);

    try {
      await checkAndCreateIncident();
    } catch (err) {
      console.error('Incident check failed (non-fatal):', err.message);
    }

    return json(
      {
        success: true,
        message: 'Bug report submitted successfully. Thank you for helping improve Materio!',
        reportId: insertResult.insertedId.toString()
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Bug report error:', error);
    logError('bug_report', error.message);

    if (body && body.title) {
      try {
        await sendAlertEmail({
          subject: `${body.severity === 'critical' ? '🔴' : '🟡'} Bug Report (Fallback): ${body.title}`,
          text: `[FALLBACK] MongoDB was unavailable.\nTitle: ${body.title}\nSeverity: ${body.severity}\nDescription: ${body.description}`,
          html: getBugReportTemplate(body, true)
        });
      } catch (mailError) {
        console.error('Fatal: Both MongoDB and Email fallback failed:', mailError.message);
      }
    }

    return json(
      {
        error: 'Failed to submit bug report. Please try again later.',
        details: error.message
      },
      { status: 500 }
    );
  }
}

async function handleAlertEmailRequest(request) {
  const alertSecret = env.ALERT_SECRET || process.env.ALERT_SECRET || '';
  if (alertSecret) {
    const provided = request.headers.get('x-alert-key') || '';
    if (provided !== alertSecret) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Required fields: subject, message' }, { status: 400 });
  }

  if (!body || !body.subject || !body.message) {
    return json({ error: 'Required fields: subject, message' }, { status: 400 });
  }

  const severity = body.severity || 'minor';
  const subject = `[Materio Alert] ${body.subject}`;
  const text = `[${severity.toUpperCase()}] ${body.subject}\n\n${body.message}`;
  const html = getAlertTemplate(body.subject, body.message, severity);

  const result = await sendAlertEmail({
    to: body.to || ALERT_EMAIL,
    subject,
    text,
    html
  });

  if (result.success) {
    return json({ success: true, messageId: result.messageId });
  } else {
    return json({ success: false, error: result.error }, { status: 500 });
  }
}

function handleTestIncidentEmailPreview() {
  const LOGO_URL = 'https://materioa.vercel.app/assets/img/materio.png';
  const sampleIncident = {
    name: '[Auto] PDF loading failures in Chrome (+3 related)',
    summary: `Users are reporting issues with testing and verification processes.
Affected systems include general application functionality, TLS, performance, and the mailer service.
Impact: Users are unable to reliably report bugs or confirm fixes, and may not receive alert emails.
Reports began increasing around 14:00 UTC and continue with intermittent frequency.
Confidence: Medium.`,
    severity: 'major',
    affectedAreas: ['Document Viewer', 'PDF Processing'],
    reportCount: 4,
    aiGenerated: true
  };

  const { name, summary, severity, affectedAreas, reportCount } = sampleIncident;

  const SEVERITY_COLORS = {
    critical: '#DC2626',
    major: '#EA580C',
    minor: '#CA8A04',
    cosmetic: '#6B7280'
  };

  const SEVERITY_HEADER_BG = {
    critical: 'rgba(220, 38, 38, 0.15)',
    major: 'rgba(234, 88, 12, 0.15)',
    minor: 'rgba(202, 138, 4, 0.15)',
    cosmetic: 'rgba(107, 114, 128, 0.15)'
  };

  const color = SEVERITY_COLORS[severity] || '#6B7280';
  const headerBg = SEVERITY_HEADER_BG[severity] || 'rgba(107, 114, 128, 0.15)';
  const formattedDate =
    new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) + ' IST';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body { margin: 0; padding: 20px; background: #ffffff; font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }</style></head>
<body>
  <div style="max-width:600px;margin:24px auto;">
    <div style="margin-bottom:24px;"><img src="${LOGO_URL}" alt="materio." width="180" height="38" style="display:block;" /></div>
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;padding:24px;">
      <div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="background:${headerBg};padding:16px 20px;">
          <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;line-height:1.4;color:#1f2937;">${escapeHtml(name.replace(/\[Auto\] /, ''))}</h2>
          <div style="font-size:13px;"><span style="color:${color};font-weight:600;">Incident created</span><span style="color:#6b7280;margin-left:12px;">Started ${formattedDate}</span></div>
        </div>
        <div style="padding:16px 20px;font-size:14px;line-height:1.8;color:#1f2937;background:#fff;">
          <div><strong>Severity</strong> : <span style="color:${color};font-weight:600;">${severity.charAt(0).toUpperCase() + severity.slice(1)}</span></div>
          <div><strong>Affected Areas:</strong> ${escapeHtml(affectedAreas.join(', '))}</div>
          <div><strong>Reports:</strong> ${reportCount} clustered reports</div>
        </div>
      </div>
      <div style="background:#fafafa;padding:16px 20px;margin-bottom:24px;border-radius:12px;border:1px solid #e5e7eb;">
        <h3 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1f2937;">Summary</h3>
        <div style="font-size:13px;line-height:1.7;color:#4b5563;">${escapeHtml(summary).replace(/\n/g, '<br>')}</div>
      </div>
      <div style="text-align:center;font-size:12px;color:#9ca3af;">This incident is auto generated by Materio's incident reporting system.</div>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// Short-lived, isolate-level dependency snapshot (see call site for why).
const DEPS_TTL_MS = 30000;
let depsCache = null;
let depsInFlight = null;

async function getDependencyStatus() {
  const now = Date.now();
  if (depsCache && now - depsCache.at < DEPS_TTL_MS) return depsCache.value;
  if (depsInFlight) return depsInFlight;

  depsInFlight = (async () => {
    const checkTimeout = (p, fallback) =>
      Promise.race([
        p,
        new Promise((resolve) => setTimeout(() => resolve(fallback), 8000))
      ]);
    const [supabaseStatus, cdnStatus, incidentStatus] = await Promise.all([
      checkTimeout(checkSupabase(), { status: 'error', message: 'check timed out' }),
      checkTimeout(checkCdnAPI(), { status: 'error', message: 'check timed out' }),
      checkTimeout(checkIncidentIO(), { hasIncident: false, incident: null })
    ]);
    const value = { supabase: supabaseStatus, cdn: cdnStatus, incident: incidentStatus };
    depsCache = { at: Date.now(), value };
    return value;
  })().finally(() => {
    depsInFlight = null;
  });

  return depsInFlight;
}

function resolveHealthAction(url, params) {
  const sub = params?.path || url.searchParams.get('path') || '';
  const action = url.searchParams.get('action') || '';
  const pathname = url.pathname;

  if (sub.includes('report') || pathname.includes('/report') || action === 'report') return 'report';
  if (sub.includes('alert') || pathname.includes('/alert') || action === 'alert') return 'alert';
  if (sub.includes('test-incident-email') || pathname.includes('/test-incident-email') || action === 'test-incident-email') return 'test-incident-email';
  return '';
}

export async function handleHealthGet({ request, url, params }) {
  try {
  const action = resolveHealthAction(url, params);

  if (action === 'test-incident-email') {
    return handleTestIncidentEmailPreview();
  }

  if (action !== '') {
    return json({ error: 'Method not allowed for this action' }, { status: 405 });
  }

  const requestStartTime = Date.now();
  // os/process are unavailable on some edge runtimes — degrade to
  // placeholders instead of throwing (which SvelteKit turns into a 500).
  let memoryUsage = { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 };
  let cpuLoad = [0, 0, 0];
  let uptime = 0;
  try { memoryUsage = process.memoryUsage(); } catch {}
  try { cpuLoad = os.loadavg(); } catch {}
  try { uptime = process.uptime(); } catch {}

  // Dependency results are reused for a short window per isolate. Health is
  // polled constantly (every page load, plus cache-busted repeats), and each
  // uncached run made THREE outbound fetches plus a Mongo round-trip. A
  // burst of parallel polls therefore multiplied past Cloudflare's ceiling of
  // 6 simultaneous outbound connections, starving fetches so they never
  // settled ("Promise will never complete"). Dependency reachability does not
  // change second to second, so a short TTL keeps the signal and removes the
  // connection pressure. The in-flight promise is shared so concurrent polls
  // still collapse onto a single round of checks.
  const deps = await getDependencyStatus();
  const { supabase: supabaseStatus, cdn: cdnStatus, incident: incidentStatus } = deps;
  if (supabaseStatus.status === 'error' || cdnStatus.status === 'error') {
    try { console.warn(`[health] failing deps: supabase=${supabaseStatus.status}(${supabaseStatus.latencyMs}ms:${supabaseStatus.message || ''}) cdn=${cdnStatus.status}(${cdnStatus.latencyMs}ms:${cdnStatus.message || ''})`); } catch {}
  }

  // Version comes from the bundled release snapshot, NOT a live Mongo read.
  // That lookup was the last thing making health slow: every poll waited up
  // to 3s for a connect+find, and a timeout there also reset the shared pool,
  // which disrupted unrelated in-flight requests. The reported version is a
  // build-time fact (refreshed by the snapshot cron + each deploy), so paying
  // a database round-trip on a status endpoint bought nothing.
  const version = VERSION;

  let nodeVersion = 'unknown';
  let platform = 'unknown';
  let totalMem = 0;
  let freeMem = 0;
  let cpuCount = 0;
  try { nodeVersion = process.version || 'unknown'; } catch {}
  try { platform = os.platform(); } catch {}
  try { totalMem = os.totalmem(); } catch {}
  try { freeMem = os.freemem(); } catch {}
  try { cpuCount = os.cpus().length; } catch {}

  const build = {
    version: version,
    enviroment: BUILD_COMMIT,
    builtAt: BUILD_TIME,
    buildId: BUILD_ID,
    region: REGION,
    nodeVersion,
    platform
  };

  const system = {
    uptimeSeconds: uptime,
    cpuLoad,
    memory: {
      rss: memoryUsage.rss,
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      external: memoryUsage.external
    },
    totalMem,
    freeMem,
    cpus: cpuCount
  };

  const dependencies = {
    supabase: supabaseStatus,
    cdn: cdnStatus
  };

  const dependencyLatencies = [supabaseStatus.latencyMs, cdnStatus.latencyMs].filter(
    (lat) => lat !== undefined
  );

  const overallLatency = {
    averageMs:
      dependencyLatencies.length > 0
        ? Math.round(dependencyLatencies.reduce((a, b) => a + b, 0) / dependencyLatencies.length)
        : 0,
    maxMs: dependencyLatencies.length > 0 ? Math.max(...dependencyLatencies) : 0,
    minMs: dependencyLatencies.length > 0 ? Math.min(...dependencyLatencies) : 0
  };

  const healthy =
    supabaseStatus.status === 'connected' &&
    cdnStatus.status === 'ok' &&
    !incidentStatus.hasIncident;

  let status = healthy ? 'ok' : 'degraded';
  let message = healthy
    ? 'All systems operational'
    : incidentStatus.hasIncident
      ? incidentStatus.incident.name || 'System incident reported'
      : 'Some dependencies are unavailable';

  if (!healthy && (supabaseStatus.status === 'error' || cdnStatus.status === 'error')) {
    const isOnline = await checkInternetConnection();
    if (!isOnline) {
      status = 'offline';
      message = 'Please check your internet connection';
    }
  }

  const responseTime = Date.now() - requestStartTime;

  const response = {
    status,
    message,
    timestamp: new Date().toISOString(),
    service: 'materio-core',
    responseTimeMs: responseTime,
    incident: incidentStatus.incident,
    summary: {
      uptime: `${Math.floor(uptime)}s`,
      dependenciesHealthy: healthy,
      errorsLastHour: getErrorsLastHour(),
      latency: overallLatency,
      hasActiveIncident: incidentStatus.hasIncident
    },
    build,
    system,
    dependencies
  };

  // Health is a status signal, not an error: always answer 200 so polling
  // clients (and the console) don't log failures for "degraded". The
  // `status` field carries ok/degraded/offline. Never throw (no 500s).
  // Polled constantly (with ?t= busters) — serve repeats from the edge.
  if (request && isCacheableRequest(request, url)) {
    return cachedResponse(request, 30, async () =>
      json(response, { status: 200 })
    );
  }
  return json(response, { status: 200 });
  } catch (err) {
    console.error('Health handler fatal (never 500):', err?.message || err);
    return json(
      {
        status: 'degraded',
        message: 'Health check temporarily unavailable',
        timestamp: new Date().toISOString(),
        service: 'materio-core'
      },
      { status: 200 }
    );
  }
}

export async function handleHealthPost({ request, url, params }) {
  const action = resolveHealthAction(url, params);

  if (action === 'report') {
    return handleBugReport(request);
  }

  if (action === 'alert') {
    return handleAlertEmailRequest(request);
  }

  return json(
    {
      error: 'Method not allowed',
      debug: { action, method: 'POST' }
    },
    { status: 405 }
  );
}

export function handleHealthOptions({ request }) {
  const origin = request.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin)
  });
}
