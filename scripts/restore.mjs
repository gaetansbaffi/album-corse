/**
 * Restaure une sauvegarde faite avec « npm run backup » (légendes, lieux, ordre et noms de journées compris).
 *
 *   npm run restore -- --api https://album-corse.VOTRE-COMPTE.workers.dev --from sauvegarde/2026-10-20
 *
 * Les médias déjà présents dans l'album sont laissés tels quels. La corbeille n'est pas restaurée.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const API = (args.api || 'http://127.0.0.1:8787').replace(/\/$/, '');
if (!args.from) {
  console.error('Indiquez le dossier de sauvegarde : --from sauvegarde/AAAA-MM-JJ');
  process.exit(1);
}
const TYPES = { jpg: 'image/jpeg', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

async function getPassword() {
  if (process.env.ALBUM_PASSWORD) return process.env.ALBUM_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pwd = await rl.question('Mot de passe de l’album : ');
  rl.close();
  return pwd;
}

async function api(method, path, { token, body, raw, type } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': raw ? type : 'application/json' },
    body: raw || (body && JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.error || ''}`);
  return data;
}

const backup = JSON.parse(readFileSync(join(args.from, 'album.json'), 'utf8'));
const { token } = await api('POST', '/api/login', { body: { password: await getPassword() } });
let album = await api('GET', '/api/album');
const present = new Set(album.items.map((i) => i.id));

let added = 0;
for (const item of backup.items) {
  if (present.has(item.id)) continue;
  const names = item.type === 'video' ? ['s.jpg', 'm.jpg', item.video || 'video.mp4'] : ['s.jpg', 'm.jpg', 'l.jpg'];
  for (const name of names) {
    const file = join(args.from, 'media', item.id, name);
    if (!existsSync(file)) throw new Error(`Fichier manquant dans la sauvegarde : ${file}`);
    await api('PUT', `/api/upload/${item.id}/${name}`, { token, raw: readFileSync(file), type: TYPES[name.split('.').pop()] });
  }
  album = await api('POST', '/api/items', { token, body: item });
  added++;
  console.log(`  restauré  ${item.type} ${item.day} ${item.caption || ''}`);
}

// Ordre d'origine (les médias absents de la sauvegarde restent à la fin de leur journée)
const backupOrder = backup.items.map((i) => i.id).filter((id) => album.items.some((i) => i.id === id));
const others = album.items.map((i) => i.id).filter((id) => !backupOrder.includes(id));
album = await api('PUT', '/api/order', { token, body: { order: [...backupOrder, ...others], days: {} } });
for (const [day, { title }] of Object.entries(backup.days || {})) {
  if (title) await api('PATCH', `/api/days/${day}`, { token, body: { title } });
}
console.log(`\nRestauration terminée : ${added} média(s) remis, ${album.items.length} au total dans l’album.`);
