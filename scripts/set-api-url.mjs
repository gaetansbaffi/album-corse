/**
 * Règle l'adresse de l'API (Worker Cloudflare) dans le site : config.js + index.html (aperçu Open Graph, sécurité CSP).
 *   npm run set-api-url -- https://album-corse.VOTRE-COMPTE.workers.dev
 */
import { readFileSync, writeFileSync } from 'node:fs';

const next = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(next)) {
  console.error('Indiquez l’adresse complète du Worker, par ex. : npm run set-api-url -- https://album-corse.mon-compte.workers.dev');
  process.exit(1);
}

const configUrl = new URL('../site/js/config.js', import.meta.url);
const indexUrl = new URL('../site/index.html', import.meta.url);
const config = readFileSync(configUrl, 'utf8');
const current = config.match(/ALBUM_API_PROD = '([^']+)'/)?.[1];
if (!current) {
  console.error('Adresse actuelle introuvable dans site/js/config.js');
  process.exit(1);
}

let count = 0;
for (const file of [configUrl, indexUrl]) {
  const text = readFileSync(file, 'utf8');
  const parts = text.split(current);
  count += parts.length - 1;
  writeFileSync(file, parts.join(next));
}
console.log(`Adresse de l’API : ${current} → ${next} (${count} remplacements)`);
console.log('Pensez à mettre l’adresse de votre site GitHub Pages dans ALLOWED_ORIGINS (worker/wrangler.toml), puis : npm run deploy:api');
