import { SPA_HTML } from './spa';

interface Env {
  DB: D1Database;
  LITELLM_MASTER_KEY: string;
  JWT_SECRET: string;
}

const WEB_PATHS = new Set(['/', '/login', '/register', '/dashboard', '/keys', '/pricing', '/usage']);

function isWebPath(pathname: string): boolean {
  if (WEB_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/dashboard')) return true;
  return false;
}

// --- Crypto helpers ---
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(password);
  return computed === hash;
}

// --- JWT helpers ---
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function toBase64url(str: string): string {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(b64: string): string {
  return decodeURIComponent(escape(atob(b64.replace(/-/g, '+').replace(/_/g, '/'))));
}

async function signJWT(payload: object, secret: string): Promise<string> {
  const header = toBase64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = toBase64url(JSON.stringify(payload));
  const message = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return `${message}.${toHex(sig)}`;
}

async function verifyJWT(token: string, secret: string): Promise<any> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const message = `${header}.${body}`;
  // Re-sign and compare instead of using crypto.subtle.verify
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const expected = toHex(sig);
  if (signature !== expected) return null;
  const payload = JSON.parse(fromBase64url(body));
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}

// --- JSON response helper ---
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// --- LiteLLM API helper ---
async function litellmAPI(env: Env, path: string, options: RequestInit = {}) {
  const url = new URL(path, 'https://llm.techforliving.net');
  const resp = await fetch(url.toString(), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.LITELLM_MASTER_KEY}`,
      ...(options.headers as Record<string, string> || {}),
    },
  });
  return resp;
}

// --- Route handlers ---
async function handleRegister(request: Request, env: Env): Promise<Response> {
  const { email, password } = await request.json() as { email: string; password: string };
  if (!email || !password || password.length < 6) {
    return json({ error: 'Email and password (min 6 chars) required' }, 400);
  }

  // Check if user exists
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return json({ error: 'Email already registered' }, 409);
  }

  // Create user in LiteLLM
  const litellmResp = await litellmAPI(env, '/user/new', {
    method: 'POST',
    body: JSON.stringify({ user_email: email, user_role: 'internal_user', auto_create_key: true }),
  });
  const litellmData = await litellmResp.json() as any;
  if (!litellmResp.ok) {
    return json({ error: 'Failed to create user', details: litellmData }, 500);
  }

  // Store in D1
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, litellm_user_id) VALUES (?, ?, ?, ?)'
  ).bind(userId, email, passwordHash, litellmData.user_id).run();

  // Store the auto-generated key
  if (litellmData.key) {
    await env.DB.prepare(
      'INSERT INTO api_keys (id, user_id, litellm_key, key_alias) VALUES (?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, litellmData.key, 'default').run();
  }

  // Issue JWT
  const token = await signJWT({
    sub: userId,
    email,
    litellm_user_id: litellmData.user_id,
    exp: Math.floor(Date.now() / 1000) + 86400 * 30,
  }, env.JWT_SECRET);

  return json({
    token,
    user: { id: userId, email },
    litellm_key: litellmData.key || null,
  });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { email, password } = await request.json() as { email: string; password: string };
  if (!email || !password) {
    return json({ error: 'Email and password required' }, 400);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first() as any;
  if (!user) {
    return json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return json({ error: 'Invalid credentials' }, 401);
  }

  // Get user's keys from D1 + spend from LiteLLM
  const dbKeys = await env.DB.prepare('SELECT * FROM api_keys WHERE user_id = ?').bind(user.id).all();
  const keys = [];
  for (const k of dbKeys.results as any[]) {
    const infoResp = await litellmAPI(env, `/key/info?key=${k.litellm_key}`);
    const infoData = await infoResp.json() as any;
    keys.push({
      key: k.litellm_key,
      key_alias: k.key_alias,
      spend: infoData?.info?.spend || 0,
      max_budget: infoData?.info?.max_budget || null,
      expires: infoData?.info?.expires || null,
    });
  }

  const token = await signJWT({
    sub: user.id,
    email: user.email,
    litellm_user_id: user.litellm_user_id,
    exp: Math.floor(Date.now() / 1000) + 86400 * 30,
  }, env.JWT_SECRET);

  return json({
    token,
    user: { id: user.id, email: user.email },
    keys,
  });
}

async function handleGetKeys(request: Request, env: Env, payload: any): Promise<Response> {
  const dbKeys = await env.DB.prepare('SELECT * FROM api_keys WHERE user_id = ?').bind(payload.sub).all();
  const keys = [];
  for (const k of dbKeys.results as any[]) {
    const infoResp = await litellmAPI(env, `/key/info?key=${k.litellm_key}`);
    const infoData = await infoResp.json() as any;
    keys.push({
      key: k.litellm_key,
      key_alias: k.key_alias,
      spend: infoData?.info?.spend || 0,
      max_budget: infoData?.info?.max_budget || null,
      expires: infoData?.info?.expires || null,
      blocked: infoData?.info?.blocked || null,
    });
  }
  return json({ keys });
}

async function handleCreateKey(request: Request, env: Env, payload: any): Promise<Response> {
  const body = await request.json() as { key_alias?: string; max_budget?: number };
  const alias = body.key_alias || 'key-' + Date.now().toString(36);
  const resp = await litellmAPI(env, '/key/generate', {
    method: 'POST',
    body: JSON.stringify({
      user_id: payload.litellm_user_id,
      key_alias: alias,
      max_budget: body.max_budget || null,
    }),
  });
  const data = await resp.json() as any;
  if (resp.ok && data.key) {
    await env.DB.prepare(
      'INSERT INTO api_keys (id, user_id, litellm_key, key_alias) VALUES (?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), payload.sub, data.key, alias).run();
  }
  return json(data);
}

async function handleDeleteKey(request: Request, env: Env, payload: any): Promise<Response> {
  const { keys } = await request.json() as { keys: string[] };
  // Delete from LiteLLM
  await litellmAPI(env, '/key/delete', {
    method: 'POST',
    body: JSON.stringify({ keys }),
  });
  // Delete from D1
  for (const key of keys) {
    await env.DB.prepare('DELETE FROM api_keys WHERE litellm_key = ? AND user_id = ?').bind(key, payload.sub).run();
  }
  return json({ success: true });
}

async function handleGetUserInfo(env: Env, payload: any): Promise<Response> {
  const resp = await litellmAPI(env, `/user/info?user_id=${payload.litellm_user_id}`);
  const data = await resp.json();
  return json(data);
}

// --- Auth middleware ---
async function authenticate(request: Request, env: Env): Promise<any> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return verifyJWT(token, env.JWT_SECRET);
}

// --- Main handler ---
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // --- Web UI routes ---
    if (request.method === 'GET' && isWebPath(pathname)) {
      return new Response(SPA_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // --- Auth API routes ---
    if (pathname === '/api/register' && request.method === 'POST') {
      return handleRegister(request, env);
    }
    if (pathname === '/api/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    // --- Authenticated API routes ---
    if (pathname.startsWith('/api/')) {
      const payload = await authenticate(request, env);
      if (!payload) return json({ error: 'Unauthorized' }, 401);

      if (pathname === '/api/keys' && request.method === 'GET') {
        return handleGetKeys(request, env, payload);
      }
      if (pathname === '/api/keys' && request.method === 'POST') {
        return handleCreateKey(request, env, payload);
      }
      if (pathname === '/api/keys/delete' && request.method === 'POST') {
        return handleDeleteKey(request, env, payload);
      }
      if (pathname === '/api/user' && request.method === 'GET') {
        return handleGetUserInfo(env, payload);
      }
      return json({ error: 'Not found' }, 404);
    }

    // --- Proxy everything else to LiteLLM via tunnel ---
    return fetch(request);
  },
};
