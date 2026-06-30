// ============================================================
// Route: /api/bambini
// ============================================================

import { jsonResponse, errorResponse, requireRole, parsePath } from '../utils.js';

export async function handleBambini(request, env, user, path) {
  const method  = request.method;
  const segments = parsePath(path, '/api/bambini');
  const id       = segments[0] || null;

  // GET /api/bambini — lista (admin/operatori: tutti o per sede; genitori: solo i propri)
  if (!id && method === 'GET') {
    return await listBambini(env, user);
  }

  // GET /api/bambini/:id
  if (id && method === 'GET') {
    return await getBambino(env, user, id);
  }

  // POST /api/bambini — nuovo iscritto (solo admin)
  if (!id && method === 'POST') {
    if (!requireRole(user, 'admin')) return errorResponse('Non autorizzato', 403, env);
    return await createBambino(request, env);
  }

  // PUT /api/bambini/:id — modifica (solo admin)
  if (id && method === 'PUT') {
    if (!requireRole(user, 'admin')) return errorResponse('Non autorizzato', 403, env);
    return await updateBambino(request, env, id);
  }

  // DELETE /api/bambini/:id — disattiva (solo admin)
  if (id && method === 'DELETE') {
    if (!requireRole(user, 'admin')) return errorResponse('Non autorizzato', 403, env);
    return await deleteBambino(env, id);
  }

  return errorResponse('Metodo non consentito', 405, env);
}

async function listBambini(env, user) {
  let query, params;

  if (user.role === 'genitore') {
    query = `
      SELECT b.*, s.nome as sede_nome,
             COALESCE(SUM(c.pasti_residui),0) as saldo_pasti
      FROM bambini b
      JOIN sedi s ON b.sede_id = s.id
      LEFT JOIN carnet c ON c.bambino_id = b.id AND c.pagato = 1
      WHERE b.genitore_id = ? AND b.attivo = 1
      GROUP BY b.id
    `;
    params = [user.sub];
  } else if (user.role === 'operatore' && user.sede) {
    query = `
      SELECT b.*, s.nome as sede_nome,
             COALESCE(SUM(c.pasti_residui),0) as saldo_pasti
      FROM bambini b
      JOIN sedi s ON b.sede_id = s.id
      LEFT JOIN carnet c ON c.bambino_id = b.id AND c.pagato = 1
      WHERE b.sede_id = ? AND b.attivo = 1
      GROUP BY b.id ORDER BY b.cognome, b.nome
    `;
    params = [user.sede];
  } else {
    // admin o operatore senza sede specifica: vede tutti
    query = `
      SELECT b.*, s.nome as sede_nome, u.name as genitore_nome, u.email as genitore_email,
             COALESCE(SUM(c.pasti_residui),0) as saldo_pasti
      FROM bambini b
      JOIN sedi s ON b.sede_id = s.id
      JOIN users u ON b.genitore_id = u.id
      LEFT JOIN carnet c ON c.bambino_id = b.id AND c.pagato = 1
      WHERE b.attivo = 1
      GROUP BY b.id ORDER BY s.nome, b.cognome, b.nome
    `;
    params = [];
  }

  const stmt = env.DB.prepare(query);
  const { results } = await (params.length ? stmt.bind(...params) : stmt).all();
  return jsonResponse(results, 200, env);
}

async function getBambino(env, user, id) {
  const row = await env.DB.prepare(`
    SELECT b.*, s.nome as sede_nome, u.name as genitore_nome, u.email as genitore_email,
           COALESCE(SUM(c.pasti_residui),0) as saldo_pasti
    FROM bambini b
    JOIN sedi s ON b.sede_id = s.id
    JOIN users u ON b.genitore_id = u.id
    LEFT JOIN carnet c ON c.bambino_id = b.id AND c.pagato = 1
    WHERE b.id = ? AND b.attivo = 1
    GROUP BY b.id
  `).bind(id).first();

  if (!row) return errorResponse('Non trovato', 404, env);

  // Genitore può vedere solo i propri figli
  if (user.role === 'genitore' && row.genitore_id !== user.sub) {
    return errorResponse('Non autorizzato', 403, env);
  }

  return jsonResponse(row, 200, env);
}

async function createBambino(request, env) {
  const body = await request.json();
  const { nome, cognome, classe, sede_id, orario, genitore_id, note } = body;

  if (!nome || !cognome || !classe || !sede_id || !orario || !genitore_id) {
    return errorResponse('Campi obbligatori mancanti', 400, env);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO bambini (id, nome, cognome, classe, sede_id, orario, genitore_id, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, nome, cognome, classe, sede_id, orario, genitore_id, note || null).run();

  return jsonResponse({ ok: true, id }, 201, env);
}

async function updateBambino(request, env, id) {
  const { nome, cognome, classe, sede_id, orario, note, attivo } = await request.json();

  await env.DB.prepare(`
    UPDATE bambini SET nome=?, cognome=?, classe=?, sede_id=?, orario=?, note=?, attivo=?
    WHERE id=?
  `).bind(nome, cognome, classe, sede_id, orario, note, attivo ?? 1, id).run();

  return jsonResponse({ ok: true }, 200, env);
}

async function deleteBambino(env, id) {
  await env.DB.prepare('UPDATE bambini SET attivo=0 WHERE id=?').bind(id).run();
  return jsonResponse({ ok: true }, 200, env);
}
