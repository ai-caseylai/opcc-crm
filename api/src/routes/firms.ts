import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { hash } from 'bcryptjs';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const firms = new Hono<{ Bindings: Bindings; Variables: Variables }>();
firms.use('*', authMiddleware);

// GET /api/firms/my — current user's firm info + all accessible clients
firms.get('/my', async (c) => {
  const user = c.get('user');
  if (!user.firm_id) return c.json({ error: 'Not a firm member' }, 404);

  const firm = await c.env.DB.prepare(
    'SELECT id, name, owner_user_id, created_at FROM firms WHERE id = ?'
  ).bind(user.firm_id).first();
  if (!firm) return c.json({ error: 'Firm not found' }, 404);

  let clients;
  if (user.firm_role === 'admin') {
    clients = await c.env.DB.prepare(
      `SELECT fc.id, fc.client_user_id, fc.display_name, fc.status, u.company_name, u.name as user_name, u.email
       FROM firm_clients fc JOIN users u ON u.id = fc.client_user_id
       WHERE fc.firm_id = ? ORDER BY fc.created_at DESC`
    ).bind(user.firm_id).all();
  } else {
    clients = await c.env.DB.prepare(
      `SELECT fc.id, fc.client_user_id, fc.display_name, fc.status, u.company_name, u.name as user_name, u.email
       FROM firm_clients fc
       JOIN firm_client_assignments fca ON fca.firm_client_id = fc.id
       JOIN firm_members fm ON fm.id = fca.firm_member_id
       JOIN users u ON u.id = fc.client_user_id
       WHERE fm.user_id = ? AND fm.firm_id = ? AND fc.status = 'active' AND fm.is_active = 1
       ORDER BY fc.created_at DESC`
    ).bind(user.id, user.firm_id).all();
  }

  return c.json({ firm, clients: clients.results, my_role: user.firm_role });
});

// GET /api/firms/my-clients — list of accessible client IDs (lightweight)
firms.get('/my-clients', async (c) => {
  const user = c.get('user');
  if (!user.firm_id) return c.json({ data: [] });

  let rows;
  if (user.firm_role === 'admin') {
    rows = await c.env.DB.prepare(
      'SELECT id, client_user_id, display_name, status FROM firm_clients WHERE firm_id = ? AND status = ? ORDER BY created_at DESC'
    ).bind(user.firm_id, 'active').all();
  } else {
    rows = await c.env.DB.prepare(
      `SELECT fc.id, fc.client_user_id, fc.display_name, fc.status
       FROM firm_clients fc
       JOIN firm_client_assignments fca ON fca.firm_client_id = fc.id
       JOIN firm_members fm ON fm.id = fca.firm_member_id
       WHERE fm.user_id = ? AND fm.firm_id = ? AND fc.status = ? AND fm.is_active = 1
       ORDER BY fc.created_at DESC`
    ).bind(user.id, user.firm_id, 'active').all();
  }

  return c.json({ data: rows.results });
});

// GET /api/firms/:id/members — list staff members (firm admin only)
firms.get('/:id/members', async (c) => {
  const user = c.get('user');
  if (!user.firm_id || user.firm_id !== c.req.param('id')) return c.json({ error: 'Access denied' }, 403);

  const rows = await c.env.DB.prepare(
    `SELECT fm.id, fm.user_id, fm.role, fm.is_active, fm.created_at, u.email, u.name
     FROM firm_members fm JOIN users u ON u.id = fm.user_id
     WHERE fm.firm_id = ? ORDER BY fm.created_at DESC`
  ).bind(user.firm_id).all();

  return c.json({ data: rows.results });
});

// POST /api/firms/:id/members — add staff member
firms.post('/:id/members', async (c) => {
  const user = c.get('user');
  if (!user.firm_id || user.firm_id !== c.req.param('id') || user.firm_role !== 'admin') {
    return c.json({ error: 'Access denied' }, 403);
  }

  const body = await c.req.json();
  const { email, role, password, name } = body as { email: string; role?: string; password?: string; name?: string };
  if (!email) return c.json({ error: 'email required' }, 400);

  // Find or create user
  let memberUser = await c.env.DB.prepare(
    'SELECT id, email, name FROM users WHERE email = ?'
  ).bind(email).first<{ id: string; email: string; name: string }>();
  let createdPassword: string | null = null;

  if (!memberUser) {
    const id = `u-${uuidv4().slice(0, 8)}`;
    createdPassword = password || uuidv4().slice(0, 12);
    const passwordHash = await hash(createdPassword, 10);
    const displayName = name || email.split('@')[0];
    await c.env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, email, passwordHash, displayName, 'user').run();
    memberUser = { id, email, name: displayName };
  } else if (password) {
    // Update password for existing user
    const passwordHash = await hash(password, 10);
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, memberUser.id).run();
    createdPassword = password;
  }

  // Check if already a member
  const existing = await c.env.DB.prepare(
    'SELECT id FROM firm_members WHERE firm_id = ? AND user_id = ?'
  ).bind(user.firm_id, memberUser.id).first();
  if (existing) return c.json({ error: 'Already a member of this firm' }, 409);

  const memberId = `fm-${uuidv4().slice(0, 8)}`;
  await c.env.DB.prepare(
    'INSERT INTO firm_members (id, firm_id, user_id, role) VALUES (?, ?, ?, ?)'
  ).bind(memberId, user.firm_id, memberUser.id, role || 'staff').run();

  return c.json({ id: memberId, user_id: memberUser.id, email: memberUser.email, name: memberUser.name, role: role || 'staff', ...(createdPassword ? { password: createdPassword } : {}) }, 201);
});

// DELETE /api/firms/:id/members/:mid — permanently delete staff member and user account
firms.delete('/:id/members/:mid', async (c) => {
  const user = c.get('user');
  if (!user.firm_id || user.firm_id !== c.req.param('id') || user.firm_role !== 'admin') {
    return c.json({ error: 'Access denied' }, 403);
  }
  // Get user_id before deleting
  const member = await c.env.DB.prepare(
    'SELECT user_id FROM firm_members WHERE id = ? AND firm_id = ?'
  ).bind(c.req.param('mid'), user.firm_id).first<{ user_id: string }>();
  if (!member) return c.json({ error: 'Member not found' }, 404);
  // Don't allow deleting yourself
  if (member.user_id === user.id) return c.json({ error: 'Cannot delete yourself' }, 400);
  // Delete from firm_members
  await c.env.DB.prepare('DELETE FROM firm_members WHERE id = ? AND firm_id = ?')
    .bind(c.req.param('mid'), user.firm_id).run();
  // Delete assignments
  await c.env.DB.prepare('DELETE FROM firm_client_assignments WHERE firm_member_id = ?')
    .bind(c.req.param('mid')).run();
  // Delete user account
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(member.user_id).run();
  return c.json({ success: true, deleted_user_id: member.user_id });
});

// PATCH /api/firms/:id/members/:mid — toggle active/inactive or update role
firms.patch('/:id/members/:mid', async (c) => {
  const user = c.get('user');
  if (!user.firm_id || user.firm_id !== c.req.param('id') || user.firm_role !== 'admin') {
    return c.json({ error: 'Access denied' }, 403);
  }
  const body = await c.req.json();
  const sets: string[] = [];
  const params: any[] = [];
  if (body.is_active !== undefined) { sets.push('is_active = ?'); params.push(body.is_active ? 1 : 0); }
  if (body.role) { sets.push('role = ?'); params.push(body.role); }
  if (body.name) {
    const member = await c.env.DB.prepare('SELECT user_id FROM firm_members WHERE id = ? AND firm_id = ?')
      .bind(c.req.param('mid'), user.firm_id).first<{ user_id: string }>();
    if (member) await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(body.name, member.user_id).run();
  }
  if (sets.length === 0 && !body.name) return c.json({ error: 'No fields to update' }, 400);
  if (sets.length > 0) {
    params.push(c.req.param('mid'), user.firm_id);
    await c.env.DB.prepare(`UPDATE firm_members SET ${sets.join(', ')} WHERE id = ? AND firm_id = ?`).bind(...params).run();
  }
  return c.json({ success: true });
});

// PATCH /api/firms/:id/members/:mid/password — change login password
firms.patch('/:id/members/:mid/password', async (c) => {
  const user = c.get('user');
  if (!user.firm_id || user.firm_id !== c.req.param('id') || user.firm_role !== 'admin') {
    return c.json({ error: 'Access denied' }, 403);
  }
  const body = await c.req.json();
  const { password } = body;
  if (!password || password.length < 4) return c.json({ error: 'Password must be at least 4 characters' }, 400);
  // Get the user_id from firm_members
  const member = await c.env.DB.prepare('SELECT user_id FROM firm_members WHERE id = ? AND firm_id = ?')
    .bind(c.req.param('mid'), user.firm_id).first<{ user_id: string }>();
  if (!member) return c.json({ error: 'Member not found' }, 404);
  const pwHash = await hash(password, 10);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(pwHash, member.user_id).run();
  return c.json({ success: true });
});

// GET /api/firms/:id/clients — list clients (firm admin only)
firms.get('/:id/clients', async (c) => {
  const user = c.get('user');
  if (!user.firm_id || user.firm_id !== c.req.param('id')) return c.json({ error: 'Access denied' }, 403);

  const rows = await c.env.DB.prepare(
    `SELECT fc.id, fc.client_user_id, fc.display_name, fc.status, fc.created_at,
            u.company_name, u.name as user_name, u.email
     FROM firm_clients fc JOIN users u ON u.id = fc.client_user_id
     WHERE fc.firm_id = ? ORDER BY fc.created_at DESC`
  ).bind(user.firm_id).all();

  return c.json({ data: rows.results });
});

// POST /api/firms/:id/clients — add client (creates user + company_settings + firm_clients)
firms.post('/:id/clients', async (c) => {
  const user = c.get('user');
  if (!user.firm_id || user.firm_id !== c.req.param('id') || user.firm_role !== 'admin') {
    return c.json({ error: 'Access denied' }, 403);
  }

  const body = await c.req.json();
  const { company_name, email, display_name } = body as { company_name: string; email: string; display_name?: string };
  if (!company_name || !email) return c.json({ error: 'company_name and email required' }, 400);

  // Create user for the client company
  const clientUserId = `u-${uuidv4().slice(0, 8)}`;
  const tempPassword = uuidv4().slice(0, 12);
  const passwordHash = await hash(tempPassword, 10);
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, name, company_name, role) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(clientUserId, email, passwordHash, company_name, company_name, 'user').run();

  // Create company_settings
  await c.env.DB.prepare(
    `INSERT INTO company_settings (user_id, name, legal_name)
     VALUES (?, ?, ?)`
  ).bind(clientUserId, company_name, company_name).run();

  // Link to firm
  const firmClientId = `fc-${uuidv4().slice(0, 8)}`;
  await c.env.DB.prepare(
    'INSERT INTO firm_clients (id, firm_id, client_user_id, display_name) VALUES (?, ?, ?, ?)'
  ).bind(firmClientId, user.firm_id, clientUserId, display_name || null).run();

  // Seed compliance records for the new client
  const templates = await c.env.DB.prepare('SELECT id FROM compliance_templates WHERE is_required = 1').all();
  for (const t of templates.results as any[]) {
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO member_compliance (id, user_id, template_id, status) VALUES (?, ?, ?, ?)'
    ).bind(`mc-${uuidv4().slice(0, 8)}`, clientUserId, t.id, 'pending').run();
  }

  // Copy chart of accounts — prefer canonical COA (from u-hayson seed), fallback to admin's
  const canonicalAccounts = await c.env.DB.prepare(
    "SELECT account_code, account_name, account_type, parent_code, opening_balance FROM accounts WHERE user_id = 'u-hayson'"
  ).all();
  const sourceAccounts = canonicalAccounts.results.length > 0 ? canonicalAccounts.results
    : (await c.env.DB.prepare(
      'SELECT account_code, account_name, account_type, parent_code, opening_balance FROM accounts WHERE user_id = ?'
    ).bind(user.id).all()).results;

  if (sourceAccounts.length > 0) {
    for (const a of sourceAccounts as any[]) {
      await c.env.DB.prepare(
        'INSERT OR IGNORE INTO accounts (id, user_id, account_code, account_name, account_type, parent_code, opening_balance) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(`acc-${uuidv4().slice(0, 8)}`, clientUserId, a.account_code, a.account_name, a.account_type, a.parent_code || null, a.opening_balance || 0).run();
    }
  }

  return c.json({
    id: firmClientId,
    client_user_id: clientUserId,
    company_name,
    email,
    display_name: display_name || null,
  }, 201);
});

// PATCH /api/firms/:id/clients/:cid — update client (archive/restore)
firms.patch('/:id/clients/:cid', async (c) => {
  const user = c.get('user');
  if (!user.firm_id || user.firm_id !== c.req.param('id') || user.firm_role !== 'admin') {
    return c.json({ error: 'Access denied' }, 403);
  }

  const body = await c.req.json();
  const { status, display_name } = body as { status?: string; display_name?: string };

  const sets: string[] = [];
  const params: any[] = [];
  if (status) { sets.push('status = ?'); params.push(status); }
  if (display_name !== undefined) { sets.push('display_name = ?'); params.push(display_name); }
  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);

  params.push(c.req.param('cid'), user.firm_id);
  await c.env.DB.prepare(
    `UPDATE firm_clients SET ${sets.join(', ')} WHERE id = ? AND firm_id = ?`
  ).bind(...params).run();

  return c.json({ success: true });
});

// GET /api/firms/:id/assignments — list all staff-to-client assignments
firms.get('/:id/assignments', async (c) => {
  const user = c.get('user');
  if (!user.firm_id || user.firm_id !== c.req.param('id') || user.firm_role !== 'admin') {
    return c.json({ error: 'Access denied' }, 403);
  }

  const rows = await c.env.DB.prepare(
    `SELECT fca.id, fca.firm_member_id, fca.firm_client_id, fm.user_id as staff_user_id, u.email as staff_email, u.name as staff_name
     FROM firm_client_assignments fca
     JOIN firm_members fm ON fm.id = fca.firm_member_id
     JOIN users u ON u.id = fm.user_id
     WHERE fm.firm_id = ?`
  ).bind(user.firm_id).all();

  return c.json({ data: rows.results });
});

// POST /api/firms/:id/assignments — bulk update assignments for a member
firms.post('/:id/assignments', async (c) => {
  const user = c.get('user');
  if (!user.firm_id || user.firm_id !== c.req.param('id') || user.firm_role !== 'admin') {
    return c.json({ error: 'Access denied' }, 403);
  }

  const body = await c.req.json();
  const { firm_member_id, firm_client_ids } = body as { firm_member_id: string; firm_client_ids: string[] };

  if (!firm_member_id || !Array.isArray(firm_client_ids)) {
    return c.json({ error: 'firm_member_id and firm_client_ids[] required' }, 400);
  }

  // Delete existing assignments for this member
  await c.env.DB.prepare(
    'DELETE FROM firm_client_assignments WHERE firm_member_id = ?'
  ).bind(firm_member_id).run();

  // Insert new assignments
  for (const cid of firm_client_ids) {
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO firm_client_assignments (id, firm_member_id, firm_client_id) VALUES (?, ?, ?)'
    ).bind(`fca-${uuidv4().slice(0, 8)}`, firm_member_id, cid).run();
  }

  return c.json({ success: true, assigned: firm_client_ids.length });
});

export { firms as firmRoutes };
