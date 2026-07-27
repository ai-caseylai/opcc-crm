import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const audit = new Hono<{ Bindings: Bindings; Variables: Variables }>();
audit.use('*', authMiddleware);

audit.get('/', async (c) => {
  const user = c.get('user') as any;
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;

  // Only supervisor, accountant, admin can view audit log
  if (['staff', 'viewer'].includes(user.role)) {
    return c.json({ error: 'Access denied. Audit log is restricted to supervisors and accountants.' }, 403);
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const action = c.req.query('action');

  let query = `SELECT al.*, u.name as user_name, u.email as user_email
               FROM audit_log al
               JOIN users u ON al.user_id = u.id
               WHERE (al.user_id = ? OR u.parent_user_id = ?)`;
  const params: any[] = [tenantId, tenantId];

  if (action) { query += ' AND al.action = ?'; params.push(action); }

  // Count total
  let countQuery = `SELECT COUNT(*) as cnt FROM audit_log al JOIN users u ON al.user_id = u.id
                    WHERE (al.user_id = ? OR u.parent_user_id = ?)`;
  const countParams: any[] = [tenantId, tenantId];
  if (action) { countQuery += ' AND al.action = ?'; countParams.push(action); }

  query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const [rows, countRow] = await Promise.all([
    db.prepare(query).bind(...params).all(),
    db.prepare(countQuery).bind(...countParams).first<{ cnt: number }>(),
  ]);

  return c.json({
    entries: rows.results,
    total: countRow?.cnt || 0,
    limit,
    offset,
  });
});

export { audit as auditRoutes };

