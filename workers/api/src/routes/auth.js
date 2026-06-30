// ============================================================
// Route: /api/auth/
// ============================================================

import { signJWT, jsonResponse, errorResponse } from '../utils.js';

export async function handleAuth(request, env, path) {
  const method = request.method;

  // POST /api/auth/register
  if (path === '/api/auth/register' && method === 'POST') {
    return await register(request, env);
  }

  // POST /api/auth/magic-link  → richiede magic link via email
  if (path === '/api/auth/magic-link' && method === 'POST') {
    return await requestMagicLink(request, env);
  }

  // GET /api/auth/verify?token=XXX  → scambia token con JWT
  if (path === '/api/auth/verify' && method === 'GET') {
    return await verifyMagicLink(request, env);
  }

  return errorResponse('Endpoint non trovato', 404, env);
}

// ---- Registrazione genitore ----
async function register(request, env) {
  const { email, name, sede_id, nome_bambino, cognome_bambino, classe, orario } =
    await request.json();

  if (!email || !name || !sede_id || !nome_bambino || !cognome_bambino || !classe || !orario) {
    return errorResponse('Tutti i campi sono obbligatori', 400, env);
  }

  // Controlla email già esistente
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(email).first();

  if (existing) {
    return errorResponse('Email già registrata', 409, env);
  }

  const userId   = crypto.randomUUID();
  const bambinoId = crypto.randomUUID();

  await env.DB.prepare(`
    INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, 'genitore')
  `).bind(userId, email.toLowerCase(), name).run();

  await env.DB.prepare(`
    INSERT INTO bambini (id, nome, cognome, classe, sede_id, orario, genitore_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(bambinoId, nome_bambino, cognome_bambino, classe, sede_id, orario, userId).run();

  // Invia email di benvenuto + magic link immediato
  await sendMagicLinkEmail(env, { id: userId, email, name });

  return jsonResponse({
    ok: true,
    message: 'Registrazione completata. Controlla la tua email per accedere.',
  }, 201, env);
}

// ---- Richiesta magic link ----
async function requestMagicLink(request, env) {
  const { email } = await request.json();
  if (!email) return errorResponse('Email obbligatoria', 400, env);

  const user = await env.DB.prepare(
    'SELECT id, email, name FROM users WHERE email = ?'
  ).bind(email.toLowerCase()).first();

  // Risposta sempre positiva per non rivelare se l'email esiste
  if (!user) {
    return jsonResponse({ ok: true, message: 'Se l\'email esiste, riceverai un link.' }, 200, env);
  }

  await sendMagicLinkEmail(env, user);
  return jsonResponse({ ok: true, message: 'Magic link inviato. Controlla la tua email.' }, 200, env);
}

// ---- Verifica magic link ----
async function verifyMagicLink(request, env) {
  const url   = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return errorResponse('Token mancante', 400, env);

  const row = await env.DB.prepare(`
    SELECT mt.user_id, mt.expires_at, mt.used,
           u.id, u.email, u.name, u.role, u.sede_id
    FROM magic_tokens mt
    JOIN users u ON mt.user_id = u.id
    WHERE mt.token = ?
  `).bind(token).first();

  if (!row)        return errorResponse('Token non valido', 401, env);
  if (row.used)    return errorResponse('Token già usato', 401, env);
  if (new Date(row.expires_at) < new Date()) return errorResponse('Token scaduto', 401, env);

  // Invalida il token
  await env.DB.prepare(
    'UPDATE magic_tokens SET used = 1 WHERE token = ?'
  ).bind(token).run();

  // Aggiorna last_login
  await env.DB.prepare(
    'UPDATE users SET last_login = datetime(\'now\') WHERE id = ?'
  ).bind(row.user_id).run();

  // Genera JWT (valido 7 giorni)
  const jwt = await signJWT({
    sub:   row.user_id,
    email: row.email,
    name:  row.name,
    role:  row.role,
    sede:  row.sede_id,
    exp:   Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  }, env.JWT_SECRET);

  return jsonResponse({ ok: true, token: jwt, user: {
    id:    row.user_id,
    email: row.email,
    name:  row.name,
    role:  row.role,
    sede:  row.sede_id,
  }}, 200, env);
}

// ---- Helper: crea e invia magic link ----
async function sendMagicLinkEmail(env, user) {
  const token     = crypto.randomUUID() + crypto.randomUUID(); // token lungo
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString(); // 30 minuti

  await env.DB.prepare(`
    INSERT INTO magic_tokens (token, user_id, expires_at) VALUES (?, ?, ?)
  `).bind(token, user.id, expiresAt).run();

  const link = `${env.FRONTEND_ORIGIN}/?token=${token}`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to:   user.email,
      subject: 'Accedi a Gestione Doposcuola — Officina Immaginata',
      html: `
        <p>Ciao ${user.name},</p>
        <p>clicca il pulsante qui sotto per accedere alla piattaforma. 
        Il link è valido per <strong>30 minuti</strong>.</p>
        <p>
          <a href="${link}" 
             style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;
                    border-radius:6px;text-decoration:none;font-weight:500;">
            Accedi ora
          </a>
        </p>
        <p style="color:#666;font-size:12px;">
          Se non hai richiesto questo link, ignora questa email.<br>
          Link: ${link}
        </p>
        <p>Cooperativa Officina Immaginata</p>
      `,
    }),
  });
}
