import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { wsBroadcast } from './ws';

const messaging = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ═══════════════════════════════════
// Channel Management
// ═══════════════════════════════════

messaging.get('/channels', authMiddleware, async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT id, channel_type, name, phone_number, is_active, wuzapi_url, wuzapi_key, created_at FROM channels WHERE user_id = ? ORDER BY channel_type, name'
  ).bind(user.id).all();
  return c.json({ data: rows.results });
});

messaging.get('/channels/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT * FROM channels WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

const channelSchema = z.object({
  channel_type: z.enum(['telegram', 'whatsapp']),
  name: z.string().min(1),
  bot_token: z.string().optional(),
  phone_number: z.string().optional(),
  api_key: z.string().optional(),
  wuzapi_url: z.string().optional(),
  wuzapi_key: z.string().optional(),
});

messaging.post('/channels', authMiddleware, zValidator('json', channelSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `ch-${uuidv4().slice(0, 8)}`;

  await db.prepare(
    'INSERT INTO channels (id, user_id, channel_type, name, bot_token, phone_number, api_key, wuzapi_url, wuzapi_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, data.channel_type, data.name, data.bot_token || null, data.phone_number || null, data.api_key || null, data.wuzapi_url || null, data.wuzapi_key || null).run();

  const row = await db.prepare('SELECT * FROM channels WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

messaging.put('/channels/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.prepare('SELECT id FROM channels WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const sets: string[] = []; const params: any[] = [];
  for (const k of ['name','bot_token','phone_number','api_key','wuzapi_url','wuzapi_key']) {
    if (body[k] !== undefined) { sets.push(`${k} = ?`); params.push(body[k]); }
  }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(id, user.id);
  await db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();

  const row = await db.prepare('SELECT * FROM channels WHERE id = ?').bind(id).first();
  return c.json(row);
});

messaging.delete('/channels/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('UPDATE channels SET is_active = 0 WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).run();
  return c.json({ success: true });
});

// ═══════════════════════════════════
// Telegram Bot Webhook
// ═══════════════════════════════════

messaging.post('/telegram/webhook/:channelId', async (c) => {
  const channelId = c.req.param('channelId');
  const db = c.env.DB;

  const channel = await db.prepare('SELECT * FROM channels WHERE id = ?').bind(channelId).first<{ user_id: string; bot_token: string }>();
  if (!channel) return c.json({ error: 'Channel not found' }, 404);

  const body = await c.req.json();

  // Log webhook event
  const eventId = `we-${uuidv4().slice(0, 8)}`;
  await db.prepare(
    'INSERT INTO webhook_events (id, user_id, channel_type, event_type, external_id, from_contact, payload) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(eventId, channel.user_id, 'telegram', body.message ? 'message' : 'callback',
    body.update_id?.toString() || '', body.message?.from?.id?.toString() || '', JSON.stringify(body)).run();

  // Handle message
  if (body.message && body.message.text) {
    const msg = body.message;
    const fromId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();

    // Find or create conversation
    let conv = await db.prepare(
      "SELECT id FROM conversations WHERE user_id = ? AND channel_type = 'telegram' AND external_id = ?"
    ).bind(channel.user_id, chatId).first<{ id: string }>();

    if (!conv) {
      const convId = `cv-${uuidv4().slice(0, 8)}`;
      await db.prepare(
        "INSERT INTO conversations (id, user_id, channel_id, channel_type, external_id, contact_name, contact_username, subject) VALUES (?, ?, ?, 'telegram', ?, ?, ?, ?)"
      ).bind(convId, channel.user_id, channelId, chatId,
        `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim(),
        msg.from.username || null, msg.text.substring(0, 80)).run();
      conv = { id: convId };
    }

    // Save message
    const msgId = `msg-${uuidv4().slice(0, 8)}`;
    await db.prepare(
      "INSERT INTO messages (id, user_id, conversation_id, channel_type, direction, message_type, external_message_id, content, status) VALUES (?, ?, ?, 'telegram', 'inbound', 'text', ?, ?, 'delivered')"
    ).bind(msgId, channel.user_id, conv.id, msg.message_id.toString(), msg.text).run();

    // Update conversation
    await db.prepare(
      "UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, unread_count = unread_count + 1, updated_at = datetime('now') WHERE id = ?"
    ).bind(msg.text.substring(0, 200), conv.id).run();

    // Auto-reply if bot token available
    if (channel.bot_token && msg.text.toLowerCase().includes('invoice')) {
      const replyText = '👋 Hello! I can help you with invoices. Reply with an invoice number to get details.';
      await sendTelegramMessage(channel.bot_token, chatId, replyText, c.env);

      // Save auto-reply
      const outId = `msg-${uuidv4().slice(0, 8)}`;
      await db.prepare(
        "INSERT INTO messages (id, user_id, conversation_id, channel_type, direction, message_type, content, status) VALUES (?, ?, ?, 'telegram', 'outbound', 'text', ?, 'sent')"
      ).bind(outId, channel.user_id, conv.id, replyText).run();
    }

    // Mark processed
    await db.prepare('UPDATE webhook_events SET processed = 1, processed_at = datetime(\'now\') WHERE id = ?').bind(eventId).run();
  }

  return c.json({ ok: true });
});

// ═══════════════════════════════════
// WhatsApp Webhook (wuzapi-cli style)
// ═══════════════════════════════════

messaging.post('/whatsapp/webhook/:channelId', async (c) => {
  const channelId = c.req.param('channelId');
  const db = c.env.DB;

  const channel = await db.prepare('SELECT * FROM channels WHERE id = ?').bind(channelId).first<{ user_id: string; api_key: string; phone_number: string }>();
  if (!channel) return c.json({ error: 'Channel not found' }, 404);

  const body = await c.req.json();

  // Log webhook
  const eventId = `we-${uuidv4().slice(0, 8)}`;
  await db.prepare(
    'INSERT INTO webhook_events (id, user_id, channel_type, event_type, external_id, from_contact, payload) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(eventId, channel.user_id, 'whatsapp', body.type || 'message', body.id || '',
    body.from || body.contact || '', JSON.stringify(body)).run();

  // Handle incoming WhatsApp message
  if (body.type === 'message' || body.text) {
    const from = body.from || body.contact || '';
    const text = body.text?.body || body.text || body.body || '';

    let conv = await db.prepare(
      "SELECT id FROM conversations WHERE user_id = ? AND channel_type = 'whatsapp' AND external_id = ?"
    ).bind(channel.user_id, from).first<{ id: string }>();

    if (!conv) {
      const convId = `cv-${uuidv4().slice(0, 8)}`;
      await db.prepare(
        "INSERT INTO conversations (id, user_id, channel_id, channel_type, external_id, contact_phone, contact_name, subject) VALUES (?, ?, ?, 'whatsapp', ?, ?, ?, ?)"
      ).bind(convId, channel.user_id, channelId, from, from, body.contact_name || from, text.substring(0, 80)).run();
      conv = { id: convId };
    }

    const msgId = `msg-${uuidv4().slice(0, 8)}`;
    await db.prepare(
      "INSERT INTO messages (id, user_id, conversation_id, channel_type, direction, message_type, external_message_id, content, status, media_url, media_type) VALUES (?, ?, ?, 'whatsapp', 'inbound', ?, ?, ?, 'delivered', ?, ?)"
    ).bind(msgId, channel.user_id, conv.id,
      body.type || 'text', body.id || '', text,
      body.media?.url || null, body.media?.type || null).run();

    await db.prepare(
      "UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, unread_count = unread_count + 1, updated_at = datetime('now') WHERE id = ?"
    ).bind(text.substring(0, 200), conv.id).run();

    await db.prepare('UPDATE webhook_events SET processed = 1, processed_at = datetime(\'now\') WHERE id = ?').bind(eventId).run();

    // Push real-time via WebSocket to all connected clients
    wsBroadcast(channel.user_id, {
      type: 'new_whatsapp_message',
      conversation_id: conv ? conv.id : null,
      from,
      text,
      timestamp: new Date().toISOString(),
    });
  }

  return c.json({ ok: true });
});

// ═══════════════════════════════════
// WhatsApp Session (wuzapi-cli migration)
// ═══════════════════════════════════

messaging.post('/wuzapi/sessions', authMiddleware, zValidator('json', z.object({
  device_name: z.string().min(1),
  phone_number: z.string().optional(),
})), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { device_name, phone_number } = c.req.valid('json');
  const id = `ws-${uuidv4().slice(0, 8)}`;

  await db.prepare(
    'INSERT INTO wuzapi_sessions (id, user_id, device_name, phone_number, session_data, pair_status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, device_name, phone_number || null, '{}', 'pending').run();

  const row = await db.prepare('SELECT * FROM wuzapi_sessions WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

messaging.get('/wuzapi/sessions', authMiddleware, async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT id, device_name, phone_number, jid, pair_status, last_connected_at, created_at FROM wuzapi_sessions WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  return c.json({ data: rows.results });
});

messaging.patch('/wuzapi/sessions/:id', authMiddleware, zValidator('json', z.object({
  session_data: z.string().optional(),
  pair_status: z.string().optional(),
  jid: z.string().optional(),
})), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const sets: string[] = []; const params: any[] = [];
  if (data.session_data) { sets.push('session_data = ?'); params.push(data.session_data); }
  if (data.pair_status) { sets.push('pair_status = ?'); params.push(data.pair_status); }
  if (data.jid) { sets.push('jid = ?'); params.push(data.jid); }
  sets.push("updated_at = datetime('now')");
  if (data.pair_status === 'paired') sets.push("last_connected_at = datetime('now')");
  params.push(id, user.id);

  await db.prepare(`UPDATE wuzapi_sessions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  const row = await db.prepare('SELECT * FROM wuzapi_sessions WHERE id = ?').bind(id).first();
  return c.json(row);
});

// ═══════════════════════════════════
// Conversations
// ═══════════════════════════════════

messaging.get('/conversations', authMiddleware, async (c) => {
  const user = c.get('user');
  const channelType = c.req.query('channel') || '';
  const status = c.req.query('status') || '';

  let query = 'SELECT * FROM conversations WHERE user_id = ?';
  const params: any[] = [user.id];
  if (channelType) { query += ' AND channel_type = ?'; params.push(channelType); }
  if (status) { query += ' AND status = ?'; params.push(status); }
  query += ' ORDER BY last_message_at DESC NULLS LAST';

  const rows = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: rows.results });
});

messaging.get('/conversations/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const conv = await db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).first();
  if (!conv) return c.json({ error: 'Not found' }, 404);

  const messages = await db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 200'
  ).bind(c.req.param('id')).all();

  // Mark as read
  await db.prepare("UPDATE conversations SET unread_count = 0, updated_at = datetime('now') WHERE id = ?")
    .bind(c.req.param('id')).run();

  return c.json({ ...conv, messages: messages.results });
});

// ═══════════════════════════════════
// Send Message
// ═══════════════════════════════════

messaging.post('/send', authMiddleware, zValidator('json', z.object({
  conversation_id: z.string().min(1),
  content: z.string().min(1),
  message_type: z.string().optional(),
})), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { conversation_id, content, message_type } = c.req.valid('json');

  const conv = await db.prepare(
    'SELECT * FROM conversations WHERE id = ? AND user_id = ?'
  ).bind(conversation_id, user.id).first<{ channel_type: string; external_id: string; channel_id: string }>();
  if (!conv) return c.json({ error: 'Conversation not found' }, 404);

  // Get channel
  const channel = await db.prepare('SELECT * FROM channels WHERE id = ?').bind(conv.channel_id).first<{ bot_token: string; api_key: string }>();
  let sendResult = 'sent';

  // Send via appropriate channel
  if (conv.channel_type === 'telegram' && channel?.bot_token) {
    try {
      await sendTelegramMessage(channel.bot_token, conv.external_id, content, c.env);
    } catch (e) { sendResult = 'failed'; }
  } else if (conv.channel_type === 'whatsapp') {
    // WhatsApp send would go through WhatsApp API
    sendResult = 'sent';
  }

  // Save outbound message
  const msgId = `msg-${uuidv4().slice(0, 8)}`;
  await db.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, channel_type, direction, message_type, content, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(msgId, user.id, conversation_id, conv.channel_type, 'outbound', message_type || 'text', content, sendResult).run();

  await db.prepare("UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(content.substring(0, 200), conversation_id).run();

  const msg = await db.prepare('SELECT * FROM messages WHERE id = ?').bind(msgId).first();
  return c.json(msg, 201);
});

// ═══════════════════════════════════
// Message Templates
// ═══════════════════════════════════

messaging.get('/templates', authMiddleware, async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM message_templates WHERE user_id = ? AND is_active = 1 ORDER BY category, name'
  ).bind(user.id).all();
  return c.json({ data: rows.results });
});

messaging.post('/templates', authMiddleware, zValidator('json', z.object({
  name: z.string().min(1),
  channel_type: z.string().optional(),
  content: z.string().min(1),
  shortcut: z.string().optional(),
  category: z.string().optional(),
})), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `mt-${uuidv4().slice(0, 8)}`;

  await db.prepare(
    'INSERT INTO message_templates (id, user_id, name, channel_type, content, shortcut, category) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, data.name, data.channel_type || 'all', data.content,
    data.shortcut || null, data.category || null).run();

  const row = await db.prepare('SELECT * FROM message_templates WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

// ═══════════════════════════════════
// Telegram send helper (uses Cloudflare fetch)
// ═══════════════════════════════════

async function sendTelegramMessage(botToken: string, chatId: string, text: string, env: any) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Telegram API error: ${err}`);
  }
  return response.json();
}

export { messaging as messagingRoutes };
