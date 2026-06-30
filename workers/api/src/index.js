// ============================================================
// Gestione Doposcuola — Cloudflare Worker API
// ============================================================

import { handleAuth } from './routes/auth.js';
import { handleBambini } from './routes/bambini.js';
import { handlePresenze } from './routes/presenze.js';
import { handleCarnet } from './routes/carnet.js';
import { handleAbbonamenti } from './routes/abbonamenti.js';
import { handleExport } from './routes/export.js';
import { handleSedi } from './routes/sedi.js';
import { verifyJWT, jsonResponse, errorResponse } from './utils.js';

export default {
  async fetch(request, env, ctx) {
    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(env),
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Rotte pubbliche (no auth)
      if (path.startsWith('/api/auth/')) {
        return await handleAuth(request, env, path);
      }

      // Tutte le altre rotte richiedono autenticazione
      const user = await authenticate(request, env);
      if (!user) {
        return errorResponse('Non autenticato', 401);
      }

      // Router principale
      if (path.startsWith('/api/sedi'))        return await handleSedi(request, env, user, path);
      if (path.startsWith('/api/bambini'))     return await handleBambini(request, env, user, path);
      if (path.startsWith('/api/presenze'))    return await handlePresenze(request, env, user, path);
      if (path.startsWith('/api/carnet'))      return await handleCarnet(request, env, user, path);
      if (path.startsWith('/api/abbonamenti')) return await handleAbbonamenti(request, env, user, path);
      if (path.startsWith('/api/export'))      return await handleExport(request, env, user, path);

      return errorResponse('Endpoint non trovato', 404);

    } catch (err) {
      console.error(err);
      return errorResponse('Errore interno del server', 500);
    }
  },

  // Scheduled job: controlla saldi bassi ogni giorno alle 8:00
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkSaldiBassie(env));
  },
};

async function authenticate(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return await verifyJWT(token, env.JWT_SECRET);
}

async function checkSaldiBassie(env) {
  const { results } = await env.DB.prepare(`
    SELECT b.id, b.nome, b.cognome, u.email, u.name as genitore,
           SUM(c.pasti_residui) as saldo
    FROM bambini b
    JOIN users u ON b.genitore_id = u.id
    LEFT JOIN carnet c ON c.bambino_id = b.id AND c.pagato = 1
    WHERE b.attivo = 1
    GROUP BY b.id
    HAVING saldo < 5 OR saldo IS NULL
  `).all();

  for (const row of results) {
    // Controlla se notifica già inviata oggi
    const oggi = new Date().toISOString().split('T')[0];
    const { results: logs } = await env.DB.prepare(`
      SELECT id FROM email_log
      WHERE user_id = (SELECT genitore_id FROM bambini WHERE id = ?)
      AND tipo = 'saldo_basso'
      AND date(inviata_at) = ?
    `).bind(row.id, oggi).all();

    if (logs.length > 0) continue;

    await sendSaldoBasso(env, row);
  }
}

async function sendSaldoBasso(env, bambino) {
  const saldo = bambino.saldo || 0;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: bambino.email,
      subject: `⚠️ Saldo pasti basso — ${bambino.nome} ${bambino.cognome}`,
      html: `
        <p>Gentile ${bambino.genitore},</p>
        <p>il saldo pasti di <strong>${bambino.nome} ${bambino.cognome}</strong> 
        è sceso a <strong>${saldo} pasti residui</strong>.</p>
        <p>Ti invitiamo ad acquistare un nuovo carnet per garantire la continuità del servizio mensa.</p>
        <p><a href="${env.FRONTEND_ORIGIN}">Accedi alla piattaforma</a></p>
        <p>Cooperativa Officina Immaginata</p>
      `,
    }),
  });

  // Log notifica
  await env.DB.prepare(`
    INSERT INTO email_log (id, user_id, tipo)
    VALUES (?, (SELECT genitore_id FROM bambini WHERE id = ?), 'saldo_basso')
  `).bind(crypto.randomUUID(), bambino.id).run();
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.FRONTEND_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
