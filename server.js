'use strict';
const http = require('node:http');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PAGES = 10;
const MAX_OUTFITS = 500;
const cache = new Map();
const CACHE_MS = 60_000;

function send(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function fetchPage(url) {
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'AvatarShowcaseLearningProject/1.0' },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) {
    const error = new Error('Roblox respondio HTTP ' + response.status);
    error.code = response.status === 429 ? 503 : 502;
    throw error;
  }
  return response.json();
}
async function outfitsFor(userId) {
  const previous = cache.get(userId);
  if (previous && Date.now() < previous.expires) return previous.data;
  const found = [];
  const used = new Set();
  let page = 1;
  let totalPages = 1;
  do {
    const upstream = new URL(`https://avatar.roblox.com/v2/avatar/users/${userId}/outfits`);
    upstream.searchParams.set('page', String(page));
    upstream.searchParams.set('itemsPerPage', '50');
    // La respuesta incluye data y normalmente totalPages; protegemos cambios de formato.
    const json = await fetchPage(upstream);
    if (!Array.isArray(json.data)) throw Object.assign(new Error('Formato inesperado de la API de Roblox'), { code: 502 });
    for (const entry of json.data) {
      const id = Number(entry.id);
      if (Number.isSafeInteger(id) && id > 0 && !used.has(id)) {
        used.add(id);
        found.push({ id, name: String(entry.name || `Outfit ${id}`).slice(0, 100) });
      }
      if (found.length >= MAX_OUTFITS) break;
    }
    totalPages = Number(json.totalPages);
    // Algunos formatos entregan nextPageCursor en lugar de totalPages.
    // No asumimos cómo paginar con cursor; notificamos que puede quedar incompleta.
    if (!Number.isInteger(totalPages) || totalPages < 1) totalPages = 1;
    page++;
  } while (page <= Math.min(totalPages, MAX_PAGES) && found.length < MAX_OUTFITS);
  const data = { userId: Number(userId), count: found.length, outfits: found, complete: page > totalPages && found.length < MAX_OUTFITS };
  cache.set(userId, { data, expires: Date.now() + CACHE_MS });
  return data;
}
const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'Metodo no permitido' });
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, { error: 'URL invalida' }); }
  if (url.pathname === '/health') return send(res, 200, { ok: true, service: 'Avatar Showcase API' });
  const match = url.pathname.match(/^\/api\/outfits\/([1-9][0-9]{0,15})$/);
  if (!match) return send(res, 404, { error: 'Ruta no encontrada' });
  const userId = Number(match[1]);
  if (!Number.isSafeInteger(userId)) return send(res, 400, { error: 'UserId invalido' });
  try { return send(res, 200, await outfitsFor(userId)); }
  catch (error) { console.error(error.message); return send(res, error.code || 502, { error: error.message }); }
});
server.listen(PORT, HOST, () => console.log(`Avatar Showcase API: http://${HOST}:${PORT}`));
