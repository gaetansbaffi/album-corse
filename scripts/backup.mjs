/**
 * Sauvegarde complète de l'album (album.json + toutes les photos et vidéos, corbeille comprise)
 * dans sauvegarde/AAAA-MM-JJ/ sur votre ordinateur.
 *
 *   npm run backup -- --api https://album-corse.VOTRE-COMPTE.workers.dev
 *
 * Mot de passe : variable d'environnement ALBUM_PASSWORD, sinon demandé au clavier.
 * Les fichiers déjà présents dans le dossier du jour ne sont pas retéléchargés.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const API = (args.api || 'http://127.0.0.1:8787').replace(/\/$/, '');

async function getPassword() {
  if (process.env.ALBUM_PASSWORD) return process.env.ALBUM_PASSWORD;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(API);
  const devVars = new URL('../worker/.dev.vars', import.meta.url);
  if (local && existsSync(devVars)) {
    const line = readFileSync(devVars, 'utf8').split(/\r?\n/).find((l) => l.startsWith('ADMIN_PASSWORD='));
    if (line) return line.slice('ADMIN_PASSWORD='.length);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pwd = await rl.question('Mot de passe de l’album : ');
  rl.close();
  return pwd;
}

async function json(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${data.error || ''}`);
  return data;
}

const login = await json('POST', '/api/login', { body: { password: await getPassword() } });
const album = await json('GET', '/api/album');
const { trash } = await json('GET', '/api/trash', { token: login.token });

const day = new Date().toISOString().slice(0, 10);
const dir = join(args.dir || 'sauvegarde', day);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'album.json'), JSON.stringify({ ...album, trash }, null, 2));

const items = [...album.items, ...trash.map((t) => t.item)];
let files = 0, bytes = 0;
for (const item of items) {
  const names = item.type === 'video' ? ['s.jpg', 'm.jpg', item.video || 'video.mp4'] : ['s.jpg', 'm.jpg', 'l.jpg'];
  mkdirSync(join(dir, 'media', item.id), { recursive: true });
  for (const name of names) {
    const target = join(dir, 'media', item.id, name);
    if (existsSync(target)) continue;
    const res = await fetch(`${API}/media/${item.id}/${name}`);
    if (!res.ok) {
      console.error(`  manquant : media/${item.id}/${name} (${res.status})`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(target, buf);
    files++;
    bytes += buf.length;
  }
}
console.log(`Sauvegarde terminée dans ${dir} : ${items.length} médias, ${files} fichiers téléchargés (${(bytes / 1048576).toFixed(1)} Mo).`);
