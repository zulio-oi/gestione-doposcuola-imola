import { jsonResponse, errorResponse } from '../utils.js';

export async function handleSedi(request, env, user, path) {
  if (request.method !== 'GET') return errorResponse('Metodo non consentito', 405, env);
  const { results } = await env.DB.prepare('SELECT * FROM sedi ORDER BY nome').all();
  return jsonResponse(results, 200, env);
}
