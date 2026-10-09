/**
 * Tests automatiques de l'API (à lancer contre un Worker local de test).
 *   npm run test:api -- http://localhost:8788
 * Lit le mot de passe de test dans worker/.dev.vars.
 */
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';

const API = (process.argv[2] || 'http://localhost:8788').replace(/\/$/, '');
const vars = Object.fromEntries(
  readFileSync(new URL('../worker/.dev.vars', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

let failures = 0;
function check(label, condition, detail = '') {
  console.log(`${condition ? 'OK   ' : 'ÉCHEC'} ${label}${condition ? '' : ` ${detail}`}`);
  if (!condition) failures++;
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof Uint8Array) && !Buffer.isBuffer(body)) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + path, { method, headers: h, body: payload });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, headers: res.headers };
}

function signToken(exp) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const sig = createHmac('sha256', `${vars.SESSION_SECRET}|${vars.ADMIN_PASSWORD}`).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

async function jpeg(w, h, color) {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
}

async function addPhoto(token, day, takenAt, caption = '') {
  const id = randomUUID();
  for (const [f, size] of [['s.jpg', 48], ['m.jpg', 96], ['l.jpg', 160]]) {
    const r = await call('PUT', `/api/upload/${id}/${f}`, { token, body: await jpeg(size, Math.round(size * 0.75), '#3a7ca5') });
    if (r.status !== 200) throw new Error(`upload ${f}: ${r.status} ${JSON.stringify(r.data)}`);
  }
  return call('POST', '/api/items', { token, body: { id, type: 'photo', day, takenAt, w: 160, h: 120, caption } });
}

// ---------------------------------------------------------------- scénario

console.log(`API testée : ${API}\n`);

const empty = await call('GET', '/api/album');
check('Lecture publique de l’album', empty.status === 200 && Array.isArray(empty.data.items));
check('En-tête noindex présent', (empty.headers.get('x-robots-tag') || '').includes('noindex'));

// Visiteur sans mot de passe
const anon = await call('POST', '/api/items', { body: { id: randomUUID(), type: 'photo', day: '2026-10-04' } });
check('Visiteur : ajout refusé (401)', anon.status === 401, anon.status);
const anonDel = await call('DELETE', '/api/items/abc12345');
check('Visiteur : suppression refusée (401)', anonDel.status === 401, anonDel.status);

// Mauvais mot de passe
const bad = await call('POST', '/api/login', { body: { password: 'pas-le-bon' } });
check('Mot de passe incorrect refusé (401)', bad.status === 401 && !bad.data.token, bad.status);
check('Message en français', /incorrect/i.test(bad.data.error || ''), bad.data.error);

// Bon mot de passe
const good = await call('POST', '/api/login', { body: { password: vars.ADMIN_PASSWORD } });
check('Mot de passe correct accepté', good.status === 200 && !!good.data.token, good.status);
const token = good.data.token;
const hours = (good.data.expiresAt - Date.now()) / 3600000;
check('Session d’environ 12 h', Math.abs(hours - 12) < 0.05, hours.toFixed(3)); // tolérance : horloges légèrement décalées
check('Session valide', (await call('GET', '/api/session', { token })).status === 200);

// Jetons expirés / falsifiés
const expired = await call('GET', '/api/session', { token: signToken(Date.now() - 1000) });
check('Session expirée refusée (401)', expired.status === 401, expired.status);
const forged = token.split('.')[0] + '.' + 'A'.repeat(43);
check('Jeton falsifié refusé (401)', (await call('GET', '/api/session', { token: forged })).status === 401);
const longer = Buffer.from(JSON.stringify({ exp: Date.now() + 1e10 })).toString('base64url') + '.' + token.split('.')[1];
check('Jeton modifié (durée allongée) refusé', (await call('GET', '/api/session', { token: longer })).status === 401);

// Origine non autorisée
const evil = await call('GET', '/api/session', { token, headers: { origin: 'https://site-pirate.example' } });
check('Site non autorisé refusé (403)', evil.status === 403, evil.status);

// Ajouts
const a = await addPhoto(token, '2026-10-04', '2026-10-04T09:00:00', 'Photo A');
check('Ajout photo A', a.status === 200, JSON.stringify(a.data));
const b = await addPhoto(token, '2026-10-03', '2026-10-03T09:00:00', 'Photo B');
const c = await addPhoto(token, '2026-10-04', '2026-10-04T08:00:00', 'Photo C');
let items = c.data.items;
check('Tri chronologique à l’ajout (B, C, A)', items.map((i) => i.caption).join(',') === 'Photo B,Photo C,Photo A', items.map((i) => i.caption));
const [idB, idC, idA] = items.map((i) => i.id);

const incomplete = await call('POST', '/api/items', { token, body: { id: randomUUID(), type: 'photo', day: '2026-10-04' } });
check('Ajout sans fichiers refusé', incomplete.status === 400, incomplete.status);

const badFile = await call('PUT', `/api/upload/${randomUUID()}/evil.html`, { token, body: Buffer.from('<script>') });
check('Type de fichier interdit refusé', badFile.status === 400, badFile.status);
const huge = await call('PUT', `/api/upload/${randomUUID()}/l.jpg`, { token, body: Buffer.alloc(16 * 1024 * 1024) });
check('Image trop lourde refusée (413)', huge.status === 413, huge.status);

// Vidéo
const tmp = join(tmpdir(), `test-${Date.now()}.mp4`);
execFileSync(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', tmp]);
const vid = randomUUID();
await call('PUT', `/api/upload/${vid}/s.jpg`, { token, body: await jpeg(48, 36, '#888') });
await call('PUT', `/api/upload/${vid}/m.jpg`, { token, body: await jpeg(96, 72, '#888') });
const up = await call('PUT', `/api/upload/${vid}/video.mp4`, { token, body: readFileSync(tmp) });
check('Envoi vidéo', up.status === 200, up.status);
const v = await call('POST', '/api/items', { token, body: { id: vid, type: 'video', day: '2026-10-05', takenAt: '2026-10-05T10:00:00', w: 320, h: 240, duration: 2 } });
check('Ajout vidéo', v.status === 200 && v.data.items.at(-1).type === 'video', v.status);
const range = await call('GET', `/media/${vid}/video.mp4`, { headers: { range: 'bytes=0-99' } });
check('Lecture vidéo par morceaux (206)', range.status === 206 && range.data.byteLength === 100, `${range.status} ${range.data.byteLength}`);
check('Type vidéo correct', range.headers.get('content-type') === 'video/mp4');
const media = await call('GET', `/media/${idA}/m.jpg`);
check('Lecture d’une image', media.status === 200 && media.headers.get('content-type') === 'image/jpeg');
const cover = await call('GET', '/api/cover');
check('Image d’aperçu (Open Graph)', cover.status === 200 && cover.headers.get('content-type') === 'image/jpeg', cover.status);

// Légendes
const cap = await call('PATCH', `/api/items/${idA}`, { token, body: { caption: '  Plage de Palombaggia  ', place: 'Porto-Vecchio' } });
const capA = cap.data.items.find((i) => i.id === idA);
check('Légende et lieu enregistrés', capA.caption === 'Plage de Palombaggia' && capA.place === 'Porto-Vecchio', JSON.stringify(capA));
const visitorCap = await call('PATCH', `/api/items/${idA}`, { body: { caption: 'pirate' } });
check('Visiteur : légende refusée', visitorCap.status === 401);

// Changement de jour
const moved = await call('PATCH', `/api/items/${idB}`, { token, body: { day: '2026-10-04' } });
check('Changement de jour : B passe dans le 4 octobre', moved.data.items.find((i) => i.id === idB).day === '2026-10-04');

// Réorganisation
const order = [idA, idB, idC, vid];
const re = await call('PUT', '/api/order', { token, body: { order, days: {} } });
check('Réorganisation enregistrée', re.status === 200 && re.data.items.map((i) => i.id).join() === order.join(), re.status);
const cross = await call('PUT', '/api/order', { token, body: { order: [vid, idA, idB, idC], days: {} } });
check('Les journées restent chronologiques', cross.data.items.at(-1).id === vid);
const crossDay = await call('PUT', '/api/order', { token, body: { order: [idA, idB, vid, idC], days: { [vid]: '2026-10-04' } } });
check('Glisser dans une autre journée change le jour', crossDay.data.items.map((i) => i.id).join() === [idA, idB, vid, idC].join());
const stale = await call('PUT', '/api/order', { token, body: { order: [idA, idB], days: {} } });
check('Ordre incomplet refusé (409)', stale.status === 409, stale.status);

// Suppression + annulation
const del = await call('DELETE', `/api/items/${idB}`, { token });
check('Suppression', del.status === 200 && !del.data.items.some((i) => i.id === idB));
const trash = await call('GET', '/api/trash', { token });
check('Média dans la corbeille', trash.data.trash.some((t) => t.item.id === idB));
check('Corbeille invisible aux visiteurs', (await call('GET', '/api/trash')).status === 401);
const restored = await call('POST', `/api/items/${idB}/restore`, { token });
check('Annulation de la suppression (remis à sa place)', restored.data.items.map((i) => i.id).join() === [idA, idB, vid, idC].join(), restored.data.items.map((i) => i.id));
const mediaB = await call('GET', `/media/${idB}/l.jpg`);
check('Fichiers conservés après restauration', mediaB.status === 200);

// Titre de journée
const dayT = await call('PATCH', '/api/days/2026-10-04', { token, body: { title: 'Bonifacio' } });
check('Titre de journée', dayT.data.days['2026-10-04']?.title === 'Bonifacio');

// Limite d'essais
let last;
for (let i = 0; i < 9; i++) last = await call('POST', '/api/login', { body: { password: `faux-${i}` } });
check('Trop d’essais : blocage temporaire (429)', last.status === 429, last.status);

console.log(failures ? `\n${failures} test(s) en échec.` : '\nTous les tests sont passés.');
process.exit(failures ? 1 : 0);
