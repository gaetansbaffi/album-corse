/**
 * API de l'album « Voyage en Corse ».
 *
 * - Lecture publique : GET /api/album, GET /api/cover, GET /media/<id>/<fichier>
 * - Édition (jeton obtenu avec le mot de passe) : envoi, légendes, suppression, ordre.
 *
 * Données : un fichier album.json dans le bucket R2 + les médias sous media/<id>/.
 * Le mot de passe (ADMIN_PASSWORD) et la clé de signature (SESSION_SECRET) sont des secrets
 * Cloudflare : ils ne quittent jamais le serveur.
 */

const ALBUM_KEY = 'album.json';
const LOGIN_MAX_FAILURES = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9-]{7,39}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const IMAGE_FILES = new Set(['s.jpg', 'm.jpg', 'l.jpg']);
const VIDEO_FILES = { 'video.mp4': 'video/mp4', 'video.mov': 'video/quicktime', 'video.webm': 'video/webm' };
const CONTENT_TYPES = { jpg: 'image/jpeg', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) return json(request, env, { error: err.message }, err.status);
      console.error(err);
      return json(request, env, { error: 'Erreur inattendue du serveur. Réessayez dans un instant.' }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ routage */

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') return preflight(request, env);

  if (path.startsWith('/media/') && (method === 'GET' || method === 'HEAD')) return serveMedia(request, env, path.slice(1));
  if (path === '/api/cover' && (method === 'GET' || method === 'HEAD')) return serveCover(request, env);
  if (path === '/api/album' && method === 'GET') return json(request, env, publicAlbum(await loadAlbum(env)));
  if (path === '/api/login' && method === 'POST') return login(request, env);

  if (path === '/' || path === '') {
    return new Response('API de l’album photo. Rien à voir ici.', { headers: baseHeaders({ 'content-type': 'text/plain; charset=utf-8' }) });
  }

  if (!path.startsWith('/api/')) throw new HttpError(404, 'Adresse inconnue.');

  // Tout le reste demande d'être en mode édition.
  checkOrigin(request, env);
  const session = await requireSession(request, env);

  if (path === '/api/session' && method === 'GET') return json(request, env, { ok: true, expiresAt: session.exp });

  let m;
  if ((m = path.match(/^\/api\/upload\/([^/]+)\/([^/]+)$/)) && method === 'PUT') return upload(request, env, m[1], m[2]);
  if (path === '/api/items' && method === 'POST') return addItem(request, env);
  if ((m = path.match(/^\/api\/items\/([^/]+)$/))) {
    if (method === 'PATCH') return editItem(request, env, m[1]);
    if (method === 'DELETE') return deleteItem(request, env, m[1]);
  }
  if ((m = path.match(/^\/api\/items\/([^/]+)\/restore$/)) && method === 'POST') return restoreItem(request, env, m[1]);
  if (path === '/api/trash' && method === 'GET') return json(request, env, { trash: (await loadAlbum(env)).trash });
  if (path === '/api/order' && method === 'PUT') return reorder(request, env);
  if ((m = path.match(/^\/api\/days\/([^/]+)$/)) && method === 'PATCH') return editDay(request, env, m[1]);

  throw new HttpError(404, 'Adresse inconnue.');
}

/* ------------------------------------------------------------------ en-têtes */

function baseHeaders(extra = {}) {
  return {
    'x-robots-tag': 'noindex, nofollow',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extra,
  };
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  if (origin && allowedOrigins(env).includes(origin)) {
    return { 'access-control-allow-origin': origin, vary: 'Origin' };
  }
  // Lecture publique possible depuis n'importe où (aucun cookie n'est utilisé).
  return { 'access-control-allow-origin': '*' };
}

function checkOrigin(request, env) {
  const origin = request.headers.get('origin');
  // Pas d'en-tête Origin : appel hors navigateur (script d'import) → le jeton suffit.
  if (origin && !allowedOrigins(env).includes(origin)) {
    throw new HttpError(403, 'Ce site n’est pas autorisé à modifier l’album.');
  }
}

function preflight(request, env) {
  const origin = request.headers.get('origin');
  const headers = baseHeaders({
    'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
  });
  if (origin && allowedOrigins(env).includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  } else {
    headers['access-control-allow-origin'] = '*';
    headers['access-control-allow-headers'] = 'range';
    headers['access-control-allow-methods'] = 'GET, HEAD, OPTIONS';
  }
  return new Response(null, { status: 204, headers });
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: baseHeaders({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(request, env),
    }),
  });
}

/* ------------------------------------------------------------------ album */

function emptyAlbum() {
  return { title: 'Voyage en Corse', subtitle: 'Octobre 2026', days: {}, items: [], trash: [], totalBytes: 0, updatedAt: null };
}

async function loadAlbum(env) {
  const obj = await env.BUCKET.get(ALBUM_KEY);
  if (!obj) return emptyAlbum();
  return { ...emptyAlbum(), ...(await obj.json()) };
}

async function saveAlbum(env, album) {
  await purgeTrash(env, album);
  album.updatedAt = new Date().toISOString();
  album.totalBytes = [...album.items, ...album.trash.map((t) => t.item)].reduce((sum, it) => sum + (it.bytes || 0), 0);
  await env.BUCKET.put(ALBUM_KEY, JSON.stringify(album), { httpMetadata: { contentType: 'application/json' } });
}

function publicAlbum(album) {
  return { title: album.title, subtitle: album.subtitle, days: album.days, items: album.items, updatedAt: album.updatedAt };
}

/** Les journées restent toujours dans l'ordre chronologique ; l'ordre choisi à l'intérieur d'une journée est conservé. */
function sortByDay(items) {
  return items
    .map((it, i) => [it, i])
    .sort((a, b) => (a[0].day < b[0].day ? -1 : a[0].day > b[0].day ? 1 : a[1] - b[1]))
    .map(([it]) => it);
}

/** Place un média à sa place chronologique : après le dernier média d'une journée antérieure ou pris avant lui le même jour. */
function insertChronologically(items, item) {
  let pos = 0;
  items.forEach((it, i) => {
    if (it.day < item.day || (it.day === item.day && (it.takenAt || '') <= (item.takenAt || ''))) pos = i + 1;
  });
  items.splice(pos, 0, item);
}

async function purgeTrash(env, album) {
  const limit = Date.now() - Number(env.TRASH_DAYS || 30) * 86400000;
  const expired = album.trash.filter((t) => Date.parse(t.deletedAt) < limit);
  if (!expired.length) return;
  for (const t of expired) await deleteMediaFiles(env, t.item.id);
  album.trash = album.trash.filter((t) => !expired.includes(t));
}

async function deleteMediaFiles(env, id) {
  const listed = await env.BUCKET.list({ prefix: `media/${id}/` });
  const keys = listed.objects.map((o) => o.key);
  if (keys.length) await env.BUCKET.delete(keys);
}

/* ------------------------------------------------------------------ lecture des médias */

async function serveMedia(request, env, key) {
  if (!/^media\/[a-z0-9-]+\/[a-z]+\.(jpg|mp4|mov|webm)$/.test(key)) throw new HttpError(404, 'Fichier introuvable.');
  return serveObject(request, env, key, 'public, max-age=31536000, immutable');
}

async function serveCover(request, env) {
  const album = await loadAlbum(env);
  const first = album.items.find((it) => it.type === 'photo') || album.items[0];
  if (!first) throw new HttpError(404, 'Album vide.');
  return serveObject(request, env, `media/${first.id}/m.jpg`, 'public, max-age=3600');
}

async function serveObject(request, env, key, cacheControl) {
  const obj = await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
  if (obj === null) throw new HttpError(404, 'Fichier introuvable.');

  const ext = key.split('.').pop();
  const headers = new Headers(baseHeaders({
    'content-type': CONTENT_TYPES[ext] || 'application/octet-stream',
    'cache-control': cacheControl,
    'accept-ranges': 'bytes',
    etag: obj.httpEtag,
    ...corsHeaders(request, env),
  }));

  if (!('body' in obj)) return new Response(null, { status: 304, headers });

  let status = 200;
  if (obj.range && request.headers.has('range')) {
    let { offset, length, suffix } = obj.range;
    if (suffix !== undefined) {
      offset = obj.size - suffix;
      length = suffix;
    }
    offset = offset || 0;
    if (length === undefined) length = obj.size - offset;
    status = 206;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('content-length', String(length));
  } else {
    headers.set('content-length', String(obj.size));
  }
  return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers });
}

/* ------------------------------------------------------------------ mot de passe et sessions */

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function checkSecrets(env) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 6 || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new HttpError(500, 'Le mot de passe n’est pas configuré sur le serveur (voir le README).');
  }
}

async function signingKey(env) {
  // La clé dépend aussi du mot de passe : changer le mot de passe ferme toutes les sessions ouvertes.
  return crypto.subtle.importKey('raw', enc.encode(`${env.SESSION_SECRET}|${env.ADMIN_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function passwordMatches(env, candidate) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(candidate))),
    crypto.subtle.digest('SHA-256', enc.encode(env.ADMIN_PASSWORD)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function login(request, env) {
  checkOrigin(request, env);
  checkSecrets(env);
  const body = await readJson(request);
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const ipHash = b64url(await crypto.subtle.digest('SHA-256', enc.encode(ip + env.SESSION_SECRET))).slice(0, 24);
  const failKey = `system/login-failures/${ipHash}.json`;

  const failObj = await env.BUCKET.get(failKey);
  let fails = failObj ? await failObj.json() : { count: 0, first: Date.now() };
  if (Date.now() - fails.first > LOGIN_WINDOW_MS) fails = { count: 0, first: Date.now() };
  if (fails.count >= LOGIN_MAX_FAILURES) {
    throw new HttpError(429, 'Trop d’essais. Patientez 15 minutes avant de réessayer.');
  }

  if (!(await passwordMatches(env, body.password || ''))) {
    fails.count += 1;
    await env.BUCKET.put(failKey, JSON.stringify(fails));
    await new Promise((r) => setTimeout(r, 400));
    const left = LOGIN_MAX_FAILURES - fails.count;
    throw new HttpError(401, left > 0
      ? `Mot de passe incorrect. Vérifiez les majuscules et réessayez (encore ${left} essai${left > 1 ? 's' : ''}).`
      : 'Mot de passe incorrect. Trop d’essais : patientez 15 minutes.');
  }
  if (failObj) await env.BUCKET.delete(failKey);

  const exp = Date.now() + Number(env.SESSION_HOURS || 12) * 3600000;
  const payload = b64url(enc.encode(JSON.stringify({ exp })));
  const sig = b64url(await crypto.subtle.sign('HMAC', await signingKey(env), enc.encode(payload)));
  return json(request, env, { token: `${payload}.${sig}`, expiresAt: exp });
}

async function requireSession(request, env) {
  checkSecrets(env);
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [payload, sig] = token.split('.');
  const expired = new HttpError(401, 'Votre session d’édition est terminée. Retapez le mot de passe pour continuer.');
  if (!payload || !sig) throw expired;
  let valid = false;
  try {
    valid = await crypto.subtle.verify('HMAC', await signingKey(env), fromB64url(sig), enc.encode(payload));
  } catch {
    valid = false;
  }
  if (!valid) throw expired;
  const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  if (!data.exp || data.exp < Date.now()) throw expired;
  return data;
}

/* ------------------------------------------------------------------ édition */

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Requête mal formée.');
  }
}

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

async function upload(request, env, id, file) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Identifiant de média invalide.');
  const isImage = IMAGE_FILES.has(file);
  if (!isImage && !VIDEO_FILES[file]) throw new HttpError(400, 'Type de fichier non accepté.');

  const size = Number(request.headers.get('content-length') || 0);
  if (!size) throw new HttpError(411, 'Fichier vide ou taille inconnue.');
  const maxVideo = Number(env.MAX_VIDEO_MB || 95) * 1024 * 1024;
  if (isImage && size > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image trop lourde.');
  if (!isImage && size > maxVideo) {
    throw new HttpError(413, `Cette vidéo est trop lourde (maximum ${env.MAX_VIDEO_MB || 95} Mo). Demandez qu’elle soit compressée.`);
  }

  const album = await loadAlbum(env);
  const limit = Number(env.STORAGE_LIMIT_MB || 9000) * 1024 * 1024;
  if (album.totalBytes + size > limit) throw new HttpError(507, 'L’espace de stockage de l’album est plein. Supprimez des médias ou contactez le webmaster.');

  await env.BUCKET.put(`media/${id}/${file}`, request.body, {
    httpMetadata: { contentType: isImage ? 'image/jpeg' : VIDEO_FILES[file] },
  });
  return json(request, env, { ok: true });
}

async function addItem(request, env) {
  const body = await readJson(request);
  const id = String(body.id || '');
  if (!ID_RE.test(id)) throw new HttpError(400, 'Identifiant de média invalide.');
  const type = body.type === 'video' ? 'video' : 'photo';
  const day = String(body.day || '');
  if (!DAY_RE.test(day)) throw new HttpError(400, 'Date du média invalide.');

  const listed = await env.BUCKET.list({ prefix: `media/${id}/` });
  const files = Object.fromEntries(listed.objects.map((o) => [o.key.split('/').pop(), o.size]));
  const needed = type === 'photo' ? ['s.jpg', 'm.jpg', 'l.jpg'] : ['s.jpg', 'm.jpg'];
  const videoFile = Object.keys(VIDEO_FILES).find((f) => files[f]);
  if (needed.some((f) => !files[f]) || (type === 'video' && !videoFile)) {
    throw new HttpError(400, 'L’envoi des fichiers n’est pas complet. Réessayez.');
  }

  const album = await loadAlbum(env);
  if (album.items.some((it) => it.id === id)) return json(request, env, publicAlbum(album));

  const item = {
    id,
    type,
    day,
    takenAt: cleanText(body.takenAt, 25) || `${day}T12:00:00`,
    w: Math.max(1, Math.round(Number(body.w) || 1)),
    h: Math.max(1, Math.round(Number(body.h) || 1)),
    caption: cleanText(body.caption, 300),
    place: cleanText(body.place, 80),
    bytes: Object.values(files).reduce((a, b) => a + b, 0),
    addedAt: new Date().toISOString(),
  };
  if (type === 'video') {
    item.video = videoFile;
    item.duration = Math.round(Number(body.duration) || 0);
    if (body.codecWarning) item.codecWarning = true;
  }
  insertChronologically(album.items, item);
  await saveAlbum(env, album);
  return json(request, env, publicAlbum(album));
}

function findItem(album, id) {
  const index = album.items.findIndex((it) => it.id === id);
  if (index < 0) throw new HttpError(404, 'Ce média n’existe plus (il a peut-être été supprimé depuis un autre appareil).');
  return index;
}

async function editItem(request, env, id) {
  const body = await readJson(request);
  const album = await loadAlbum(env);
  const index = findItem(album, id);
  const item = album.items[index];
  if ('caption' in body) item.caption = cleanText(body.caption, 300);
  if ('place' in body) item.place = cleanText(body.place, 80);
  if ('day' in body && body.day !== item.day) {
    if (!DAY_RE.test(String(body.day))) throw new HttpError(400, 'Date invalide.');
    album.items.splice(index, 1);
    item.day = body.day;
    insertChronologically(album.items, item);
  }
  await saveAlbum(env, album);
  return json(request, env, publicAlbum(album));
}

async function deleteItem(request, env, id) {
  const album = await loadAlbum(env);
  const index = findItem(album, id);
  const [item] = album.items.splice(index, 1);
  album.trash.unshift({ item, index, deletedAt: new Date().toISOString() });
  await saveAlbum(env, album);
  return json(request, env, publicAlbum(album));
}

async function restoreItem(request, env, id) {
  const album = await loadAlbum(env);
  const t = album.trash.find((x) => x.item.id === id);
  if (!t) throw new HttpError(404, 'Ce média n’est plus dans la corbeille.');
  album.trash = album.trash.filter((x) => x !== t);
  album.items.splice(Math.min(t.index, album.items.length), 0, t.item);
  album.items = sortByDay(album.items);
  await saveAlbum(env, album);
  return json(request, env, publicAlbum(album));
}

async function reorder(request, env) {
  const body = await readJson(request);
  const order = Array.isArray(body.order) ? body.order.map(String) : [];
  const days = body.days && typeof body.days === 'object' ? body.days : {};
  const album = await loadAlbum(env);
  const byId = new Map(album.items.map((it) => [it.id, it]));
  if (order.length !== album.items.length || new Set(order).size !== order.length || order.some((id) => !byId.has(id))) {
    throw new HttpError(409, 'L’album a changé entre-temps (sur un autre appareil ?). Il va être rechargé : refaites le déplacement.');
  }
  for (const [id, day] of Object.entries(days)) {
    if (byId.has(id) && DAY_RE.test(String(day))) byId.get(id).day = day;
  }
  album.items = sortByDay(order.map((id) => byId.get(id)));
  await saveAlbum(env, album);
  return json(request, env, publicAlbum(album));
}

async function editDay(request, env, day) {
  if (!DAY_RE.test(day)) throw new HttpError(400, 'Date invalide.');
  const body = await readJson(request);
  const album = await loadAlbum(env);
  const title = cleanText(body.title, 80);
  if (title) album.days[day] = { ...(album.days[day] || {}), title };
  else delete album.days[day];
  await saveAlbum(env, album);
  return json(request, env, publicAlbum(album));
}
