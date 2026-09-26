import { json } from '@sveltejs/kit';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Octokit } from '@octokit/rest';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { env } from '$env/dynamic/private';
import { supabase, supabaseAdmin, verifyToken } from '$lib/server/supabase.js';
import { corsHeaders, isAllowedOrigin } from '$lib/server/cors-origins.js';
import { getFormsCollection, getFormConfigsCollection, getMongoDb, resetMongoDb } from '$lib/server/mongodb.js';
import { sendAlertEmail, ALERT_EMAIL } from '$lib/server/mailer.js';
import {
  isWebPushConfigured,
  getVapidPublicKey,
  upsertWebPushSubscription,
  removeWebPushSubscription
} from '$lib/server/webpush.js';
import { getContributionNotificationTemplate } from '$lib/server/email-templates.js';

// ==========================================
// Google Drive Configuration
// ==========================================
const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI =
  env.GOOGLE_REDIRECT_URI ||
  process.env.GOOGLE_REDIRECT_URI ||
  'https://materioa.vercel.app/account/profile.html';

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

const drive = google.drive({ version: 'v3', auth: oauth2Client });

// ==========================================
// Google Analytics Configuration
// ==========================================
function getAnalyticsDataClient() {
  const base64Key = env.GA_SERVICE_ACCOUNT_KEY_BASE64 || process.env.GA_SERVICE_ACCOUNT_KEY_BASE64;
  if (!base64Key) return null;

  const credentials = JSON.parse(Buffer.from(base64Key, 'base64').toString());
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly']
  });
  return google.analyticsdata({ version: 'v1beta', auth });
}

// ==========================================
// Razorpay Configuration
// ==========================================
const RAZORPAY_KEY_ID = env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;

const razorpay = RAZORPAY_KEY_ID
  ? new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET
    })
  : null;

// ==========================================
// Helper Utilities
// ==========================================
function getTokenFromHeaders(headers) {
  const authHeader = headers.get('authorization') || headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  const cookieHeader = headers.get('cookie') || headers.get('Cookie');
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map((c) => {
        const [k, ...v] = c.trim().split('=');
        return [k, decodeURIComponent(v.join('='))];
      })
    );
    return cookies['sb-access-token'] || cookies['sb-refresh-token'] || cookies['materio_auth_token'];
  }
  return null;
}

function getLocalDataFile(filename) {
  const candidates = [
    path.join(process.cwd(), 'static', 'assets', 'data', filename),
    path.join(process.cwd(), 'assets', 'data', filename),
    path.join(process.cwd(), '..', 'assets', 'data', filename),
    path.join(process.cwd(), '..', 'svelte', 'static', 'assets', 'data', filename),
    path.resolve('static/assets/data/' + filename),
    path.resolve('assets/data/' + filename),
    path.join(process.cwd(), filename),
    path.join(process.cwd(), '..', filename)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {}
    }
  }
  return null;
}

const parseBuildDate = (dateStr) => {
  if (!dateStr) return new Date(0);
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(dateStr);
};

async function checkAdminUser(request, url) {
  const token =
    getTokenFromHeaders(request.headers) || url?.searchParams?.get('token');
  if (!token) return false;
  const decoded = verifyToken(token);
  if (!decoded) return false;

  const userId = decoded.id || decoded.sub;
  if (!userId) return false;

  const client = supabaseAdmin || supabase;
  const { data: user, error: userError } = await client
    .from('users')
    .select('id, has_admin_privileges')
    .eq('id', userId)
    .single();

  if (userError || !user) return false;
  return user.has_admin_privileges === true;
}

// ==========================================
// 1. Insights Feature (GA Realtime Users)
// ==========================================
async function handleInsights(url) {
  let analyticsDataClient;
  try {
    analyticsDataClient = getAnalyticsDataClient();
  } catch (err) {
    console.error('Invalid GA_SERVICE_ACCOUNT_KEY_BASE64:', err.message);
    return json({ error: 'Analytics not configured' }, { status: 500 });
  }
  if (!analyticsDataClient) {
    console.error('GA_SERVICE_ACCOUNT_KEY_BASE64 not configured');
    return json({ error: 'Analytics not configured' }, { status: 500 });
  }

  try {
    const propertyId = env.GA4_PROPERTY_ID || process.env.GA4_PROPERTY_ID;
    const response = await analyticsDataClient.properties.runRealtimeReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [{ name: 'activeUsers' }]
      }
    });

    const users = response.data?.rows?.[0]?.metricValues?.[0]?.value || '0';
    return json({ users }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('Error fetching real-time users:', error);
    return json({ error: error.message }, { status: 500 });
  }
}

// ==========================================
// 2. Notifications Feed Feature (Merged MongoDB + JSON)
// ==========================================
async function fetchJsonNotifications() {
  const useLocalResources =
    (env.USE_LOCAL_RESOURCES || process.env.USE_LOCAL_RESOURCES) === 'true';
  const sources = [
    ...(useLocalResources ? ['http://localhost:8080/notifications.json'] : []),
    'https://cdn.getmaterio.app/notifications.json',
    'https://cdn-materioa.netlify.app/notifications.json'
  ];

  for (const source of sources) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(`${source}?t=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) continue;

      const payload = await response.json();
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.notifications)
          ? payload.notifications
          : [];

      if (list.length > 0) {
        return list;
      }
    } catch {}
  }

  const fallback = getLocalDataFile('notifications.json');
  if (Array.isArray(fallback)) return fallback;
  if (Array.isArray(fallback?.notifications)) return fallback.notifications;
  return [];
}

async function getMergedNotifications() {
  let mongoItems = [];
  try {
    const db = await getMongoDb();
    const notificationsCollection = db.collection('notifications');
    mongoItems = await notificationsCollection
      .find({})
      .sort({ timestamp: -1, date: -1, _id: -1 })
      .toArray();
  } catch (err) {
    console.warn('Could not read notifications from MongoDB:', err.message);
  }

  let jsonItems = [];
  try {
    jsonItems = await fetchJsonNotifications();
  } catch (err) {
    console.warn('Could not read notifications from JSON sources:', err.message);
  }

  const normalize = (n, defaultSource) => {
    if (!n || typeof n !== 'object') return null;
    const title = String(n.title || '').trim();
    const message = String(n.message || n.body || '').trim();
    if (!title && !message) return null;

    let links = [];
    if (Array.isArray(n.links)) links = n.links;
    else if (n.link) links = [{ text: 'View', url: n.link }];

    return {
      _id: n._id ? String(n._id) : undefined,
      id: n.id || (n._id ? String(n._id) : undefined),
      title: title || 'Notification',
      message: message,
      body: message,
      category: n.category ? String(n.category).trim() : 'General',
      link: n.link || (links[0]?.url) || '',
      links: links,
      date: n.date || n.timestamp || n.created_at || new Date().toISOString(),
      timestamp: n.timestamp || n.created_at || n.date || new Date().toISOString(),
      source: n.source || defaultSource
    };
  };

  const seen = new Set();
  const merged = [];

  // 1. Add MongoDB items first
  for (const item of mongoItems) {
    const norm = normalize(item, 'mongodb');
    if (!norm) continue;
    const key = `${norm.title.toLowerCase()}::${norm.message.slice(0, 40).toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(norm);
    }
  }

  // 2. Add JSON items alongside MongoDB items
  for (const item of jsonItems) {
    const norm = normalize(item, 'json');
    if (!norm) continue;
    const key = `${norm.title.toLowerCase()}::${norm.message.slice(0, 40).toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(norm);
    }
  }

  // 3. Sort by date / timestamp descending
  merged.sort((a, b) => new Date(b.date || b.timestamp || 0) - new Date(a.date || a.timestamp || 0));

  return merged;
}

async function handleNotificationsFeed(url) {
  const limitParam = Number(url.searchParams.get('num'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : 6;
  const merged = await getMergedNotifications();
  return json(merged.slice(0, limit), { headers: { 'Cache-Control': 'no-store' } });
}

// ==========================================
// 3. Save Promo Feature
// ==========================================
async function handleSavePromo(request) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const promoData = await request.json();
    const promoFilePath = path.join(process.cwd(), 'promo.json');

    try {
      fs.writeFileSync(promoFilePath, JSON.stringify(promoData, null, 2));
    } catch (writeErr) {
      console.warn('Could not write promo.json to disk:', writeErr.message);
    }

    try {
      const db = await getMongoDb();
      const promoCollection = db.collection('promotions');
      await promoCollection.replaceOne({ type: 'active_promo' }, promoData, { upsert: true });
    } catch (e) {
      console.warn('MongoDB promo save error:', e.message);
    }

    return json({ success: true, message: 'Promotion saved successfully' });
  } catch (error) {
    return json({ error: 'Failed to save promotion', details: error.message }, { status: 500 });
  }
}

// ==========================================
// 4. Google Drive Helpers & Feature Handler
// ==========================================
const getUserFromToken = async (token) => {
  const decoded = verifyToken(token);
  if (!decoded) return null;
  const client = supabaseAdmin || supabase;
  const { data: user } = await client
    .from('users')
    .select('*')
    .eq('id', decoded.id || decoded.sub)
    .single();
  return user;
};

const storeGoogleTokens = async (userId, tokens) => {
  const client = supabaseAdmin || supabase;
  const { error } = await client.from('google_drive_tokens').upsert({
    user_id: userId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000),
    updated_at: new Date()
  });
  return !error;
};

const getGoogleTokens = async (userId) => {
  const client = supabaseAdmin || supabase;
  const { data: tokens } = await client
    .from('google_drive_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();
  return tokens;
};

const refreshTokensIfNeeded = async (userId, tokens) => {
  if (new Date() < new Date(tokens.expires_at)) {
    return tokens;
  }
  oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await storeGoogleTokens(userId, credentials);
    return await getGoogleTokens(userId);
  } catch (error) {
    console.error('Error refreshing tokens:', error);
    return null;
  }
};

const findOrCreateMaterioFolder = async () => {
  try {
    const response = await drive.files.list({
      q: "name='materio' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id, name)'
    });
    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id;
    }
    const folderResponse = await drive.files.create({
      requestBody: {
        name: 'materio',
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });
    return folderResponse.data.id;
  } catch (error) {
    console.error('Error finding/creating materio folder:', error);
    throw error;
  }
};

async function handleGoogleDrive(request, url) {
  const token = getTokenFromHeaders(request.headers);
  if (!token) {
    return json({ error: 'No token provided' }, { status: 401 });
  }
  const user = await getUserFromToken(token);
  if (!user) {
    return json({ error: 'Invalid token' }, { status: 401 });
  }

  let endpoint = '';
  const pathParts = url.pathname.split('/');
  const driveIndex = pathParts.indexOf('google-drive');
  if (driveIndex !== -1 && driveIndex < pathParts.length - 1) {
    endpoint = pathParts[driveIndex + 1];
  } else {
    endpoint = url.searchParams.get('subAction') || url.searchParams.get('endpoint') || '';
  }

  if (url.pathname.includes('/delete/')) {
    endpoint = 'delete';
  }

  const method = request.method;

  switch (method) {
    case 'GET':
      if (endpoint === 'auth-url') {
        const scopes = [
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/userinfo.profile'
        ];
        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: scopes,
          state: user.id
        });
        return json({ authUrl });
      }

      if (endpoint === 'status') {
        const tokens = await getGoogleTokens(user.id);
        const linked = !!tokens;
        let materioFolderId = null;
        if (linked && tokens.access_token) {
          try {
            oauth2Client.setCredentials({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token
            });
            materioFolderId = await findOrCreateMaterioFolder();
          } catch (error) {
            console.error('Error checking materio folder:', error);
          }
        }
        return json({ linked, materioFolderId });
      }

      if (endpoint === 'files') {
        const tokens = await getGoogleTokens(user.id);
        if (!tokens) return json({ error: 'Google Drive not linked' }, { status: 400 });
        const refreshedTokens = await refreshTokensIfNeeded(user.id, tokens);
        if (!refreshedTokens) return json({ error: 'Failed to refresh tokens' }, { status: 400 });

        oauth2Client.setCredentials({
          access_token: refreshedTokens.access_token,
          refresh_token: refreshedTokens.refresh_token
        });

        try {
          const folderId = url.searchParams.get('folderId');
          let query = 'trashed=false';
          if (folderId) {
            query += ` and '${folderId}' in parents`;
          } else {
            const materioFolderId = await findOrCreateMaterioFolder();
            query += ` and '${materioFolderId}' in parents`;
          }

          const response = await drive.files.list({
            pageSize: 50,
            fields:
              'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, thumbnailLink)',
            q: query
          });
          return json({ files: response.data.files });
        } catch (error) {
          console.error('Error listing files:', error);
          return json({ error: 'Failed to list files' }, { status: 500 });
        }
      }
      break;

    case 'POST':
      let body = {};
      try {
        body = await request.json();
      } catch {}

      if (endpoint === 'callback') {
        const { code, state } = body;
        if (state !== user.id) {
          return json({ error: 'Invalid state parameter' }, { status: 400 });
        }
        try {
          const { tokens } = await oauth2Client.getToken(code);
          await storeGoogleTokens(user.id, tokens);
          return json({ success: true });
        } catch (error) {
          console.error('Error exchanging code for tokens:', error);
          return json({ error: 'Failed to exchange code for tokens' }, { status: 400 });
        }
      }

      if (endpoint === 'ensure-folder') {
        const tokens = await getGoogleTokens(user.id);
        if (!tokens) return json({ error: 'Google Drive not linked' }, { status: 400 });
        const refreshedTokens = await refreshTokensIfNeeded(user.id, tokens);
        if (!refreshedTokens) return json({ error: 'Failed to refresh tokens' }, { status: 400 });

        oauth2Client.setCredentials({
          access_token: refreshedTokens.access_token,
          refresh_token: refreshedTokens.refresh_token
        });

        try {
          const folderId = await findOrCreateMaterioFolder();
          return json({ folderId });
        } catch (error) {
          return json({ error: 'Failed to ensure materio folder' }, { status: 500 });
        }
      }

      if (endpoint === 'upload') {
        const tokens = await getGoogleTokens(user.id);
        if (!tokens) return json({ error: 'Google Drive not linked' }, { status: 400 });
        const refreshedTokens = await refreshTokensIfNeeded(user.id, tokens);
        if (!refreshedTokens) return json({ error: 'Failed to refresh tokens' }, { status: 400 });

        oauth2Client.setCredentials({
          access_token: refreshedTokens.access_token,
          refresh_token: refreshedTokens.refresh_token
        });

        const { fileName, fileContent, mimeType, folderId } = body;
        try {
          const targetFolderId = folderId || (await findOrCreateMaterioFolder());
          const response = await drive.files.create({
            requestBody: {
              name: fileName,
              parents: [targetFolderId]
            },
            media: {
              mimeType: mimeType,
              body: Buffer.from(fileContent, 'base64')
            }
          });

          return json({
            success: true,
            fileId: response.data.id,
            fileName: response.data.name
          });
        } catch (error) {
          return json({ error: 'Failed to upload file' }, { status: 500 });
        }
      }
      break;

    case 'DELETE':
      if (endpoint === 'unlink') {
        try {
          const client = supabaseAdmin || supabase;
          const { error } = await client
            .from('google_drive_tokens')
            .delete()
            .eq('user_id', user.id);
          if (error) throw error;
          return json({ success: true });
        } catch (error) {
          return json({ error: 'Failed to unlink Google Drive' }, { status: 500 });
        }
      }

      const deleteMatch = url.pathname.match(/\/delete\/(.+)$/);
      if (deleteMatch) {
        const fileId = deleteMatch[1];
        const tokens = await getGoogleTokens(user.id);
        if (!tokens) return json({ error: 'Google Drive not linked' }, { status: 400 });
        const refreshedTokens = await refreshTokensIfNeeded(user.id, tokens);
        if (!refreshedTokens) return json({ error: 'Failed to refresh tokens' }, { status: 400 });

        oauth2Client.setCredentials({
          access_token: refreshedTokens.access_token,
          refresh_token: refreshedTokens.refresh_token
        });

        try {
          await drive.files.delete({ fileId });
          return json({ success: true });
        } catch (error) {
          return json({ error: 'Failed to delete file' }, { status: 500 });
        }
      }
      break;

    default:
      return json({ error: 'Method not allowed' }, { status: 405 });
  }

  return json({ error: 'Endpoint not found' }, { status: 404 });
}

// ==========================================
// 5. Sharelink Feature
// ==========================================
async function handleSharelink(request, url) {
  const token = getTokenFromHeaders(request.headers);
  if (!token) return json({ error: 'Authentication required' }, { status: 401 });
  const decoded = verifyToken(token);
  if (!decoded) return json({ error: 'Invalid or expired token' }, { status: 401 });

  const client = supabaseAdmin || supabase;
  const { data: user, error: userError } = await client
    .from('users')
    .select('id')
    .eq('id', decoded.id || decoded.sub)
    .single();

  if (userError || !user) return json({ error: 'User not found' }, { status: 401 });

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const bodyData = await request.json();
    const inviteCode = bodyData.inviteCode;
    const customHeading = bodyData.customHeading;

    if (!inviteCode) {
      return json({ error: 'Invite code is required' }, { status: 400 });
    }

    const { data: invite, error: inviteError } = await client
      .from('invites')
      .select('id, code, created_by, contains_plus_perks')
      .eq('code', inviteCode)
      .eq('created_by', user.id)
      .single();

    if (inviteError || !invite) {
      return json({ error: 'Invite not found or not owned by you' }, { status: 404 });
    }

    let { data: sharelink, error: sharelinkError } = await client
      .from('sharelinks')
      .upsert(
        {
          invite_code: inviteCode,
          custom_heading: customHeading || null,
          created_by: user.id,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'invite_code' }
      )
      .select()
      .single();

    if (sharelinkError && sharelinkError.message?.includes('row-level security')) {
      try {
        const timestamp = new Date().toISOString();
        const sql = `
          INSERT INTO sharelinks (invite_code, custom_heading, created_by, updated_at)
          VALUES ('${inviteCode}', ${customHeading ? `'${customHeading.replace(/'/g, "''")}'` : 'NULL'}, '${user.id}', '${timestamp}')
          ON CONFLICT (invite_code)
          DO UPDATE SET
            custom_heading = ${customHeading ? `'${customHeading.replace(/'/g, "''")}'` : 'NULL'},
            updated_at = '${timestamp}'
          RETURNING *;
        `;
        const { data, error } = await client.rpc('execute_sql', { sql_command: sql });
        if (!error && data) {
          const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
          sharelink = parsedData && parsedData.length > 0 ? parsedData[0] : null;
          sharelinkError = null;
        }
      } catch {}
    }

    const origin = request.headers.get('origin') || '';
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
    const baseUrl = isLocalhost ? origin : 'https://materioa.vercel.app';

    if (!sharelink) {
      return json({
        message: 'Sharelink created (DB update may have succeeded without returning data)',
        url: `${baseUrl}/invites/${inviteCode}`,
        inviteCode,
        customHeading
      });
    }

    return json({
      message: 'Sharelink created successfully',
      sharelink: {
        inviteCode: sharelink.invite_code,
        customHeading: sharelink.custom_heading,
        url: `${baseUrl}/invites/${sharelink.invite_code}`,
        createdAt: sharelink.created_at,
        updatedAt: sharelink.updated_at
      }
    });
  } catch (error) {
    return json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

// ==========================================
// 6. Forms Feature (CRUD)
// ==========================================
async function handleForms(request, url) {
  const method = request.method;
  const pathParam = url.searchParams.get('path') || '';
  const pathParts = (pathParam || url.pathname).split('/').filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1];

  try {
    if (method === 'GET' && lastPart === 'popups') {
      // Published pop-up wizard configs from MongoDB (managed in the admin panel),
      // plus the auto-show rules doc. The modal merges popups over the local
      // forms-config.json fallback; the auto-show engine evaluates the rules.
      try {
        const collection = await getFormConfigsCollection();
        const docs = await collection.find({ published: true, kind: { $in: ['popup', 'wizard', 'form'] } }).sort({ updatedAt: -1 }).toArray();
        let activity = null;
        try {
          activity = await collection.db.collection('form_activity').findOne({});
          if (activity) {
            const { _id, ...rest } = activity;
            activity = rest;
          }
        } catch {}
        // Forms this signed-in visitor already answered (for "once" schedules).
        let doneIds = [];
        const visitorId = url.searchParams.get('userId');
        if (visitorId) {
          try {
            const [runs, subs] = await Promise.all([
              collection.db.collection('form_responses').distinct('formId', { userId: visitorId }),
              collection.db.collection('form_submissions').distinct('formType', { 'user.userId': visitorId })
            ]);
            doneIds = [...new Set([...(runs || []), ...(subs || [])])];
          } catch {}
        }
        return json({ popups: docs.map(({ _id, ...rest }) => rest), activity, doneIds });
      } catch (error) {
        console.error('Popup configs lookup failed:', error);
        return json({ popups: [], activity: null, doneIds: [] });
      }
    }

    if (method === 'GET' && lastPart === 'config') {
      const config = getLocalDataFile('forms-config.json');
      if (config) return json(config);
      return json({ message: 'Forms config available at /assets/data/forms-config.json' });
    }

    switch (method) {
      case 'POST': {
        const body = await request.json();
        const { formType, user, data, confirmations } = body;
        if (!formType || !data) {
          return json({ error: 'formType and data are required' }, { status: 400 });
        }

        let authenticatedUser = null;
        const token = getTokenFromHeaders(request.headers);
        if (token) authenticatedUser = verifyToken(token);

        const submission = {
          formType,
          submittedAt: new Date(),
          user: {
            type: user?.type || 'anonymous',
            userId: authenticatedUser?.id || null,
            email: authenticatedUser?.email || user?.email || null,
            githubUsername: user?.githubUsername || null,
            displayName: authenticatedUser?.username || user?.displayName || null
          },
          data,
          confirmations: confirmations || {},
          meta: {
            ip: request.headers.get('x-forwarded-for') || 'unknown',
            userAgent: request.headers.get('user-agent') || 'unknown',
            referrer: request.headers.get('referer') || null,
            submittedFrom: request.headers.get('origin') || null
          },
          status: 'pending',
          reviewedBy: null,
          reviewedAt: null
        };

        try {
          const collection = await getFormsCollection();
          await collection.insertOne(submission);
        } catch (e) {
          console.warn('Background form save failed:', e.message);
        }

        return json(
          { success: true, message: 'Form submitted successfully', submissionId: 'pending' },
          { status: 201 }
        );
      }

      case 'GET': {
        const token = getTokenFromHeaders(request.headers);
        if (!token) return json({ error: 'Authentication required' }, { status: 401 });
        const user = verifyToken(token);
        if (!user) return json({ error: 'Invalid token' }, { status: 401 });

        const collection = await getFormsCollection();
        if (lastPart && lastPart !== 'forms' && ObjectId.isValid(lastPart)) {
          const submission = await collection.findOne({ _id: new ObjectId(lastPart) });
          if (!submission) return json({ error: 'Submission not found' }, { status: 404 });
          return json(submission);
        }

        const formType = url.searchParams.get('type');
        const status = url.searchParams.get('status');
        const limit = parseInt(url.searchParams.get('limit') || '50') || 50;
        const skip = parseInt(url.searchParams.get('skip') || '0') || 0;

        const filter = {};
        if (formType) filter.formType = formType;
        if (status) filter.status = status;

        const [submissions, total] = await Promise.all([
          collection.find(filter).sort({ submittedAt: -1 }).skip(skip).limit(limit).toArray(),
          collection.countDocuments(filter)
        ]);

        return json({
          submissions,
          pagination: { total, limit, skip, hasMore: skip + submissions.length < total }
        });
      }

      case 'PUT': {
        const token = getTokenFromHeaders(request.headers);
        if (!token) return json({ error: 'Authentication required' }, { status: 401 });
        const user = verifyToken(token);
        if (!user) return json({ error: 'Invalid token' }, { status: 401 });

        const body = await request.json();
        const { status, notes } = body;
        if (!status || !['pending', 'approved', 'rejected', 'processed'].includes(status)) {
          return json({ error: 'Valid status required' }, { status: 400 });
        }

        if (!ObjectId.isValid(lastPart)) {
          return json({ error: 'Invalid submission ID' }, { status: 400 });
        }

        const collection = await getFormsCollection();
        const result = await collection.updateOne(
          { _id: new ObjectId(lastPart) },
          {
            $set: {
              status,
              reviewedBy: user.id || user.sub,
              reviewedAt: new Date(),
              reviewNotes: notes || null
            }
          }
        );

        if (result.matchedCount === 0) {
          return json({ error: 'Submission not found' }, { status: 404 });
        }
        return json({ success: true, message: 'Submission updated' });
      }

      case 'DELETE': {
        const token = getTokenFromHeaders(request.headers);
        if (!token) return json({ error: 'Authentication required' }, { status: 401 });
        const user = verifyToken(token);
        if (!user) return json({ error: 'Invalid token' }, { status: 401 });

        if (!ObjectId.isValid(lastPart)) {
          return json({ error: 'Invalid submission ID' }, { status: 400 });
        }

        const collection = await getFormsCollection();
        const result = await collection.deleteOne({ _id: new ObjectId(lastPart) });
        if (result.deletedCount === 0) {
          return json({ error: 'Submission not found' }, { status: 404 });
        }
        return json({ success: true, message: 'Submission deleted' });
      }

      default:
        return json({ error: 'Method not allowed' }, { status: 405 });
    }
  } catch (error) {
    console.error('Forms handler error:', error);
    return json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

// ==========================================
// 7. Contribute Feature (GitHub Upload via Octokit)
// ==========================================
const CONTRIB_REPO_OWNER = 'Materioa';
const CONTRIB_REPO_NAME = 'static';
const CONTRIB_BRANCH = 'main';

function generateContributionCid(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `CID-${y}${m}${d}-${hh}${mm}${ss}-${suffix}`;
}

async function handleContribute(request) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Parent uses GITHUB_TOKEN for contribution uploads.
  const GITHUB_TOKEN = env.GITHUB_TOKEN || process.env.GITHUB_TOKEN || env.GITHUB_PAT || process.env.GITHUB_PAT;
  if (!GITHUB_TOKEN) {
    return json({ error: 'GitHub token is not configured on the server.' }, { status: 500 });
  }

  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  let formData;
  try {
    formData = await request.formData();
  } catch (e) {
    return json({ error: 'Failed to parse form data', details: e.message }, { status: 400 });
  }

  // Parent contract: fields semester/subject/category (+userType/username/githubUsername),
  // files under the "files" key. No "path" field — target is pdfs/<semester>/<subject>.
  const getValue = (key) => {
    const val = formData.get(key);
    return typeof val === 'string' ? val : null;
  };

  const semester = getValue('semester');
  const subject = getValue('subject');
  const category = getValue('category');
  const userType = getValue('userType') || 'anonymous';
  const username = getValue('username');
  const githubUsername = getValue('githubUsername');
  const email = getValue('email');

  if (!semester || !subject || !category) {
    return json({ error: 'Missing required fields: semester, subject, category' }, { status: 400 });
  }

  const fileList = formData.getAll('files').filter((v) => v instanceof File);
  if (fileList.length === 0) {
    return json({ error: 'No files provided' }, { status: 400 });
  }

  for (const file of fileList) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return json({ error: `Only PDF files allowed. "${file.name}" is not a PDF.` }, { status: 400 });
    }
  }

  let contributor = 'Anonymous';
  if (userType === 'authenticated' && username) contributor = username;
  else if (userType === 'github' && githubUsername) contributor = `GitHub: ${githubUsername}`;

  const branchName = CONTRIB_BRANCH;
  const basePath = `pdfs/${semester}/${subject}`;

  try {
    const { data: refData } = await octokit.git.getRef({
      owner: CONTRIB_REPO_OWNER,
      repo: CONTRIB_REPO_NAME,
      ref: `heads/${branchName}`
    });
    const latestCommitSha = refData.object.sha;
    const { data: latestCommit } = await octokit.git.getCommit({
      owner: CONTRIB_REPO_OWNER,
      repo: CONTRIB_REPO_NAME,
      commit_sha: latestCommitSha
    });
    const baseTreeSha = latestCommit.tree.sha;

    const treeItems = [];
    const uploadedFiles = [];

    for (const f of fileList) {
      const arrayBuffer = await f.arrayBuffer();
      const base64Content = Buffer.from(arrayBuffer).toString('base64');
      const filePath = `${basePath}/${f.name}`;

      const { data: blobData } = await octokit.git.createBlob({
        owner: CONTRIB_REPO_OWNER,
        repo: CONTRIB_REPO_NAME,
        content: base64Content,
        encoding: 'base64'
      });

      treeItems.push({
        path: filePath,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha
      });
      uploadedFiles.push({
        name: f.name.replace(/\.[^/.]+$/, ''),
        path: filePath,
        filename: f.name,
        size: f.size
      });
    }

    const { data: newTree } = await octokit.git.createTree({
      owner: CONTRIB_REPO_OWNER,
      repo: CONTRIB_REPO_NAME,
      base_tree: baseTreeSha,
      tree: treeItems
    });

    const commitMessage = `Contribution: ${uploadedFiles.length} file(s) for ${subject} - ${category} (by ${contributor})`;
    const { data: newCommit } = await octokit.git.createCommit({
      owner: CONTRIB_REPO_OWNER,
      repo: CONTRIB_REPO_NAME,
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha]
    });

    await octokit.git.updateRef({
      owner: CONTRIB_REPO_OWNER,
      repo: CONTRIB_REPO_NAME,
      ref: `heads/${branchName}`,
      sha: newCommit.sha
    });

    const submittedAt = new Date();
    const contributionCid = generateContributionCid(submittedAt);

    // Log to MongoDB + notify admin mailbox (parent behavior; failures non-fatal).
    try {
      const collection = await getFormsCollection();
      await collection.insertOne({
        contributionCid,
        formType: 'contribution',
        submittedAt,
        user: { type: userType, username, githubUsername, email, displayName: contributor },
        data: { semester, subject, category, files: uploadedFiles },
        meta: {
          ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
          userAgent: request.headers.get('user-agent') || 'unknown',
          commitSha: newCommit.sha
        },
        status: 'uploaded'
      });

      const mailText = [
        'New contribution received',
        `CID: ${contributionCid}`,
        `Contributor: ${contributor}`,
        `Submitted At: ${submittedAt.toISOString()}`,
        `Semester: ${semester}`,
        `Subject: ${subject}`,
        `Category: ${category}`,
        `Files: ${uploadedFiles.map((f) => f.filename).join(', ')}`,
        `Commit: ${newCommit.sha}`
      ].join('\n');

      const mailResult = await sendAlertEmail({
        to: ALERT_EMAIL,
        subject: `[Contribution Received] ${contributionCid} | ${subject}`,
        text: mailText,
        html: getContributionNotificationTemplate({
          cid: contributionCid,
          contributor,
          submittedAt: submittedAt.toISOString(),
          semester,
          subject,
          category,
          files: uploadedFiles,
          commitSha: newCommit.sha
        })
      });
      if (!mailResult.success) {
        console.warn('Contribution notification email failed:', mailResult.error);
      }
    } catch (mongoError) {
      console.error('MongoDB logging error:', mongoError.message);
    }

    return json({
      success: true,
      message: `Successfully uploaded ${uploadedFiles.length} file(s)`,
      contributionCid,
      commitSha: newCommit.sha,
      files: uploadedFiles
    });
  } catch (error) {
    console.error('Contribute error:', error);
    let errorMessage = 'Upload failed';
    let statusCode = 500;
    if (error.status === 413) {
      errorMessage = 'File too large (max 6MB)';
      statusCode = 413;
    } else if (error.status === 403) {
      errorMessage = `GitHub permission denied. Check token access to ${CONTRIB_REPO_OWNER}/${CONTRIB_REPO_NAME}`;
      statusCode = 403;
    } else if (error.status === 404) {
      errorMessage = `Repository ${CONTRIB_REPO_OWNER}/${CONTRIB_REPO_NAME} not found`;
      statusCode = 404;
    } else if (error.message) {
      errorMessage = `Upload failed: ${error.message}`;
    }
    return json({ error: errorMessage }, { status: statusCode });
  }
}

// ==========================================
// 8. Notebooks Feature (Cloud Sync & Storage)
// ==========================================
async function handleNotebooks(request, url) {
  const method = request.method;
  let subAction = url.searchParams.get('subAction') || '';
  if (!subAction && url.searchParams.get('action') !== 'notebooks') {
    subAction = url.searchParams.get('action') || '';
  }

  let body = {};
  if (method === 'POST') {
    try {
      body = await request.json();
      if (body.subAction) subAction = body.subAction;
    } catch {}
  }

  const token = getTokenFromHeaders(request.headers) || url.searchParams.get('token');
  let userId = 'anonymous';
  if (token) {
    const decoded = verifyToken(token);
    if (decoded?.id || decoded?.sub) {
      userId = String(decoded.id || decoded.sub);
    } else {
      // Fallback: decode JWT payload if signature verification failed (e.g. Supabase session token)
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          if (payload?.id || payload?.sub) {
            userId = String(payload.id || payload.sub);
          }
        }
      } catch {}
    }
  }

  if (userId === 'anonymous') {
    const fallbackUserId = url.searchParams.get('userId') || body.userId;
    if (fallbackUserId) userId = String(fallbackUserId);
  }

  try {
    const db = await getMongoDb();
    const collection = db.collection('notebooks');

    if (method === 'POST' && (subAction === 'sync' || body.notebook)) {
      if (!userId || userId === 'anonymous') {
        return json({ error: 'Authentication required to sync notebooks' }, { status: 401 });
      }
      const note = body.notebook || body;
      const noteId = note.id || note._id;
      if (!noteId) return json({ error: 'Note ID is required' }, { status: 400 });

      const doc = {
        ...note,
        id: noteId,
        userId,
        syncedToCloud: true,
        syncedAt: new Date().toISOString(),
        updatedAt: note.updatedAt || new Date().toISOString()
      };
      delete doc._id;

      await collection.updateOne(
        { id: noteId, $or: [{ userId }, { user_id: userId }] },
        { $set: doc },
        { upsert: true }
      );
      return json({ success: true, message: 'Notebook synced successfully', notebook: doc });
    }

    if (method === 'DELETE' || (method === 'POST' && subAction === 'delete')) {
      if (!userId || userId === 'anonymous') {
        return json({ error: 'Authentication required' }, { status: 401 });
      }
      const id = url.searchParams.get('id') || body.id;
      if (!id) return json({ error: 'Note ID is required' }, { status: 400 });

      await collection.deleteOne({ id, $or: [{ userId }, { user_id: userId }] });
      return json({ success: true, message: 'Notebook deleted' });
    }

    if (method === 'GET' || (method === 'POST' && (subAction === 'list' || subAction === 'notebooks' || !subAction))) {
      if (!userId || userId === 'anonymous') {
        return json({ notebooks: [] });
      }
      const notes = await collection.find({
        $or: [{ userId }, { user_id: userId }]
      }).sort({ updatedAt: -1 }).toArray();
      const cleanNotebooks = notes.map(({ _id, ...n }) => ({ ...n, syncedToCloud: true }));
      return json({ notebooks: cleanNotebooks });
    }

    return json({ error: 'Invalid notebook action' }, { status: 400 });
  } catch (error) {
    console.error('Notebooks error:', error);
    resetMongoDb();
    return json({ error: 'Database error', details: error.message }, { status: 500 });
  }
}

// ==========================================
// 9. Subscription Feature (Razorpay)
// ==========================================
async function handleSubscription(request, url) {
  let subAction = url.searchParams.get('subAction') || '';
  let body = {};

  if (request.method === 'POST') {
    try {
      body = await request.json();
      if (body.subAction) subAction = body.subAction;
    } catch {}
  }

  if (subAction === 'create-order') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
    if (!razorpay) return json({ error: 'Razorpay not configured' }, { status: 500 });

    const { plan, amount, currency = 'INR', receipt } = body;
    try {
      const options = {
        amount: Math.round(Number(amount) * 100), // in paise
        currency,
        receipt: receipt || `rcpt_${Date.now()}`,
        notes: { plan: plan || 'plus' }
      };
      const order = await razorpay.orders.create(options);
      return json(order);
    } catch (error) {
      return json({ error: 'Failed to create order', details: error.message }, { status: 500 });
    }
  }

  if (subAction === 'verify-payment') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, plan } = body;
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return json({ error: 'Missing payment verification details' }, { status: 400 });
    }

    try {
      const hmac = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET);
      hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
      const generatedSignature = hmac.digest('hex');

      if (generatedSignature !== razorpay_signature) {
        return json({ error: 'Invalid payment signature' }, { status: 400 });
      }

      // Upgrade user tier in Supabase
      const token = getTokenFromHeaders(request.headers);
      if (token) {
        const decoded = verifyToken(token);
        if (decoded?.id) {
          const client = supabaseAdmin || supabase;
          await client
            .from('users')
            .update({ tier: plan || 'plus', is_pro: true, updated_at: new Date() })
            .eq('id', decoded.id);
        }
      }

      return json({ success: true, message: 'Payment verified successfully' });
    } catch (error) {
      return json({ error: 'Verification error', details: error.message }, { status: 500 });
    }
  }

  return json({ error: 'Unknown subscription action' }, { status: 400 });
}

// ==========================================
// 10. WebPush Feature
// ==========================================
async function handleWebPush(request, url) {
  const subAction = url.searchParams.get('subAction') || url.pathname.split('/').pop();

  if (subAction === 'public-key') {
    const key = getVapidPublicKey();
    return json({ publicKey: key, configured: isWebPushConfigured() });
  }

  if (subAction === 'subscribe') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
    try {
      const subscription = await request.json();
      await upsertWebPushSubscription(subscription);
      return json({ success: true });
    } catch (e) {
      return json({ error: 'Failed to subscribe', details: e.message }, { status: 500 });
    }
  }

  if (subAction === 'unsubscribe') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
    try {
      const { endpoint } = await request.json();
      await removeWebPushSubscription(endpoint);
      return json({ success: true });
    } catch (e) {
      return json({ error: 'Failed to unsubscribe', details: e.message }, { status: 500 });
    }
  }

  return json({ error: 'Unknown web-push action' }, { status: 400 });
}

// ==========================================
// 11. PDF Share Feature
// ==========================================
const pdfShareStore = new Map();

async function handlePdfShare(request, url) {
  const method = request.method;
  const subAction = url.searchParams.get('subAction') || '';

  if (method === 'POST' && (subAction === 'create' || url.pathname.includes('/create'))) {
    try {
      const body = await request.json().catch(() => ({}));
      const actualUrl = body.actualUrl || body.pdfPath;
      if (!actualUrl) return json({ error: 'actualUrl is required' }, { status: 400 });

      // 1. Try MongoDB
      try {
        const db = await getMongoDb();
        if (db) {
          const collection = db.collection('pdf_shares');
          const existing = await collection.findOne({ actualUrl });
          if (existing) {
            pdfShareStore.set(existing.maskId, { maskId: existing.maskId, actualUrl });
            return json({ maskId: existing.maskId, isNew: false });
          }

          let maskId;
          let isUnique = false;
          while (!isUnique) {
            maskId = crypto.randomBytes(4).toString('hex'); // 8 char hex
            const dup = await collection.findOne({ maskId });
            if (!dup) isUnique = true;
          }

          await collection.insertOne({
            maskId,
            actualUrl,
            createdAt: new Date()
          });
          pdfShareStore.set(maskId, { maskId, actualUrl });
          return json({ maskId, isNew: true });
        }
      } catch (dbErr) {
        console.warn('MongoDB pdf_shares fallback:', dbErr.message);
      }

      // 2. Memory fallback
      for (const [mId, item] of pdfShareStore.entries()) {
        if (item.actualUrl === actualUrl) {
          return json({ maskId: mId, isNew: false });
        }
      }

      const maskId = crypto.randomBytes(4).toString('hex');
      pdfShareStore.set(maskId, { maskId, actualUrl, createdAt: new Date().toISOString() });
      return json({ maskId, isNew: true });
    } catch (e) {
      return json({ error: 'Failed to create share', details: e.message }, { status: 500 });
    }
  }

  if (method === 'GET' && (subAction === 'resolve' || url.pathname.includes('/resolve'))) {
    const maskId = url.searchParams.get('maskId');
    if (!maskId) return json({ error: 'maskId is required' }, { status: 400 });

    try {
      const db = await getMongoDb();
      if (db) {
        const collection = db.collection('pdf_shares');
        const share = await collection.findOne({ maskId });
        if (share && share.actualUrl) {
          return json({ actualUrl: share.actualUrl });
        }
      }
    } catch {}

    if (pdfShareStore.has(maskId)) {
      const item = pdfShareStore.get(maskId);
      return json({ actualUrl: item.actualUrl || item.pdfPath });
    }

    return json({ error: 'Shared link not found or expired' }, { status: 404 });
  }

  if (method === 'GET' && (subAction === 'resolve-llm' || url.pathname.includes('/resolve-llm') || url.pathname === '/llm')) {
    const llmMaskId = url.searchParams.get('llmMaskId') || url.searchParams.get('maskId');
    if (llmMaskId) {
      try {
        const db = await getMongoDb();
        if (db) {
          const collection = db.collection('pdf_shares');
          const share = await collection.findOne({ maskId: llmMaskId });
          if (share && share.actualUrl) {
            return json({ actualUrl: share.actualUrl, pdfPath: share.actualUrl });
          }
        }
      } catch {}

      if (pdfShareStore.has(llmMaskId)) {
        const item = pdfShareStore.get(llmMaskId);
        return json({ actualUrl: item.actualUrl || item.pdfPath, pdfPath: item.actualUrl || item.pdfPath });
      }
    }
    return json({ message: 'LLM resolver endpoint ready' });
  }

  return json({ error: 'Unknown pdf-share action' }, { status: 400 });
}

// ==========================================
// 12. Posts Feature (Markdown parser with YAML frontmatter)
// ==========================================
async function handlePosts(url) {
  const postsDirCandidates = [
    path.join(process.cwd(), 'src', 'posts'),
    path.join(process.cwd(), '_posts'),
    path.join(process.cwd(), '..', '_posts'),
    path.join(process.cwd(), '..', 'svelte', 'src', 'posts')
  ];

  let postsDir = postsDirCandidates.find((d) => fs.existsSync(d));
  if (!postsDir) {
    return json([]);
  }

  try {
    const files = fs.readdirSync(postsDir).filter((f) => f.endsWith('.md'));
    const posts = [];

    for (const f of files) {
      try {
        const fullPath = path.join(postsDir, f);
        const content = fs.readFileSync(fullPath, 'utf8');

        // Parse YAML frontmatter
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        let metadata = {};
        let body = content;

        if (match) {
          metadata = yaml.load(match[1]) || {};
          body = match[2];
        }

        const slug = f.replace(/\.md$/, '');
        posts.push({
          slug,
          ...metadata,
          title: metadata.title || slug,
          date: metadata.date || null,
          category: metadata.category || 'General',
          content: body.slice(0, 500)
        });
      } catch {}
    }

    posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    const category = url.searchParams.get('category');
    const filtered = category ? posts.filter((p) => p.category === category) : posts;

    return json(filtered);
  } catch (error) {
    console.error('Posts feature error:', error);
    return json({ error: 'Failed to read posts' }, { status: 500 });
  }
}

// ==========================================
// 13. Promotions Feature (Full CRUD)
// ==========================================
async function handlePromotionsFeature(request, url) {
  try {
    const db = await getMongoDb();
    const promoCollection = db.collection('promotions');
    const method = request.method;
    const getAll = url.searchParams.get('all') === 'true';

    switch (method) {
      case 'GET': {
        if (getAll) {
          const isAdmin = await checkAdminUser(request, url);
          if (!isAdmin) return json({ error: 'Admin privileges required' }, { status: 403 });

          let promos = await promoCollection
            .find({})
            .sort({ lastUpdated: -1, _id: -1 })
            .toArray();

          if (promos.length === 0) {
            const promoFile = getLocalDataFile('promo.json');
            if (promoFile) {
              const inserted = await promoCollection.insertOne({
                ...promoFile,
                lastUpdated: promoFile.lastUpdated || new Date().toISOString()
              });
              promos = [{ _id: inserted.insertedId, ...promoFile }];
            }
          }

          return json(promos);
        }

        const now = new Date();
        let promos = await promoCollection
          .find({ enabled: true })
          .sort({ lastUpdated: -1, _id: -1 })
          .toArray();

        if (promos.length === 0) {
          const promoFile = getLocalDataFile('promo.json');
          if (promoFile && promoFile.enabled) {
            promos = [promoFile];
          }
        }

        const activePromo = promos.find(promo => {
          if (!promo.isLimitedOffer) return true;
          if (!promo.startDate || !promo.endDate) return true;
          const start = new Date(promo.startDate);
          const end = new Date(promo.endDate);
          return now >= start && now <= end;
        });

        if (activePromo) {
          return json(activePromo);
        }

        return json({ enabled: false, message: 'No active promotions' });
      }

      case 'POST': {
        const isAdmin = await checkAdminUser(request, url);
        if (!isAdmin) return json({ error: 'Admin privileges required' }, { status: 403 });

        const promoData = await request.json();
        if (!promoData || !promoData.title || !promoData.description) {
          return json({ error: 'Title and description are required' }, { status: 400 });
        }

        const cleanData = {
          ...promoData,
          lastUpdated: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        delete cleanData._id;

        if (cleanData.enabled) {
          await promoCollection.updateMany({}, { $set: { enabled: false } });
        }

        const result = await promoCollection.insertOne(cleanData);
        return json({ 
          message: 'Promotion saved successfully', 
          id: result.insertedId,
          promo: { _id: result.insertedId, ...cleanData } 
        }, { status: 201 });
      }

      case 'PUT': {
        const isAdmin = await checkAdminUser(request, url);
        if (!isAdmin) return json({ error: 'Admin privileges required' }, { status: 403 });

        const promoData = await request.json();
        const id = promoData._id || promoData.id || url.searchParams.get('id');
        if (!id || !ObjectId.isValid(String(id))) {
          return json({ error: 'Valid promotion ID is required' }, { status: 400 });
        }

        const updateData = { ...promoData };
        delete updateData._id;
        delete updateData.id;
        updateData.lastUpdated = new Date().toISOString();
        updateData.updatedAt = new Date().toISOString();

        if (updateData.enabled) {
          await promoCollection.updateMany(
            { _id: { $ne: new ObjectId(String(id)) } },
            { $set: { enabled: false } }
          );
        }

        const result = await promoCollection.updateOne(
          { _id: new ObjectId(String(id)) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return json({ error: 'Promotion not found' }, { status: 404 });
        }

        return json({ message: 'Promotion updated successfully', promo: { _id: id, ...updateData } });
      }

      case 'DELETE': {
        const isAdmin = await checkAdminUser(request, url);
        if (!isAdmin) return json({ error: 'Admin privileges required' }, { status: 403 });

        const id = url.searchParams.get('id');
        if (!id || !ObjectId.isValid(String(id))) {
          return json({ error: 'Valid promotion ID is required' }, { status: 400 });
        }

        const result = await promoCollection.deleteOne({ _id: new ObjectId(String(id)) });
        if (result.deletedCount === 0) {
          return json({ error: 'Promotion not found' }, { status: 404 });
        }
        return json({ message: 'Promotion deleted successfully' });
      }

      default:
        return json({ error: 'Method not allowed' }, { status: 405 });
    }
  } catch (error) {
    console.error('Promotions Feature Error:', error);
    return json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

// ==========================================
// 14. Releases Feature (Full CRUD)
// ==========================================
async function handleReleasesFeature(request, url) {
  try {
    const db = await getMongoDb();
    const releasesCollection = db.collection('releases');
    const method = request.method;

    switch (method) {
      case 'GET': {
        let releases = await releasesCollection.find({}).toArray();

        if (releases.length === 0) {
          const fallback = getLocalDataFile('releases.json');
          if (Array.isArray(fallback)) releases = fallback;
          else if (Array.isArray(fallback?.releases)) releases = fallback.releases;
        }

        releases.sort((a, b) => {
          const dateB = parseBuildDate(b.build);
          const dateA = parseBuildDate(a.build);
          if (dateB.getTime() !== dateA.getTime()) {
            return dateB - dateA;
          }
          return (b.version || '').localeCompare(a.version || '', undefined, {
            numeric: true,
            sensitivity: 'base'
          });
        });

        return json(releases);
      }

      case 'POST': {
        const isAdmin = await checkAdminUser(request, url);
        if (!isAdmin) return json({ error: 'Admin privileges required' }, { status: 403 });

        const releaseData = await request.json();
        if (!releaseData || !releaseData.version || !releaseData.build || !Array.isArray(releaseData.logs)) {
          return json({ error: 'Version, build date, and logs array are required' }, { status: 400 });
        }

        const newRelease = {
          branch: releaseData.branch || 'stable',
          version: releaseData.version,
          build: releaseData.build,
          logs: releaseData.logs
        };

        const result = await releasesCollection.insertOne(newRelease);
        return json(
          {
            message: 'Release created successfully',
            id: result.insertedId,
            release: { _id: result.insertedId, ...newRelease }
          },
          { status: 201 }
        );
      }

      case 'PUT': {
        const isAdmin = await checkAdminUser(request, url);
        if (!isAdmin) return json({ error: 'Admin privileges required' }, { status: 403 });

        const releaseData = await request.json();
        if (!releaseData || !releaseData._id) {
          return json({ error: 'Release data with _id is required' }, { status: 400 });
        }

        const id = releaseData._id;
        const updateData = { ...releaseData };
        delete updateData._id;

        const result = await releasesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return json({ error: 'Release not found' }, { status: 404 });
        }

        return json({
          message: 'Release updated successfully',
          release: { _id: id, ...updateData }
        });
      }

      case 'DELETE': {
        const isAdmin = await checkAdminUser(request, url);
        if (!isAdmin) return json({ error: 'Admin privileges required' }, { status: 403 });

        const id = url.searchParams.get('id');
        if (!id) return json({ error: 'Release id parameter is required' }, { status: 400 });

        const result = await releasesCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
          return json({ error: 'Release not found' }, { status: 404 });
        }

        return json({ message: 'Release deleted successfully' });
      }

      default:
        return json({ error: 'Method not allowed' }, { status: 405 });
    }
  } catch (error) {
    console.error('Releases Feature Error:', error);
    return json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

// ==========================================
// 15. Examdata Feature (Full CRUD)
// ==========================================
async function handleExamdataFeature(request, url) {
  try {
    const db = await getMongoDb();
    const examdataCollection = db.collection('examdata');
    const method = request.method;

    switch (method) {
      case 'GET': {
        const data = await examdataCollection.findOne({ type: 'config' });
        if (data) {
          if (data.enabled === false) {
            return json({ enabled: false, semesters: [] });
          }
          if (Array.isArray(data.semesters) && data.semesters.length > 0) {
            return json(data);
          }
        }

        const anyData = await examdataCollection.findOne({});
        if (anyData) {
          if (anyData.enabled === false) {
            return json({ enabled: false, semesters: [] });
          }
          if (Array.isArray(anyData.semesters) && anyData.semesters.length > 0) {
            return json(anyData);
          }
        }

        const fallback = getLocalDataFile('examdata.json');
        if (fallback) return json(fallback);

        return json({ enabled: false, semesters: [] });
      }

      case 'POST': {
        const isAdmin = await checkAdminUser(request, url);
        if (!isAdmin) return json({ error: 'Admin privileges required' }, { status: 403 });

        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('multipart/form-data')) {
          const formData = await request.formData();
          const file = formData.get('file');
          if (!file || !(file instanceof File)) {
            return json({ error: 'No file provided' }, { status: 400 });
          }

          const isCsv = file.name.toLowerCase().endsWith('.csv');
          const prefix = isCsv ? 'seating' : 'promotions';
          const fileExtension = isCsv ? 'csv' : file.name.split('.').pop() || 'png';
          const contentTypeHeader = isCsv ? 'text/csv' : (file.type || 'image/png');
          const fileName = `${prefix}/${prefix}_data_${Date.now()}.${fileExtension}`;

          const arrayBuf = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);

          const client = supabaseAdmin || supabase;
          const { error: uploadError } = await client.storage
            .from('profile-pictures')
            .upload(fileName, buffer, {
              contentType: contentTypeHeader,
              upsert: true
            });

          if (uploadError) {
            console.error('Supabase Storage Upload Error:', uploadError);
            return json({ error: 'Failed to upload to storage', details: uploadError.message }, { status: 500 });
          }

          const { data: { publicUrl } } = client.storage
            .from('profile-pictures')
            .getPublicUrl(fileName);

          return json({
            message: 'File uploaded successfully',
            url: publicUrl,
            fileName: file.name
          });
        }

        const examData = await request.json();
        if (!examData || Object.keys(examData).length === 0) {
          return json({ error: 'Exam configuration data is required' }, { status: 400 });
        }

        const cleanData = {
          ...examData,
          type: 'config',
          lastUpdated: new Date().toISOString()
        };
        delete cleanData._id;

        await examdataCollection.replaceOne({ type: 'config' }, cleanData, { upsert: true });
        return json({ message: 'Exam configuration saved successfully', examdata: cleanData });
      }

      default:
        return json({ error: 'Method not allowed' }, { status: 405 });
    }
  } catch (error) {
    console.error('ExamData Feature Error:', error);
    return json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

// ==========================================
// 16. Notifications Feature (Full CRUD)
// ==========================================
async function handleNotificationsFeature(request, url) {
  try {
    const db = await getMongoDb();
    const notificationsCollection = db.collection('notifications');
    const method = request.method;

    switch (method) {
      case 'GET': {
        const merged = await getMergedNotifications();
        return json(merged, { headers: { 'Cache-Control': 'no-store' } });
      }

      case 'POST': {
        const isAdmin = await checkAdminUser(request, url);
        if (!isAdmin) return json({ error: 'Admin privileges required' }, { status: 403 });

        const data = await request.json();
        if (!data || !data.title || !data.message) {
          return json({ error: 'Title and message are required' }, { status: 400 });
        }

        const newNotif = {
          title: data.title.trim(),
          message: data.message.trim(),
          category: data.category ? data.category.trim() : 'General',
          link: data.link ? data.link.trim() : '',
          timestamp: new Date().toISOString(),
          date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          created_at: new Date().toISOString()
        };

        const result = await notificationsCollection.insertOne(newNotif);
        newNotif._id = result.insertedId;

        return json({ message: 'Notification created', notification: newNotif }, { status: 201 });
      }

      case 'PUT': {
        const isAdmin = await checkAdminUser(request, url);
        if (!isAdmin) return json({ error: 'Admin privileges required' }, { status: 403 });

        const data = await request.json();
        if (!data || (!data._id && !data.id)) {
          return json({ error: 'Notification ID is required' }, { status: 400 });
        }

        const id = String(data._id || data.id);
        const updateData = { ...data };
        delete updateData._id;
        delete updateData.id;
        updateData.updated_at = new Date().toISOString();

        if (ObjectId.isValid(id)) {
          await notificationsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
        } else {
          await notificationsCollection.updateOne({ id: id }, { $set: updateData });
        }

        return json({ message: 'Notification updated', notification: { _id: id, ...updateData } });
      }

      case 'DELETE': {
        const isAdmin = await checkAdminUser(request, url);
        if (!isAdmin) return json({ error: 'Admin privileges required' }, { status: 403 });

        const id = url.searchParams.get('id');
        if (!id) return json({ error: 'Notification id parameter is required' }, { status: 400 });

        if (ObjectId.isValid(id)) {
          await notificationsCollection.deleteOne({ _id: new ObjectId(id) });
        } else {
          await notificationsCollection.deleteOne({ id: id });
        }

        return json({ message: 'Notification deleted' });
      }

      default:
        return json({ error: 'Method not allowed' }, { status: 405 });
    }
  } catch (error) {
    console.error('Notifications Feature Error:', error);
    return json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

// ==========================================
// 17. Analytics Ingestion & Rate-Limiting Helpers
// ==========================================
const ANALYTICS_ALLOWED_ORIGIN_HOSTS = new Set([
  'getmaterio.app',
  'www.getmaterio.app',
  'materioa.netlify.app',
  'materioa.vercel.app',
  'materioapp.in',
  'auth-materioa.netlify.app',
  'insightroom.vercel.app',
  'room.getmaterio.app'
]);
const ANALYTICS_MAX_REQUEST_SECONDS = 2 * 60 * 60;
const ANALYTICS_MAX_REQUEST_ENGAGEMENT_SECONDS = 3 * 60 * 60;
const ANALYTICS_MAX_PDF_ENTRIES = 30;
const ANALYTICS_MAX_REQUEST_PDF_OPENS = 30;
const ANALYTICS_MAX_PDF_COUNT_PER_ITEM = 8;
const ANALYTICS_MAX_PDF_SECONDS_PER_ITEM = 2 * 60 * 60;
const ANALYTICS_RATE_WINDOW_MS = 60 * 1000;
const ANALYTICS_RATE_LIMIT_IP = 180;
const ANALYTICS_RATE_LIMIT_ANON = 90;
const ANALYTICS_RATE_LIMIT_USER = 90;
const ANALYTICS_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const analyticsRateBuckets = new Map();
const MODERATION_RULES_COLLECTION = 'abuse_moderation_rules';

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  const normalized = Math.trunc(number);
  return Math.min(Math.max(normalized, min), max);
}

function toTrimmedString(value, maxLength = 255) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeModerationIdentity(value, maxLength = 255) {
  return toTrimmedString(value, maxLength).toLowerCase();
}

function getAnalyticsClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 64);
  return request.headers.get('x-real-ip') || 'unknown';
}

async function findActiveModerationRule({ anonId, fingerprint, ipAddress, action = null } = {}) {
  const normalizedAnonId = normalizeModerationIdentity(anonId, 128);
  const normalizedFingerprint = normalizeModerationIdentity(fingerprint, 128);
  const normalizedIp = normalizeModerationIdentity(ipAddress, 64);

  if (!normalizedAnonId || !normalizedFingerprint || !normalizedIp) return null;

  try {
    const db = await getMongoDb();
    const query = {
      active: true,
      anon_id: normalizedAnonId,
      fingerprint: normalizedFingerprint,
      ip_address: normalizedIp
    };
    if (action) query.action = normalizeModerationIdentity(action, 16);

    const rule = await db.collection(MODERATION_RULES_COLLECTION).findOne(query, {
      sort: { updatedAt: -1, createdAt: -1 },
      projection: { _id: 0, action: 1, title: 1, body: 1, active: 1, updatedAt: 1 }
    });
    if (!rule) return null;

    return {
      action: normalizeModerationIdentity(rule.action, 16),
      title: toTrimmedString(rule.title, 120),
      body: toTrimmedString(rule.body, 300),
      active: rule.active !== false,
      updatedAt: rule.updatedAt || null
    };
  } catch {
    return null;
  }
}

function isAllowedAnalyticsHost(host) {
  if (!host) return false;
  if (ANALYTICS_ALLOWED_ORIGIN_HOSTS.has(host)) return true;
  return host.startsWith('localhost:') || host.startsWith('127.0.0.1:');
}

function resolveHeaderUrlHost(value) {
  const raw = toTrimmedString(value, 512);
  if (!raw) return '';
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return '';
  }
}

function validateAnalyticsRequestOrigin(request) {
  const originHost = resolveHeaderUrlHost(request.headers.get('origin'));
  const refererHost = resolveHeaderUrlHost(request.headers.get('referer'));
  const secFetchSite = String(request.headers.get('sec-fetch-site') || '').toLowerCase();

  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
    return { ok: false, reason: 'Cross-site analytics submission blocked' };
  }
  if (originHost && isAllowedAnalyticsHost(originHost)) return { ok: true };
  if (!originHost && refererHost && isAllowedAnalyticsHost(refererHost)) return { ok: true };
  return { ok: false, reason: 'Untrusted analytics request origin' };
}

function consumeAnalyticsRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = analyticsRateBuckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    analyticsRateBuckets.set(key, { count: 1, windowStart: now, lastSeen: now });
    return { allowed: true };
  }

  bucket.lastSeen = now;
  if (bucket.count >= limit) {
    const retryAfterMs = Math.max(windowMs - (now - bucket.windowStart), 1000);
    return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }

  bucket.count += 1;
  return { allowed: true };
}

function cleanupAnalyticsRateBuckets() {
  const now = Date.now();
  const staleAfter = ANALYTICS_RATE_WINDOW_MS * 10;
  for (const [key, value] of analyticsRateBuckets.entries()) {
    if (!value?.lastSeen || now - value.lastSeen > staleAfter) {
      analyticsRateBuckets.delete(key);
    }
  }
}

function validateAnalyticsDateKey(value) {
  const dateKey = toTrimmedString(value, 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

  const parsed = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const deltaDays = Math.round((parsed.getTime() - todayUtc) / (24 * 60 * 60 * 1000));
  if (deltaDays < -2 || deltaDays > 1) return null;

  return dateKey;
}

function sanitizeAnalyticsPdfCounts(rawPdfCounts) {
  if (!rawPdfCounts || typeof rawPdfCounts !== 'object' || Array.isArray(rawPdfCounts)) {
    return { ok: true, pdfCounts: {}, totalPdfOpens: 0, uniquePdfReads: 0 };
  }

  const entries = Object.entries(rawPdfCounts).slice(0, ANALYTICS_MAX_PDF_ENTRIES);
  const safeCounts = {};
  let totalPdfOpens = 0;
  let uniquePdfReads = 0;

  for (const [rawName, rawValue] of entries) {
    const name = normalizeAnalyticsPdfName(rawName).slice(0, 120);
    if (!name) continue;

    let count = 0;
    let timeSec = 0;

    if (typeof rawValue === 'number') {
      count = clampInteger(rawValue, 0, ANALYTICS_MAX_PDF_COUNT_PER_ITEM);
    } else if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      count = clampInteger(rawValue.count, 0, ANALYTICS_MAX_PDF_COUNT_PER_ITEM);
      timeSec = clampInteger(rawValue.time_sec, 0, ANALYTICS_MAX_PDF_SECONDS_PER_ITEM);
    }

    if (count <= 0 && timeSec <= 0) continue;

    totalPdfOpens += count;
    if (count > 0) uniquePdfReads += 1;

    safeCounts[name] = { count, time_sec: timeSec };
  }

  if (totalPdfOpens > ANALYTICS_MAX_REQUEST_PDF_OPENS) {
    return { ok: false, error: 'Too many PDF opens in a single analytics request' };
  }
  if (uniquePdfReads > totalPdfOpens) {
    return { ok: false, error: 'Invalid PDF counters: unique exceeds total' };
  }

  return { ok: true, pdfCounts: safeCounts, totalPdfOpens, uniquePdfReads };
}

function sanitizeAnalyticsPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return { ok: false, error: 'Invalid analytics payload' };
  }

  const anonId = toTrimmedString(rawPayload.p_anon_id, 128);
  if (!anonId || !/^[a-zA-Z0-9._:-]{8,128}$/.test(anonId)) {
    return { ok: false, error: 'Invalid anonymous analytics identity' };
  }

  const dateKey = validateAnalyticsDateKey(rawPayload.p_date);
  if (!dateKey) {
    return { ok: false, error: 'Invalid analytics date' };
  }

  const metricsDiff =
    rawPayload.p_metrics_diff && typeof rawPayload.p_metrics_diff === 'object' && !Array.isArray(rawPayload.p_metrics_diff)
      ? rawPayload.p_metrics_diff
      : {};

  const usermetaDiff =
    rawPayload.p_usermeta_diff && typeof rawPayload.p_usermeta_diff === 'object' && !Array.isArray(rawPayload.p_usermeta_diff)
      ? rawPayload.p_usermeta_diff
      : {};

  const totalReadingSec = clampInteger(metricsDiff.total_reading_sec, 0, ANALYTICS_MAX_REQUEST_SECONDS);
  const totalEngagementSec = clampInteger(usermetaDiff.total_engagement_sec, 0, ANALYTICS_MAX_REQUEST_ENGAGEMENT_SECONDS);

  const pdfResult = sanitizeAnalyticsPdfCounts(metricsDiff.pdf_counts || {});
  if (!pdfResult.ok) {
    return { ok: false, error: pdfResult.error };
  }

  const sanitized = {
    p_anon_id: anonId,
    p_date: dateKey,
    p_user_id: null,
    p_metrics_diff: {
      total_reading_sec: totalReadingSec,
      pdf_counts: pdfResult.pdfCounts
    },
    p_usermeta_diff: {
      total_engagement_sec: totalEngagementSec,
      session:
        usermetaDiff.session && typeof usermetaDiff.session === 'object' && !Array.isArray(usermetaDiff.session)
          ? {
              ua: toTrimmedString(usermetaDiff.session.ua, 400),
              screen: toTrimmedString(usermetaDiff.session.screen, 40),
              referrer: toTrimmedString(usermetaDiff.session.referrer, 500),
              url: toTrimmedString(usermetaDiff.session.url, 500),
              path: toTrimmedString(usermetaDiff.session.path, 200),
              campaign: toTrimmedString(usermetaDiff.session.campaign, 100),
              fp: toTrimmedString(usermetaDiff.session.fp, 128)
            }
          : null,
      engagement:
        usermetaDiff.engagement && typeof usermetaDiff.engagement === 'object' && !Array.isArray(usermetaDiff.engagement)
          ? usermetaDiff.engagement
          : { clicks: {}, scroll: 0, zoom: 0, shortcuts: {} },
      state:
        usermetaDiff.state && typeof usermetaDiff.state === 'object' && !Array.isArray(usermetaDiff.state)
          ? usermetaDiff.state
          : null
    },
    rawUserId: toTrimmedString(rawPayload.p_user_id, 64) || null
  };

  return { ok: true, data: sanitized };
}

async function handleAnalyticsIngest(request) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    cleanupAnalyticsRateBuckets();

    const originCheck = validateAnalyticsRequestOrigin(request);
    if (!originCheck.ok) {
      return json({ error: originCheck.reason }, { status: 403 });
    }

    const rawBody = await request.json();
    const parsedPayload = sanitizeAnalyticsPayload(rawBody);
    if (!parsedPayload.ok) {
      return json({ error: parsedPayload.error }, { status: 400 });
    }

    const data = parsedPayload.data;
    const clientIp = getAnalyticsClientIp(request);
    const fingerprint = toTrimmedString(data.p_usermeta_diff?.session?.fp, 128);
    const token = getTokenFromHeaders(request.headers);
    const decoded = token ? verifyToken(token) : null;

    if (token && (!decoded || !decoded.id || !ANALYTICS_UUID_REGEX.test(decoded.id))) {
      return json({ error: 'Invalid analytics auth token' }, { status: 401 });
    }

    if (data.rawUserId && decoded?.id && data.rawUserId !== decoded.id) {
      return json({ error: 'User identity mismatch in analytics payload' }, { status: 403 });
    }

    data.p_user_id = decoded?.id || (data.rawUserId && ANALYTICS_UUID_REGEX.test(data.rawUserId) ? data.rawUserId : null);
    delete data.rawUserId;

    const matchedBan = await findActiveModerationRule({
      anonId: data.p_anon_id,
      fingerprint,
      ipAddress: clientIp,
      action: 'ban'
    });

    if (matchedBan) {
      return json({ error: matchedBan.title || 'This device has been blocked', action: 'ban' }, { status: 403 });
    }

    const ipLimit = consumeAnalyticsRateLimit(`analytics:ip:${clientIp}`, ANALYTICS_RATE_LIMIT_IP, ANALYTICS_RATE_WINDOW_MS);
    if (!ipLimit.allowed) {
      return json({ error: 'Too many analytics requests from IP' }, { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSec) } });
    }

    const anonLimit = consumeAnalyticsRateLimit(`analytics:anon:${data.p_anon_id}`, ANALYTICS_RATE_LIMIT_ANON, ANALYTICS_RATE_WINDOW_MS);
    if (!anonLimit.allowed) {
      return json({ error: 'Too many analytics requests for anonymous identity' }, { status: 429, headers: { 'Retry-After': String(anonLimit.retryAfterSec) } });
    }

    if (data.p_user_id) {
      const userLimit = consumeAnalyticsRateLimit(`analytics:user:${data.p_user_id}`, ANALYTICS_RATE_LIMIT_USER, ANALYTICS_RATE_WINDOW_MS);
      if (!userLimit.allowed) {
        return json({ error: 'Too many analytics requests for user' }, { status: 429, headers: { 'Retry-After': String(userLimit.retryAfterSec) } });
      }
    }

    if (data.p_usermeta_diff && data.p_usermeta_diff.session) {
      data.p_usermeta_diff.session.ip = clientIp;
    }

    const client = supabaseAdmin || supabase;
    const { error } = await client.rpc('merge_daily_stats', data);

    if (error) {
      console.error('Supabase Analytics Error:', error);
      return json({ error: 'Upstream failure', details: error.message }, { status: 500 });
    }

    return json({ success: true });
  } catch (error) {
    console.error('Analytics Handler Error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ==========================================
// 18. Analytics Views & Leaderboard
// ==========================================
function normalizeAnalyticsPdfName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPdfCountMap(metrics) {
  if (!metrics || typeof metrics !== 'object') return {};
  if (metrics.pdf_counts && typeof metrics.pdf_counts === 'object') return metrics.pdf_counts;
  if (metrics.pdfs_read && typeof metrics.pdfs_read === 'object') return metrics.pdfs_read;
  return {};
}

function getPdfReadsForName(pdfCountMap, targetPdfName) {
  const normalizedTarget = normalizeAnalyticsPdfName(targetPdfName);
  if (!normalizedTarget) return 0;
  let reads = 0;
  for (const [rawName, value] of Object.entries(pdfCountMap || {})) {
    if (normalizeAnalyticsPdfName(rawName) !== normalizedTarget) continue;
    const countValue = typeof value === 'number' ? value : Number(value?.count || 0);
    reads += Number.isFinite(countValue) ? countValue : 0;
  }
  return reads;
}

function getPdfTimeSecForName(pdfCountMap, targetPdfName) {
  const normalizedTarget = normalizeAnalyticsPdfName(targetPdfName);
  if (!normalizedTarget) return 0;
  let seconds = 0;
  for (const [rawName, value] of Object.entries(pdfCountMap || {})) {
    if (normalizeAnalyticsPdfName(rawName) !== normalizedTarget) continue;
    if (typeof value === 'number') continue;
    const secValue = Number(value?.time_sec || value?.duration_sec || 0);
    seconds += Number.isFinite(secValue) ? secValue : 0;
  }
  return seconds;
}

async function fetchDailyStatsRows(maxRows = 25000) {
  const client = supabaseAdmin || supabase;
  const batchSize = 1000;
  let from = 0;
  const allRows = [];

  try {
    while (from < maxRows) {
      const to = from + batchSize - 1;
      const { data, error } = await client
        .from('user_daily_stats')
        .select('*')
        .range(from, to);

      if (error) {
        console.error('fetchDailyStatsRows error:', error.message || error);
        break;
      }
      const rows = data || [];
      allRows.push(...rows);
      if (rows.length < batchSize) break;
      from += batchSize;
    }
  } catch (err) {
    console.error('fetchDailyStatsRows catch:', err.message || err);
  }
  return allRows;
}

function toDateKey(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function getRowDateKey(row) {
  if (!row || typeof row !== 'object') return null;
  const candidates = [row.stat_date, row.date, row.day, row.record_date, row.created_at, row.updated_at];
  for (const candidate of candidates) {
    const key = toDateKey(candidate);
    if (key) return key;
  }
  return null;
}

function filterRowsByTimeframe(rows, timeframe, requestedDateKey) {
  if (timeframe !== 'today' && timeframe !== 'weekly') return rows;
  const baseDateStr = toDateKey(requestedDateKey) || new Date().toISOString().slice(0, 10);

  if (timeframe === 'today') {
    return (rows || []).filter((row) => getRowDateKey(row) === baseDateStr);
  }

  if (timeframe === 'weekly') {
    const baseDate = new Date(baseDateStr + 'T00:00:00Z');
    if (Number.isNaN(baseDate.getTime())) return rows;
    return (rows || []).filter((row) => {
      const rowDateKey = getRowDateKey(row);
      if (!rowDateKey) return false;
      const rowDate = new Date(rowDateKey + 'T00:00:00Z');
      if (Number.isNaN(rowDate.getTime())) return false;
      const diffDays = (baseDate.getTime() - rowDate.getTime()) / (1000 * 3600 * 24);
      return diffDays >= 0 && diffDays < 7;
    });
  }
  return rows;
}

function isSuspiciousLeaderboardAggregate(entry, timeframe) {
  if (!entry || typeof entry !== 'object') return true;
  const totalReads = Number(entry.totalReads || 0);
  const totalReadSec = Number(entry.totalReadSec || 0);
  const uniquePdfs = Number(entry.uniquePdfs || 0);
  const maxTimeframeReadSec = timeframe === 'today' ? 16 * 60 * 60 : 7 * 16 * 60 * 60;

  if (!Number.isFinite(totalReads) || totalReads < 0) return true;
  if (!Number.isFinite(totalReadSec) || totalReadSec < 0) return true;
  if (!Number.isFinite(uniquePdfs) || uniquePdfs < 0) return true;
  if (uniquePdfs > totalReads) return true;
  if (totalReadSec > maxTimeframeReadSec) return true;
  return false;
}

async function fetchLeaderboardIdentityMap(readerIds = []) {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const userIds = Array.from(new Set((readerIds || []).map((id) => String(id || '').trim()).filter((id) => UUID_REGEX.test(id))));
  if (!userIds.length) return new Map();

  const identities = new Map();
  const chunkSize = 200;
  const client = supabaseAdmin || supabase;

  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);
    const { data, error } = await client.from('users').select('id,display_name,username').in('id', chunk);
    if (error) throw error;

    for (const row of data || []) {
      const id = String(row.id || '').trim();
      if (!id) continue;
      const displayName = String(row.display_name || '').trim() || String(row.username || '').trim() || null;
      if (displayName) identities.set(id, displayName);
    }
  }
  return identities;
}

async function handleAnalyticsViews(url) {
  try {
    const pdfName = url.searchParams.get('pdfName') || '';
    const normalizedPdfName = normalizeAnalyticsPdfName(pdfName);
    if (!normalizedPdfName) {
      return json({ error: 'pdfName is required' }, { status: 400 });
    }

    const rows = await fetchDailyStatsRows();
    let totalReads = 0;
    const readers = new Set();

    for (const row of rows) {
      const countMap = extractPdfCountMap(row.metrics);
      const reads = getPdfReadsForName(countMap, normalizedPdfName);
      if (reads <= 0) continue;
      totalReads += reads;
      const readerId = String(row.user_id || row.anon_id || '').trim();
      if (readerId) readers.add(readerId);
    }

    const uniqueReads = readers.size;
    const hasData = totalReads > 0 && uniqueReads > 0;

    return json({ pdfName: normalizedPdfName, hasData, uniqueReads, totalReads });
  } catch (error) {
    console.error('Analytics Views Error:', error);
    return json({ error: 'Failed to compute PDF views' }, { status: 500 });
  }
}

async function handleAnalyticsLeaderboard(request, url) {
  try {
    const limitRaw = Number(url.searchParams.get('limit') || 50);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 3), 50);

    const targetPdfName = url.searchParams.get('pdfName') || '';
    const normalizedTargetPdf = normalizeAnalyticsPdfName(targetPdfName);

    const requesterAnonId = String(url.searchParams.get('anonId') || '').trim();
    const requesterFingerprint = String(url.searchParams.get('fp') || '').trim();
    const requesterUserId = String(url.searchParams.get('userId') || '').trim();
    const timeframeRaw = String(
      url.searchParams.get('timeframe') || url.searchParams.get('range') || 'weekly'
    ).trim().toLowerCase();
    const timeframe = timeframeRaw === 'today' ? 'today' : 'weekly';
    const requestedDateKey = String(url.searchParams.get('date') || '').trim();

    const rows = filterRowsByTimeframe(await fetchDailyStatsRows(), timeframe, requestedDateKey);
    const byReader = new Map();

    for (const row of rows) {
      const readerKey = String(row.user_id || row.anon_id || '').trim();
      if (!readerKey) continue;

      const current = byReader.get(readerKey) || {
        readerId: readerKey,
        isAnonymous: !row.user_id,
        totalReads: 0,
        totalReadSec: 0,
        uniquePdfSet: new Set()
      };

      const countMap = extractPdfCountMap(row.metrics);
      if (normalizedTargetPdf) {
        current.totalReads += getPdfReadsForName(countMap, normalizedTargetPdf);
        current.totalReadSec += getPdfTimeSecForName(countMap, normalizedTargetPdf);
      } else {
        for (const [pdfName, value] of Object.entries(countMap || {})) {
          const reads = typeof value === 'number' ? value : Number(value?.count || 0);
          const readSec = typeof value === 'number' ? 0 : Number(value?.time_sec || value?.duration_sec || 0);
          const safeReads = Number.isFinite(reads) ? reads : 0;
          const safeReadSec = Number.isFinite(readSec) ? readSec : 0;
          current.totalReads += safeReads;
          current.totalReadSec += safeReadSec;
          if (safeReads > 0) current.uniquePdfSet.add(normalizeAnalyticsPdfName(pdfName));
        }
      }
      byReader.set(readerKey, current);
    }

    const userIdsInLeaderboard = Array.from(byReader.values()).filter((e) => !e.isAnonymous).map((e) => e.readerId);
    let identityMap = new Map();
    try {
      identityMap = await fetchLeaderboardIdentityMap(userIdsInLeaderboard);
    } catch (e) {
      console.warn('fetchLeaderboardIdentityMap non-fatal error:', e.message);
    }

    const ranked = Array.from(byReader.values())
      .filter((entry) => entry.totalReads > 0)
      .map((entry) => ({
        readerId: entry.readerId,
        isAnonymous: entry.isAnonymous,
        totalReads: entry.totalReads,
        totalReadSec: entry.totalReadSec,
        uniquePdfs: entry.uniquePdfSet.size
      }))
      .filter((entry) => !isSuspiciousLeaderboardAggregate(entry, timeframe))
      .sort((a, b) => {
        if (b.totalReadSec !== a.totalReadSec) return b.totalReadSec - a.totalReadSec;
        if (b.totalReads !== a.totalReads) return b.totalReads - a.totalReads;
        if (b.uniquePdfs !== a.uniquePdfs) return b.uniquePdfs - a.uniquePdfs;
        return a.readerId.localeCompare(b.readerId);
      })
      .map((entry, index) => {
        const readableId = entry.readerId || 'reader';
        const maskedId = readableId.slice(-6).padStart(6, '0');
        const resolvedName = !entry.isAnonymous && identityMap.has(entry.readerId) ? identityMap.get(entry.readerId) : null;
        return {
          ...entry,
          rank: index + 1,
          displayName: resolvedName || (entry.isAnonymous ? `Anon #${maskedId}` : `Reader #${maskedId}`)
        };
      });

    const requester =
      ranked.find((entry) => {
        if (requesterUserId && entry.readerId === requesterUserId) return true;
        if (requesterAnonId && entry.readerId === requesterAnonId) return true;
        return false;
      }) || null;

    let moderationNotice = null;
    try {
      moderationNotice = await findActiveModerationRule({
        anonId: requesterAnonId,
        fingerprint: requesterFingerprint,
        ipAddress: getAnalyticsClientIp(request)
      });
    } catch {}

    return json({
      generatedAt: new Date().toISOString(),
      timeframe,
      date: timeframe === 'today' ? toDateKey(requestedDateKey) || new Date().toISOString().slice(0, 10) : null,
      targetPdf: normalizedTargetPdf || null,
      totalParticipants: ranked.length,
      entries: ranked.slice(0, limit),
      requester: requester
        ? {
            readerId: requester.readerId,
            rank: requester.rank,
            isTopReader: requester.rank === 1,
            isAnonymous: requester.isAnonymous
          }
        : {
            rank: null,
            isTopReader: false,
            isAnonymous: !requesterUserId
          },
      moderationNotice: moderationNotice
        ? {
            action: moderationNotice.action,
            title: moderationNotice.title,
            body: moderationNotice.body,
            active: moderationNotice.active
          }
        : null
    });
  } catch (error) {
    console.error('Analytics Leaderboard Error:', error);
    return json({
      generatedAt: new Date().toISOString(),
      timeframe: 'weekly',
      date: null,
      targetPdf: null,
      totalParticipants: 0,
      entries: [],
      requester: {
        rank: null,
        isTopReader: false,
        isAnonymous: true
      },
      moderationNotice: null
    });
  }
}

// ==========================================
// Central Features Dispatcher
// Matches parent features.js exactly
// ==========================================
export function resolveFeatureAction(url, params) {
  const pathParam = params?.path || url.searchParams.get('path') || '';
  const action = url.searchParams.get('action') || '';
  const pathname = url.pathname;

  if (action === 'analytics-views' || action === 'views') return 'analytics-views';
  if (action === 'analytics-leaderboard' || action === 'leaderboard') return 'analytics-leaderboard';
  if (action === 'analytics') return 'analytics';
  if (action === 'notifications-feed') return 'notifications-feed';

  const check = (name) =>
    action === name ||
    pathname.includes(`/${name}`) ||
    pathParam.includes(name);

  if (check('insights')) return 'insights';
  if (check('save-promo')) return 'save-promo';
  if (check('google-drive')) return 'google-drive';
  if (check('sharelink')) return 'sharelink';
  if (check('forms')) return 'forms';
  if (check('contribute')) return 'contribute';
  if (check('notebooks')) return 'notebooks';
  if (check('subscription')) return 'subscription';
  if (check('web-push')) return 'web-push';
  if (check('pdf-share') || pathname === '/llm' || pathname.startsWith('/share/llm/')) return 'pdf-share';
  if (check('posts')) return 'posts';
  if (check('promotions')) return 'promotions';
  if (check('releases')) return 'releases';
  if (check('examdata')) return 'examdata';
  if (check('notifications-feed')) return 'notifications-feed';
  if (check('notifications')) return 'notifications';
  if (check('analytics-views') || check('views')) return 'analytics-views';
  if (check('analytics-leaderboard') || check('leaderboard')) return 'analytics-leaderboard';
  if (check('analytics')) return 'analytics';

  if (action) return action;
  return '';
}

export async function handleFeaturesRequest({ request, url, params }) {
  const feature = resolveFeatureAction(url, params);

  if (feature === 'analytics-views' || feature === 'views') {
    return handleAnalyticsViews(url);
  }
  if (feature === 'analytics-leaderboard' || feature === 'leaderboard') {
    return handleAnalyticsLeaderboard(request, url);
  }
  if (feature === 'analytics') {
    return handleAnalyticsIngest(request);
  }
  if (feature === 'notifications-feed') {
    return handleNotificationsFeed(url);
  }
  if (feature === 'insights') {
    return handleInsights(url);
  }
  if (feature === 'save-promo') {
    return handleSavePromo(request);
  }
  if (feature === 'google-drive') {
    return handleGoogleDrive(request, url);
  }
  if (feature === 'sharelink') {
    return handleSharelink(request, url);
  }
  if (feature === 'forms') {
    return handleForms(request, url);
  }
  if (feature === 'contribute') {
    return handleContribute(request);
  }
  if (feature === 'notebooks') {
    return handleNotebooks(request, url);
  }
  if (feature === 'subscription') {
    return handleSubscription(request, url);
  }
  if (feature === 'web-push') {
    return handleWebPush(request, url);
  }
  if (feature === 'pdf-share') {
    return handlePdfShare(request, url);
  }
  if (feature === 'posts') {
    return handlePosts(url);
  }
  if (feature === 'promotions') {
    return handlePromotionsFeature(request, url);
  }
  if (feature === 'releases') {
    return handleReleasesFeature(request, url);
  }
  if (feature === 'examdata') {
    return handleExamdataFeature(request, url);
  }
  if (feature === 'notifications') {
    return handleNotificationsFeature(request, url);
  }

  return json(
    {
      error: 'Feature not found',
      debug: {
        pathname: url.pathname,
        action: url.searchParams.get('action'),
        pathParam: params?.path || url.searchParams.get('path'),
        availableFeatures: [
          'insights',
          'save-promo',
          'google-drive',
          'sharelink',
          'forms',
          'contribute',
          'notebooks',
          'pdf-share',
          'web-push',
          'views',
          'leaderboard',
          'analytics-views',
          'analytics-leaderboard',
          'notifications-feed',
          'posts',
          'promotions',
          'releases',
          'examdata',
          'notifications'
        ]
      }
    },
    { status: 404 }
  );
}

export function handleFeaturesOptions({ request }) {
  const origin = request.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin)
  });
}
