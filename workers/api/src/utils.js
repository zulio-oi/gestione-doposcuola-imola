// ============================================================
// Utilities condivise
// ============================================================

export function jsonResponse(data, status = 200, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': env?.FRONTEND_ORIGIN || '*',
    },
  });
}

export function errorResponse(message, status = 400, env) {
  return jsonResponse({ error: message }, status, env);
}

// ---- JWT minimale (HS256) senza librerie esterne ----

export async function signJWT(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(payload));
  const sig    = await hmacSign(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

export async function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = await hmacSign(`${header}.${body}`, secret);
    if (expected !== sig) return null;
    const payload = JSON.parse(atob(body.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64url(sig);
}

function b64url(data) {
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : new Uint8Array(data);
  let str = '';
  bytes.forEach(b => str += String.fromCharCode(b));
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

export function requireRole(user, ...roles) {
  return roles.includes(user.role);
}

export function parsePath(path, prefix) {
  return path.slice(prefix.length).split('/').filter(Boolean);
}
