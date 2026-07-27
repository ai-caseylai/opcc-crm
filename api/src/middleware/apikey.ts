import { AppContext, AppNext } from '../types';
import { createHash } from 'crypto';

/**
 * WorkBuddy API Key authentication — checks X-API-Key header
 * against workbuddy_config table. Does NOT use JWT.
 */
export async function apiKeyAuth(c: AppContext, next: AppNext) {
  const apiKey = c.req.header('X-API-Key');
  if (!apiKey) {
    return c.json({ error: 'X-API-Key header required' }, 401);
  }

  // Look up plain-text API key in workbuddy_config
  const row = await c.env.DB.prepare(
    'SELECT wc.*, u.id as user_id, u.email, u.name, u.role FROM workbuddy_config wc JOIN users u ON wc.user_id = u.id WHERE wc.api_key = ? AND wc.enabled = 1'
  ).bind(apiKey).first<{ user_id: string; email: string; name: string; role: string }>();

  if (!row) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  c.set('user', { id: row.user_id, email: row.email, name: row.name, role: row.role });
  await next();
}
