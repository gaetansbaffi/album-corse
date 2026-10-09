// Adresse de l'API (Worker Cloudflare). Réglée par : npm run set-api-url -- https://album-corse.VOTRE-COMPTE.workers.dev
// En local (localhost), l'API de développement est utilisée automatiquement.
window.ALBUM_API_PROD = 'https://album-corse.album-corse.workers.dev';
window.ALBUM_API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://127.0.0.1:8787' : window.ALBUM_API_PROD;
