// ============================================================
// Route: /api/presenze
// ============================================================

import { jsonResponse, errorResponse, requireRole } from '../utils.js';

export async function handlePresenze(request, env, user, path) {
  const method = request.method;
  const url    = new URL(request.url);

  // GET /api/presenze?data=YYYY-MM-DD&sede_id=xxx
  if (method === 'GET') {
    return await getPresenze(env, user, url);
  }

  // POST /api/presenze — segna/aggiorna presenza (operatori e admin)
  if (method === 'POST') {
    if (!requireRole(user, 'admin', 'operatore')) {
      return errorResponse('Non autorizzato', 403, env);
    }
    return await upsertPresenza(request, env, user);
  }

  // POST /api/presenze/bulk — batch (operatori e admin)
  if (method === 'POST' && path === '/api/presenze/bulk') {
    if (!requireRole(user, 'admin', 'operatore')) {
      return errorResponse('Non autorizzato', 403, env);
    }
    return await bulkPresenze(request, env, user);
  }

  return errorResponse('Metodo non consentito', 405, env);
}

async function getPresenze(env, user, url) {
  const data    = url.searchParams.get('data');    // YYYY-MM-DD
  const sedeId  = url.searchParams.get('sede_id');
  const mese    = url.searchParams.get('mese');    // YYYY-MM (per report mensile)

  if (user.role === 'genitore') {
    // Il genitore vede solo le presenze dei propri figli
    const { results } = await env.DB.prepare(`
      SELECT p.*, b.nome, b.cognome
      FROM presenze p
      JOIN bambini b ON p.bambino_id = b.id
      WHERE b.genitore_id = ?
      AND (? IS NULL OR p.data = ?)
      AND (? IS NULL OR p.data LIKE ?)
      ORDER BY p.data DESC
    `).bind(user.sub, data, data, mese, mese ? `${mese}%` : null).all();

    return jsonResponse(results, 200, env);
  }

  // Operatori e admin
  let query = `
    SELECT p.*, b.nome, b.cognome, b.sede_id, s.nome as sede_nome
    FROM presenze p
    JOIN bambini b ON p.bambino_id = b.id
    JOIN sedi s ON b.sede_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (data)   { query += ' AND p.data = ?';         params.push(data); }
  if (mese)   { query += ' AND p.data LIKE ?';      params.push(`${mese}%`); }
  if (sedeId) { query += ' AND b.sede_id = ?';      params.push(sedeId); }

  // Operatore vede solo la sua sede
  if (user.role === 'operatore' && user.sede) {
    query += ' AND b.sede_id = ?';
    params.push(user.sede);
  }

  query += ' ORDER BY p.data DESC, b.cognome, b.nome';

  const stmt = env.DB.prepare(query);
  const { results } = await (params.length ? stmt.bind(...params) : stmt).all();
  return jsonResponse(results, 200, env);
}

async function upsertPresenza(request, env, user) {
  const { bambino_id, data, presente, pasto, note } = await request.json();

  if (!bambino_id || !data) {
    return errorResponse('bambino_id e data sono obbligatori', 400, env);
  }

  // Controlla se l'operatore ha accesso a questa sede
  if (user.role === 'operatore' && user.sede) {
    const bambino = await env.DB.prepare(
      'SELECT sede_id FROM bambini WHERE id = ?'
    ).bind(bambino_id).first();
    if (!bambino || bambino.sede_id !== user.sede) {
      return errorResponse('Non autorizzato per questa sede', 403, env);
    }
  }

  // Recupera presenza esistente
  const existing = await env.DB.prepare(
    'SELECT id, pasto FROM presenze WHERE bambino_id = ? AND data = ?'
  ).bind(bambino_id, data).first();

  const presenzaId = existing?.id || crypto.randomUUID();
  const eraPasto   = existing?.pasto || 0;

  await env.DB.prepare(`
    INSERT INTO presenze (id, bambino_id, data, presente, pasto, operatore_id, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bambino_id, data) DO UPDATE SET
      presente = excluded.presente,
      pasto = excluded.pasto,
      operatore_id = excluded.operatore_id,
      note = excluded.note
  `).bind(presenzaId, bambino_id, data, presente ? 1 : 0, pasto ? 1 : 0, user.sub, note || null).run();

  // Aggiorna saldo pasti se cambia lo stato del pasto
  if (pasto && !eraPasto) {
    // Nuovo pasto: scala dal carnet più vecchio disponibile
    await scalaPasto(env, bambino_id);
  } else if (!pasto && eraPasto) {
    // Pasto rimosso: restituisce al carnet più recente
    await restituisciPasto(env, bambino_id);
  }

  return jsonResponse({ ok: true, id: presenzaId }, 200, env);
}

async function scalaPasto(env, bambinoId) {
  const carnet = await env.DB.prepare(`
    SELECT id, pasti_residui FROM carnet
    WHERE bambino_id = ? AND pagato = 1 AND pasti_residui > 0
    ORDER BY data_acquisto ASC
    LIMIT 1
  `).bind(bambinoId).first();

  if (!carnet) return; // saldo esaurito

  await env.DB.prepare(
    'UPDATE carnet SET pasti_residui = pasti_residui - 1 WHERE id = ?'
  ).bind(carnet.id).run();
}

async function restituisciPasto(env, bambinoId) {
  const carnet = await env.DB.prepare(`
    SELECT id FROM carnet
    WHERE bambino_id = ? AND pagato = 1
    ORDER BY data_acquisto DESC
    LIMIT 1
  `).bind(bambinoId).first();

  if (!carnet) return;

  await env.DB.prepare(
    'UPDATE carnet SET pasti_residui = pasti_residui + 1 WHERE id = ?'
  ).bind(carnet.id).run();
}

async function bulkPresenze(request, env, user) {
  const { presenze } = await request.json();
  if (!Array.isArray(presenze)) return errorResponse('presenze deve essere un array', 400, env);

  for (const p of presenze) {
    await upsertPresenza(
      { json: async () => p },
      env,
      user
    );
  }

  return jsonResponse({ ok: true, count: presenze.length }, 200, env);
}
