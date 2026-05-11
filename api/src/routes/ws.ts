import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/cloudflare-workers';
import { verify as jwtVerify } from 'jsonwebtoken';
import { Bindings, Variables } from '../types';

const ws = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// In-memory connection pool (per Worker instance, shared across requests)
const clients = new Map<string, Set<WebSocket>>();

function broadcast(userId: string, data: any) {
  const sockets = clients.get(userId);
  if (!sockets) return;
  const msg = JSON.stringify(data);
  for (const ws of sockets) {
    try { ws.send(msg); } catch { sockets.delete(ws); }
  }
}

// ── WebSocket endpoint ──
ws.get('/', upgradeWebSocket((c) => {
  let userId = '';
  let wuConfig: { base_url?: string; token?: string } = {};

  return {
    async onOpen(evt, ws) {
      // Authenticate via query param JWT
      const url = new URL(c.req.url);
      const token = url.searchParams.get('token') || '';
      try {
        const payload = jwtVerify(token, c.env.JWT_SECRET || 'dev-secret-change-me') as { id: string };
        userId = payload.id;

        // Track connection
        if (!clients.has(userId)) clients.set(userId, new Set());
        clients.get(userId)!.add(ws.raw!);

        // Get WUZAPI config for this user
        const row = await c.env.DB.prepare(
          'SELECT wuzapi_url, wuzapi_key FROM channels WHERE user_id = ? AND channel_type = ? AND is_active = 1 LIMIT 1'
        ).bind(userId, 'whatsapp').first<{ wuzapi_url: string; wuzapi_key: string }>();
        if (row) {
          wuConfig = { base_url: row.wuzapi_url, token: row.wuzapi_key };
        }

        ws.send(JSON.stringify({ type: 'connected', userId, hasWuzapi: !!wuConfig.base_url }));
      } catch {
        ws.close(4001, 'Invalid token');
      }
    },

    async onMessage(evt, ws) {
      if (!userId) return;
      try {
        const msg = JSON.parse(evt.data.toString());

        switch (msg.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          case 'send_whatsapp':
            // Forward to WUZAPI-CLI
            if (!wuConfig.base_url) {
              ws.send(JSON.stringify({ type: 'error', error: 'WUZAPI not configured' }));
              return;
            }
            try {
              const wuRes = await fetch(`${wuConfig.base_url}/message/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${wuConfig.token}` },
                body: JSON.stringify({ to: msg.to, text: msg.text }),
              });
              const wuData: any = await wuRes.json();
              ws.send(JSON.stringify({ type: 'sent', ref: msg.ref, result: wuData }));
            } catch (e: any) {
              ws.send(JSON.stringify({ type: 'error', error: e.message, ref: msg.ref }));
            }
            break;

          case 'typing':
            // Broadcast typing indicator to other tabs/sessions
            broadcast(userId, { type: 'typing', from: msg.from });
            break;

          default:
            // Generic message broadcast
            broadcast(userId, { type: 'message', data: msg });
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
      }
    },

    onClose(evt, ws) {
      if (userId && clients.has(userId)) {
        clients.get(userId)!.delete(ws.raw!);
        if (clients.get(userId)!.size === 0) clients.delete(userId);
      }
    },

    onError(evt, ws) {
      if (userId && clients.has(userId)) {
        clients.get(userId)!.delete(ws.raw!);
      }
    },
  };
}));

// ── REST endpoint to push message to all connected clients ──
// Called by WUZAPI webhook or other services
ws.post('/push', async (c) => {
  const body = await c.req.json();
  const { user_id, type, data } = body;
  if (!user_id) return c.json({ error: 'user_id required' }, 400);

  broadcast(user_id, { type: type || 'push', data });
  return c.json({ sent: clients.has(user_id) });
});

// ── REST endpoint: check active connections ──
ws.get('/status', (c) => {
  const stats: Record<string, number> = {};
  for (const [uid, socks] of clients) stats[uid] = socks.size;
  return c.json({ connections: clients.size, users: Object.keys(stats).length, details: stats });
});

export { ws as wsRoutes, broadcast as wsBroadcast };
