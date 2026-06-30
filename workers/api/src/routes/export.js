import { jsonResponse, errorResponse, requireRole } from '../utils.js';

export async function handleExport(request, env, user, path) {
  if (!requireRole(user, 'admin')) return errorResponse('Non autorizzato', 403, env);
  if (request.method !== 'GET') return errorResponse('Metodo non consentito', 405, env);

  const url    = new URL(request.url);
  const tipo   = url.searchParams.get('tipo');
  const dal    = url.searchParams.get('dal');
  const al     = url.searchParams.get('al');
  const sedeId = url.searchParams.get('sede_id');

  let csv = '';

  if (tipo === 'iscritti') {
    const { results } = await env.DB.prepare(`
      SELECT b.nome, b.cognome, b.classe, s.nome as sede,
             b.orario, u.name as genitore, u.email,
             COALESCE(SUM(c.pasti_residui),0) as saldo_pasti, b.note
      FROM bambini b
      JOIN sedi s ON b.sede_id = s.id
      JOIN users u ON b.genitore_id = u.id
      LEFT JOIN carnet c ON c.bambino_id = b.id AND c.pagato=1
      WHERE b.attivo=1
      GROUP BY b.id ORDER BY s.nome, b.cognome
    `).all();
    csv = toCSV(results, ['nome','cognome','classe','sede','orario','genitore','email','saldo_pasti','note']);

  } else if (tipo === 'presenze') {
    let q = `
      SELECT p.data, b.nome, b.cognome, b.classe, s.nome as sede,
             CASE p.presente WHEN 1 THEN 'Sì' ELSE 'No' END as presente,
             CASE p.pasto WHEN 1 THEN 'Sì' ELSE 'No' END as pasto, p.note
      FROM presenze p
      JOIN bambini b ON p.bambino_id = b.id
      JOIN sedi s ON b.sede_id = s.id WHERE 1=1
    `;
    const params = [];
    if (dal)    { q += ' AND p.data >= ?';    params.push(dal); }
    if (al)     { q += ' AND p.data <= ?';    params.push(al); }
    if (sedeId) { q += ' AND b.sede_id = ?';  params.push(sedeId); }
    q += ' ORDER BY p.data, s.nome, b.cognome';
    const { results } = await (params.length ? env.DB.prepare(q).bind(...params) : env.DB.prepare(q)).all();
    csv = toCSV(results, ['data','nome','cognome','classe','sede','presente','pasto','note']);

  } else if (tipo === 'carnet') {
    let q = `
      SELECT c.data_acquisto, b.nome, b.cognome, s.nome as sede,
             c.pasti_totali, c.pasti_residui, c.importo,
             CASE c.pagato WHEN 1 THEN 'Sì' ELSE 'No' END as pagato,
             c.data_pag, c.note
      FROM carnet c
      JOIN bambini b ON c.bambino_id = b.id
      JOIN sedi s ON b.sede_id = s.id WHERE 1=1
    `;
    const params = [];
    if (dal) { q += ' AND date(c.data_acquisto) >= ?'; params.push(dal); }
    if (al)  { q += ' AND date(c.data_acquisto) <= ?'; params.push(al); }
    q += ' ORDER BY c.data_acquisto DESC';
    const { results } = await (params.length ? env.DB.prepare(q).bind(...params) : env.DB.prepare(q)).all();
    csv = toCSV(results, ['data_acquisto','nome','cognome','sede','pasti_totali','pasti_residui','importo','pagato','data_pag','note']);

  } else {
    return errorResponse('tipo non valido. Usa: iscritti, presenze, carnet', 400, env);
  }

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="export_${tipo}_${new Date().toISOString().split('T')[0]}.csv"`,
      'Access-Control-Allow-Origin': env.FRONTEND_ORIGIN || '*',
    },
  });
}

function toCSV(rows, columns) {
  const header = columns.join(';');
  const body = rows.map(r =>
    columns.map(col => {
      const val = r[col] ?? '';
      const str = String(val).replace(/"/g, '""');
      return str.includes(';') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
    }).join(';')
  ).join('\n');
  return '\uFEFF' + header + '\n' + body;
}
