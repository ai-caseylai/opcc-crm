import { verify } from 'jsonwebtoken';
import { AppContext, AppNext, AuthUser, Bindings } from '../types';

export type { AppContext, AppNext };

// Fail-fast if JWT_SECRET is not configured (never fall back to hardcoded secret)
export function getJwtSecret(env: Bindings): string {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not configured');
  return env.JWT_SECRET;
}

export async function authMiddleware(c: AppContext, next: AppNext) {
  let token: string | undefined;

  // Read from httpOnly cookie first (XSS-safe), then Authorization header
  const cookieHeader = c.req.header('Cookie') || '';
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
  if (cookieMatch) {
    token = cookieMatch[1];
  } else {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  try {
    const payload = verify(token, getJwtSecret(c.env)) as AuthUser;
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}

export async function adminMiddleware(c: AppContext, next: AppNext) {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
}

export async function auditorMiddleware(c: AppContext, next: AppNext) {
  const user = c.get('user');
  if (!user || (user.role !== 'admin' && user.role !== 'auditor')) {
    return c.json({ error: 'Auditor or admin access required' }, 403);
  }
  await next();
}

// Bookkeeper/accountant write access — blocks auditor (read-only) role
export async function bookkeeperMiddleware(c: AppContext, next: AppNext) {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Authentication required' }, 401);
  if (user.role === 'auditor') {
    return c.json({ error: 'Auditor role is read-only. Write operations require bookkeeper or admin access.' }, 403);
  }
  await next();
}

// Validates X-Active-Client header for firm staff, sets client_user_id context
export async function firmContextMiddleware(c: AppContext, next: AppNext) {
  const user = c.get('user');
  if (!user?.firm_id) { await next(); return; }

  const activeClientId = c.req.header('X-Active-Client');
  if (!activeClientId) { await next(); return; }

  const db = c.env.DB;

  if (user.firm_role === 'admin') {
    const client = await db.prepare(
      'SELECT client_user_id FROM firm_clients WHERE firm_id = ? AND id = ? AND status = ?'
    ).bind(user.firm_id, activeClientId, 'active').first<{ client_user_id: string }>();
    if (!client) return c.json({ error: 'Client not found' }, 403);
    c.set('client_user_id', client.client_user_id);
  } else {
    const assignment = await db.prepare(
      `SELECT fc.client_user_id FROM firm_clients fc
       JOIN firm_client_assignments fca ON fca.firm_client_id = fc.id
       JOIN firm_members fm ON fm.id = fca.firm_member_id
       WHERE fm.user_id = ? AND fm.firm_id = ? AND fc.id = ? AND fc.status = ? AND fm.is_active = 1`
    ).bind(user.id, user.firm_id, activeClientId, 'active').first<{ client_user_id: string }>();
    if (!assignment) return c.json({ error: 'Access to this client denied' }, 403);
    c.set('client_user_id', assignment.client_user_id);
  }

  await next();
}
