import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const files = new Hono<{ Bindings: Bindings; Variables: Variables }>();
files.use('*', authMiddleware);

// List files with optional folder filter and search
files.get('/', async (c) => {
  const user = c.get('user');
  const folder = c.req.query('folder') || '';
  const q = c.req.query('q') || '';

  let sql = 'SELECT id, folder, filename, original_name, file_type, file_size, description, created_at, updated_at FROM file_records WHERE user_id = ?';
  const params: unknown[] = [user.id];

  if (folder) {
    sql += ' AND folder = ?';
    params.push(folder);
  }
  if (q) {
    sql += ' AND (filename LIKE ? OR description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY created_at DESC';

  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ data: rows.results });
});

// List distinct folder names
files.get('/folders', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT DISTINCT folder FROM file_records WHERE user_id = ? ORDER BY folder'
  ).bind(user.id).all();
  return c.json({ data: rows.results.map(r => r.folder) });
});

// Upload file to R2 + store metadata in D1
files.post('/upload', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { filename, original_name, file_type, file_size, file_data, folder, description } = body;

  if (!file_data) return c.json({ error: 'file_data required (base64)' }, 400);

  const id = `fs-${uuidv4().slice(0, 8)}`;
  const safeName = original_name || filename || 'untitled';
  const r2Key = `${user.id}/${id}-${safeName}`;
  const displayName = filename || safeName;

  const cleanBase64 = file_data.replace(/^data:.*?;base64,/, '');
  const binary = Uint8Array.from(atob(cleanBase64), ch => ch.charCodeAt(0));

  await c.env.FILE_BUCKET.put(r2Key, binary, {
    httpMetadata: { contentType: file_type || 'application/octet-stream' },
    customMetadata: { originalName: safeName, userId: user.id },
  });

  await c.env.DB.prepare(
    `INSERT INTO file_records (id, user_id, folder, filename, original_name, file_type, file_size, r2_key, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, folder || 'General', displayName, safeName,
    file_type || 'application/octet-stream', file_size || binary.byteLength,
    r2Key, description || '').run();

  const row = await c.env.DB.prepare(
    'SELECT id, folder, filename, original_name, file_type, file_size, description, created_at FROM file_records WHERE id = ?'
  ).bind(id).first();

  return c.json(row, 201);
});

// Batch upload multiple files
files.post('/upload-batch', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { files: fileList, folder: batchFolder, description: batchDesc } = body as {
    files: { filename: string; original_name?: string; file_type?: string; file_size?: number; file_data: string }[];
    folder?: string;
    description?: string;
  };

  if (!Array.isArray(fileList) || fileList.length === 0) {
    return c.json({ error: 'files array required' }, 400);
  }

  const results = [];
  for (const f of fileList) {
    if (!f.file_data) continue;

    const id = `fs-${uuidv4().slice(0, 8)}`;
    const safeName = f.original_name || f.filename || 'untitled';
    const r2Key = `${user.id}/${id}-${safeName}`;
    const displayName = f.filename || safeName;

    const cleanBase64 = f.file_data.replace(/^data:.*?;base64,/, '');
    const binary = Uint8Array.from(atob(cleanBase64), ch => ch.charCodeAt(0));

    await c.env.FILE_BUCKET.put(r2Key, binary, {
      httpMetadata: { contentType: f.file_type || 'application/octet-stream' },
      customMetadata: { originalName: safeName, userId: user.id },
    });

    await c.env.DB.prepare(
      `INSERT INTO file_records (id, user_id, folder, filename, original_name, file_type, file_size, r2_key, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, batchFolder || 'General', displayName, safeName,
      f.file_type || 'application/octet-stream', f.file_size || binary.byteLength,
      r2Key, batchDesc || '').run();

    results.push({ id, filename: displayName, folder: batchFolder || 'General' });
  }

  return c.json({ uploaded: results.length, files: results }, 201);
});

// Get file metadata
files.get('/:id', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    'SELECT id, folder, filename, original_name, file_type, file_size, description, created_at, updated_at FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), user.id).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

// Download from R2
files.get('/:id/download', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    'SELECT r2_key, file_type, original_name, filename FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), user.id).first();
  if (!row) return c.json({ error: 'Not found' }, 404);

  const obj = await c.env.FILE_BUCKET.get(row.r2_key as string);
  if (!obj) return c.json({ error: 'File not found in storage' }, 404);

  const downloadName = (row.original_name || row.filename || 'file') as string;
  return new Response(obj.body, {
    headers: {
      'Content-Type': (row.file_type as string) || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'Content-Length': obj.size.toString(),
    },
  });
});

// Update metadata (rename, move folder, change description)
files.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT id FROM file_records WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const allowedFields = ['filename', 'folder', 'description'];
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (allowedFields.includes(k)) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(id, user.id);

  await c.env.DB.prepare(`UPDATE file_records SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...params).run();

  const row = await c.env.DB.prepare(
    'SELECT id, folder, filename, original_name, file_type, file_size, description, created_at, updated_at FROM file_records WHERE id = ?'
  ).bind(id).first();
  return c.json(row);
});

// Delete from R2 + D1
files.delete('/:id', async (c) => {
  const user = c.get('user');
  const existing = await c.env.DB.prepare(
    'SELECT id, r2_key FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.FILE_BUCKET.delete(existing.r2_key as string);
  await c.env.DB.prepare('DELETE FROM file_records WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).run();
  return c.json({ success: true });
});

export { files as fileStorageRoutes };
