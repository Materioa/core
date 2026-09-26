import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

export const SUPABASE_URL =
  env.PUBLIC_SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL ||
  'https://popaoujsfvznlqltszfr.supabase.co';

export const SUPABASE_ANON_KEY =
  env.PUBLIC_SUPABASE_ANON_KEY ||
  process.env.PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvcGFvdWpzZnZ6bmxxbHRzemZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcxMTg1NTIsImV4cCI6MjA2MjY5NDU1Mn0.nJFDXqpcnQDnZa7OueLSiHeqE0RxbINEcKcwv8l8bRw';

export const SUPABASE_SERVICE_KEY =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvcGFvdWpzZnZ6bmxxbHRzemZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzExODU1MiwiZXhwIjoyMDYyNjk0NTUyfQ.V3RWNcRq0O-iwucH07OrwZ7AAjPYkCmR7QCfPwlpNAI';

export const JWT_SECRET =
  env.JWT_SECRET ||
  process.env.JWT_SECRET ||
  'your-secret-key-here-change-in-production';

export const JWT_EXPIRES_IN = '7d';
export const SITE_URL = env.SITE_URL || process.env.SITE_URL || 'https://auth-materioa.netlify.app';
export const FRONTEND_URL = env.FRONTEND_URL || process.env.FRONTEND_URL || 'https://materioa.netlify.app';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

import jwt from 'jsonwebtoken';

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
};

