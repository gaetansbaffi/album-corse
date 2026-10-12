/**
 * Enregistre le film du voyage (site/film.html) en vidéo MP4 1920×1080, image par image.
 *
 *   npm run dev:site                      (dans une autre fenêtre : sert le site sur http://localhost:8080)
 *   npm run film                          → film/voyage-en-corse.mp4, à partir de l'album EN LIGNE
 *   npm run film -- --api local           → à partir de l'album local (npm run dev:api)
 *   npm run film -- --stills 5,20,60      → seulement quelques images fixes (PNG) pour vérifier
 *   npm run film -- --fps 25              → autre cadence (30 par défaut)
 *
 * Utilise Google Chrome (ou Microsoft Edge) déjà installé sur l'ordinateur, sans fenêtre visible.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import ffmpegPath from 'ffmpeg-static';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const FPS = Number(args.fps || 30);
const SITE = (args.site || 'http://localhost:8080').replace(/\/$/, '');
const url = `${SITE}/film.html?capture${args.api === 'local' ? '' : '&api=prod'}`;
const OUT_DIR = 'film';
const OUT = `${OUT_DIR}/voyage-en-corse.mp4`;

const BROWSERS = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
];
const executablePath = BROWSERS.find((p) => p && existsSync(p));
if (!executablePath) throw new Error('Ni Chrome ni Edge trouvés sur cet ordinateur.');

mkdirSync(OUT_DIR, { recursive: true });
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb'],
});

try {
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('Erreur dans la page :', err.message));
  console.log(`Ouverture de ${url} avec ${executablePath.split('\\').pop()}…`);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
  const duration = await page.evaluate(() => window.film.ready);
  console.log(`Film prêt : ${duration.toFixed(1)} s`);

  if (args.stills) {
    for (const t of args.stills.split(',').map(Number)) {
      await page.evaluate((x) => window.film.seek(x), t);
      const file = `${OUT_DIR}/apercu-${String(t).padStart(5, '0')}s.png`;
      writeFileSync(file, await page.screenshot({ type: 'png' }));
      console.log(`  image fixe ${file}`);
    }
  } else {
    const frames = Math.ceil(duration * FPS);
    const ffmpeg = spawn(ffmpegPath, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg a échoué (${code})`)))));
    const started = Date.now();
    for (let f = 0; f < frames; f++) {
      await page.evaluate((x) => window.film.seek(x), f / FPS);
      const jpg = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!ffmpeg.stdin.write(jpg)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
      if (f % (FPS * 10) === 0) {
        const pct = Math.round((f / frames) * 100);
        const eta = f ? Math.round(((Date.now() - started) / f) * (frames - f) / 1000) : '?';
        console.log(`  ${pct} % (${(f / FPS).toFixed(0)} s / ${duration.toFixed(0)} s) — reste environ ${eta} s`);
      }
    }
    ffmpeg.stdin.end();
    await done;
    console.log(`Vidéo terminée : ${OUT}`);
  }
} finally {
  await browser.close();
}
