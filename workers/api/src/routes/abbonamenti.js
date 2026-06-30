// ============================================================
// Route: /api/abbonamenti
// ============================================================

import { jsonResponse, errorResponse, requireRole } from '../utils.js';

export async function handleAbbonamenti(request, env, user, path) {
  const method = request.method;
  const url    = new URL(request.url);

  if (method === 'GET') {
    const bambinoId = url.searchParams.get('bambino_id');
    const mese      = url.searchParams.get('mese');

    let query = `
      SELECT a.*, b.nome, b.cognome, b.sede_id, s.nome as sede_nome,
             CASE b.orario
               WHEN '13:00-17:00' THEN s.costo_13_17
               WHEN '14:00-17:00' THEN s.costo_14_17
               WHEN '12:45-16:45' THEN s.costo_1245
             END as costo_base
      FROM abbonamenti a
      JOIN bambini b ON a.bambino_id = b.id
      JOIN sedi s ON b.sede_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (user.role === 'genitore') {
      query += ' AND b.genitore_id = ?';
      params.push(user.sub);
    }
    if (bambinoId) { query += ' AND a.bambino_id = ?'; params.push(bambinoId); }
    if (mese)      { query += ' AND a.mese = ?';       params.push(mese); }

    query += ' ORDER BY a.mese DESC';
    const stmt = env.DB.prepare(query);
    const { results } = await (params.length ? stmt.bind(...params) : stmt).all();
    return jsonResponse(results, 200, env);
  }

  if (method === 'POST') {
    if (!requireRole(user, 'admin')) return errorResponse('Non autorizzato', 403, env);
    const { bambino_id, mese, importo, sconto_pct, note } = await request.json();
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO abbonamenti (id, bambino_id, mese, importo, sconto_pct, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, bambino_id, mese, importo, sconto_pct || 0, note || null).run();
    return jsonResponse({ ok: true, id }, 201, env);
  }

  // PUT /api/abbonamenti/:id/paga
  const segments = path.split('/').filter(Boolean);
  if (segments.length >= 3 && segments[3] === 'paga' && method === 'PUT') {
    if (!requireRole(user, 'admin')) return errorResponse('Non autorizzato', 403, env);
    const id = segments[2];
    await env.DB.prepare(`
      UPDATE abbonamenti SET pagato = 1, data_pag = datetime('now') WHERE id = ?
    `).bind(id).run();
    return jsonResponse({ ok: true }, 200, env);
  }

  return errorResponse('Metodo non consentito', 405, env);
}
