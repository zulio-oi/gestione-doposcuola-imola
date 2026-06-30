// ============================================================
// Route: /api/carnet
// ============================================================

import { jsonResponse, errorResponse, requireRole, parsePath } from '../utils.js';

const CARNET_OPZIONI = [
  { pasti: 10, prezzo: 80 },
  { pasti: 20, prezzo: 155 },
  { pasti: 30, prezzo: 225 },
];

export async function handleCarnet(request, env, user, path) {
  const method   = request.method;
  const segments = parsePath(path, '/api/carnet');
  const id       = segments[0] || null;

  // GET /api/carnet/opzioni — lista carnet disponibili (pubblico autenticato)
  if (segments[0] === 'opzioni' && method === 'GET') {
    return jsonResponse(CARNET_OPZIONI, 200, env);
  }

  // GET /api/carnet?bambino_id=xxx
  if (!id && method === 'GET') {
    return await listCarnet(request, env, user);
  }

  // POST /api/carnet — acquisto carnet (genitore: richiede, admin: assegna direttamente)
  if (!id && method === 'POST') {
    return await createCarnet(request, env, user);
  }

  // PUT /api/carnet/:id/paga — conferma pagamento (solo admin)
  if (id && segments[1] === 'paga' && method === 'PUT') {
    if (!requireRole(user, 'admin')) return errorResponse('Non autorizzato', 403, env);
    return await confermaPagamento(env, id);
  }

  // DELETE /api/carnet/:id (solo admin)
  if (id && method === 'DELETE') {
    if (!requireRole(user, 'admin')) return errorResponse('Non autorizzato', 403, env);
    return await deleteCarnet(env, id);
  }

  return errorResponse('Endpoint non trovato', 404, env);
}

async function listCarnet(request, env, user) {
  const url       = new URL(request.url);
  const bambinoId = url.searchParams.get('bambino_id');

  let query, params;

  if (user.role === 'genitore') {
    // Il genitore vede solo i carnet dei propri figli
    query = `
      SELECT c.*, b.nome, b.cognome
      FROM carnet c
      JOIN bambini b ON c.bambino_id = b.id
      WHERE b.genitore_id = ?
      ${bambinoId ? 'AND c.bambino_id = ?' : ''}
      ORDER BY c.data_acquisto DESC
    `;
    params = bambinoId ? [user.sub, bambinoId] : [user.sub];
  } else {
    query = `
      SELECT c.*, b.nome, b.cognome
      FROM carnet c
      JOIN bambini b ON c.bambino_id = b.id
      ${bambinoId ? 'WHERE c.bambino_id = ?' : ''}
      ORDER BY c.data_acquisto DESC
    `;
    params = bambinoId ? [bambinoId] : [];
  }

  const stmt = env.DB.prepare(query);
  const { results } = await (params.length ? stmt.bind(...params) : stmt).all();
  return jsonResponse(results, 200, env);
}

async function createCarnet(request, env, user) {
  const { bambino_id, pasti, note } = await request.json();

  if (!bambino_id || !pasti) {
    return errorResponse('bambino_id e pasti sono obbligatori', 400, env);
  }

  const opzione = CARNET_OPZIONI.find(o => o.pasti === pasti);
  if (!opzione) {
    return errorResponse(`Carnet non valido. Opzioni: ${CARNET_OPZIONI.map(o=>o.pasti).join(', ')} pasti`, 400, env);
  }

  // Verifica che il genitore possa acquistare per questo bambino
  if (user.role === 'genitore') {
    const bambino = await env.DB.prepare(
      'SELECT genitore_id FROM bambini WHERE id = ?'
    ).bind(bambino_id).first();
    if (!bambino || bambino.genitore_id !== user.sub) {
      return errorResponse('Non autorizzato', 403, env);
    }
  }

  const id      = crypto.randomUUID();
  const pagato  = user.role === 'admin' ? 1 : 0; // admin assegna già come pagato
  const dataPag = user.role === 'admin' ? new Date().toISOString() : null;

  await env.DB.prepare(`
    INSERT INTO carnet (id, bambino_id, pasti_totali, pasti_residui, importo, pagato, data_pag, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, bambino_id, pasti, pasti, opzione.prezzo, pagato, dataPag, note || null).run();

  return jsonResponse({
    ok: true, id,
    message: user.role === 'admin'
      ? 'Carnet assegnato e saldo aggiornato.'
      : 'Richiesta inviata. Il saldo verrà aggiornato dopo la conferma del pagamento.',
  }, 201, env);
}

async function confermaPagamento(env, id) {
  const carnet = await env.DB.prepare('SELECT id FROM carnet WHERE id = ?').bind(id).first();
  if (!carnet) return errorResponse('Carnet non trovato', 404, env);

  await env.DB.prepare(`
    UPDATE carnet SET pagato = 1, data_pag = datetime('now') WHERE id = ?
  `).bind(id).run();

  return jsonResponse({ ok: true }, 200, env);
}

async function deleteCarnet(env, id) {
  await env.DB.prepare('DELETE FROM carnet WHERE id = ?').bind(id).run();
  return jsonResponse({ ok: true }, 200, env);
}
