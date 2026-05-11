import { verify } from 'jsonwebtoken';
import { AppContext, AppNext, AuthUser, Bindings } from '../types';

export type { AppContext, AppNext };

export async function authMiddleware(c: AppContext, next: AppNext) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const payload = verify(token, c.env.JWT_SECRET || 'dev-secret-change-me') as AuthUser;
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
