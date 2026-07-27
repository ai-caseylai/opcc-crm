import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware, bookkeeperMiddleware } from '../middleware/auth';

const assets = new Hono<{ Bindings: Bindings; Variables: Variables }>();
assets.use('*', authMiddleware);

// List all fixed assets
assets.get('/', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const rows = await c.env.DB.prepare(
    'SELECT * FROM fixed_assets WHERE user_id = ? ORDER BY purchase_date DESC'
  ).bind(tenantId).all();
  return c.json({ data: rows.results });
});

// Get single asset
assets.get('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const row = await c.env.DB.prepare(
    'SELECT * FROM fixed_assets WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), tenantId).first();
  if (!row) return c.json({ error: 'Asset not found' }, 404);
  return c.json(row);
});

// Add a fixed asset
assets.post('/', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();
  const { asset_name, asset_code, category, purchase_date, cost, useful_life_years, salvage_value,
    account_code, depn_account_code, acc_depn_account_code, notes } = body;

  if (!asset_name || !purchase_date || !cost) return c.json({ error: 'asset_name, purchase_date, cost required' }, 400);

  const usefulLife = useful_life_years || 5;
  const salvage = salvage_value || 0;
  const depreciableAmount = cost - salvage;
  const monthlyDepn = usefulLife > 0 ? Math.round((depreciableAmount / (usefulLife * 12)) * 100) / 100 : 0;

  const id = `fa-${uuidv4().slice(0, 8)}`;
  await db.prepare(
    `INSERT INTO fixed_assets (id, user_id, asset_name, asset_code, category, purchase_date, cost,
     useful_life_years, salvage_value, depreciation_method, monthly_depreciation, accumulated_depreciation,
     net_book_value, account_code, depn_account_code, acc_depn_account_code, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, tenantId, asset_name, asset_code || null, category || 'office_equipment', purchase_date,
    cost, usefulLife, salvage, 'straight_line', monthlyDepn, 0,
    cost, account_code || '12201', depn_account_code || '66101', acc_depn_account_code || '12301',
    notes || null).run();

  const row = await db.prepare('SELECT * FROM fixed_assets WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

// Update an asset
assets.patch('/:id', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();

  const existing = await db.prepare('SELECT * FROM fixed_assets WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).first();
  if (!existing) return c.json({ error: 'Asset not found' }, 404);

  const fields = ['asset_name', 'category', 'useful_life_years', 'salvage_value', 'is_active',
    'account_code', 'depn_account_code', 'acc_depn_account_code', 'notes', 'disposal_date', 'disposal_amount'];
  const sets: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (fields.includes(k)) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(c.req.param('id'), tenantId);

  await db.prepare(`UPDATE fixed_assets SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...params).run();

  const row = await db.prepare('SELECT * FROM fixed_assets WHERE id = ?').bind(c.req.param('id')).first();
  return c.json(row);
});

// Delete an asset
assets.delete('/:id', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const existing = await c.env.DB.prepare('SELECT id FROM fixed_assets WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).first();
  if (!existing) return c.json({ error: 'Asset not found' }, 404);
  await c.env.DB.prepare('DELETE FROM fixed_assets WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).run();
  return c.json({ success: true });
});

// Run monthly depreciation for all active assets (creates journal entries)
assets.post('/run-depreciation', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();
  const { period_end_date } = body; // e.g. '2026-03-31'
  if (!period_end_date) return c.json({ error: 'period_end_date required' }, 400);

  const activeAssets = await db.prepare(
    'SELECT * FROM fixed_assets WHERE user_id = ? AND is_active = 1 AND monthly_depreciation > 0 AND net_book_value > salvage_value'
  ).bind(tenantId).all();

  if (activeAssets.results.length === 0) return c.json({ message: 'No active depreciable assets' }, 200);

  // Create one journal entry with all depreciation lines
  const jeId = `je-${uuidv4().slice(0, 8)}`;
  const jeNum = `JE-DEPN-${period_end_date.slice(0, 7)}`;
  await db.prepare(
    'INSERT INTO journal_entries (id, user_id, entry_number, entry_date, description, reference_type) VALUES (?,?,?,?,?,?)'
  ).bind(jeId, tenantId, jeNum, period_end_date, `Monthly depreciation ${period_end_date.slice(0,7)}`, 'depreciation').run();

  let sortOrder = 0;
  let totalDepn = 0;
  for (const asset of activeAssets.results as any[]) {
    const monthlyDepn = asset.monthly_depreciation;
    const remainingBook = asset.net_book_value - (asset.salvage_value || 0);
    const actualDepn = Math.min(monthlyDepn, Math.max(remainingBook, 0));
    if (actualDepn <= 0) continue;

    // Dr Depreciation Expense
    await db.prepare(
      'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, asset.depn_account_code || '66101', asset.asset_name,
      `Depreciation: ${asset.asset_name}`, actualDepn, 0, sortOrder++).run();

    // Cr Accumulated Depreciation
    await db.prepare(
      'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, asset.acc_depn_account_code || '12301', asset.asset_name,
      `Accum depn: ${asset.asset_name}`, 0, actualDepn, sortOrder++).run();

    // Update asset
    const newAccDepn = (asset.accumulated_depreciation || 0) + actualDepn;
    const newNBV = asset.cost - newAccDepn;
    await db.prepare(
      'UPDATE fixed_assets SET accumulated_depreciation = ?, net_book_value = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(newAccDepn, newNBV, asset.id).run();

    totalDepn += actualDepn;
  }

  if (totalDepn === 0) return c.json({ message: 'No depreciation needed (all assets fully depreciated)' }, 200);

  return c.json({
    entry_id: jeId, entry_number: jeNum, period_end_date,
    assets_depreciated: activeAssets.results.length, total_depreciation: Math.round(totalDepn * 100) / 100,
  }, 201);
});

export { assets as fixedAssetRoutes };
