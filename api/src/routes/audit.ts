import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { authMiddleware, auditorMiddleware } from '../middleware/auth';

const audit = new Hono<{ Bindings: Bindings; Variables: Variables }>();
audit.use('*', authMiddleware);
audit.use('*', auditorMiddleware);

audit.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = (page - 1) * limit;
  const entityType = c.req.query('entity_type');
  const action = c.req.query('action');
  const entityId = c.req.query('entity_id');

  let query = 'SELECT al.*, u.name as user_name, u.email as user_email FROM audit_log al JOIN users u ON al.user_id = u.id WHERE al.user_id = ?';
  const params: any[] = [user.id];
  if (entityType) { query += ' AND al.entity_type = ?'; params.push(entityType); }
  if (action) { query += ' AND al.action = ?'; params.push(action); }
  if (entityId) { query += ' AND al.entity_id = ?'; params.push(entityId); }
  query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all();
  return c.json({ data: rows.results, page, limit });
});

audit.get('/summary', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const stats = await db.prepare(
    'SELECT action, entity_type, COUNT(*) as count FROM audit_log WHERE user_id = ? GROUP BY action, entity_type ORDER BY count DESC'
  ).bind(user.id).all();
  return c.json({ data: stats.results });
});

export { audit as auditRoutes };
