/**
 * Import d'un dossier de photos et vidéos dans l'album.
 *
 *   npm run import -- --api https://album-corse.VOTRE-COMPTE.workers.dev --dir medias-source
 *
 * Mot de passe : variable d'environnement ALBUM_PASSWORD, sinon il est demandé au clavier
 * (en local, il est lu dans worker/.dev.vars).
 *
 * Pour chaque photo : orientation corrigée, 3 tailles (480, 1024, 1600 px), métadonnées EXIF/GPS supprimées.
 * Pour chaque vidéo : mp4 H.264 « faststart » sans métadonnées (ré-encodée si nécessaire) + image d'aperçu.
 * Le script peut être relancé sans risque : les fichiers déjà importés (ou mis à la corbeille) sont ignorés.
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { createInterface } from 'node:readline/promises';
import sharp from 'sharp';
import exifr from 'exifr';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const API = (args.api || 'http://127.0.0.1:8787').replace(/\/$/, '');
const DIR = args.dir || 'medias-source';
const MAX_VIDEO_BYTES = 95 * 1024 * 1024;
const SIZES = { 's.jpg': 480, 'm.jpg': 1024, 'l.jpg': 1600 };
const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.3gp', '.webm', '.avi', '.mkv']);

/* ---------------------------------------------------------------- utilitaires */

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

async function api(method, path, { token, body, contentType } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body && contentType) headers['content-type'] = contentType;
  else if (body) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(API + path, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.error || ''}`);
  return data;
}

const pad = (n) => String(n).padStart(2, '0');
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Date de prise de vue : EXIF, sinon nom de fichier (WhatsApp, Android…), sinon date du fichier. */
async function shotDate(file) {
  try {
    const exif = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
    const d = exif?.DateTimeOriginal || exif?.CreateDate;
    if (d instanceof Date && !isNaN(d)) return { iso: localIso(d), source: 'EXIF' };
  } catch { /* pas d'EXIF */ }
  const name = basename(file);
  // WhatsApp : date d'envoi (WhatsApp efface la date des photos et ré-encode les vidéos)
  let m = name.match(/(\d{4})-(\d{2})-(\d{2}) at (\d{2})\.(\d{2})\.(\d{2})/);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, source: 'envoi WhatsApp, à vérifier' };
  if (VIDEO_EXT.has(extname(file).toLowerCase())) {
    try {
      const created = probe(file).format?.tags?.creation_time; // date d'enregistrement de la vidéo (UTC)
      const d = created && new Date(created);
      if (d && !isNaN(d) && d.getFullYear() >= 2015) return { iso: localIso(d), source: 'vidéo' };
    } catch { /* pas de date dans la vidéo */ }
  }
  m = name.match(/(20\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/); // IMG_20261004_072839
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, source: 'nom du fichier' };
  return { iso: localIso(statSync(file).mtime), source: 'date du fichier' };
}

function fileId(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 32);
}

/* ---------------------------------------------------------------- traitement */

async function processPhoto(file) {
  const meta = await sharp(file, { failOn: 'none' }).metadata();
  const swap = (meta.orientation || 1) >= 5; // orientations 5 à 8 = photo tournée de 90°
  const outputs = {};
  for (const [name, max] of Object.entries(SIZES)) {
    // .rotate() sans argument applique l'orientation EXIF ;
    // sharp ne recopie aucune métadonnée (EXIF, GPS) tant qu'on n'appelle pas withMetadata().
    outputs[name] = await sharp(file, { failOn: 'none' })
      .rotate()
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: name === 's.jpg' ? 74 : 80, mozjpeg: true, progressive: true })
      .toBuffer();
  }
  return { outputs, w: swap ? meta.height : meta.width, h: swap ? meta.width : meta.height };
}

function probe(file) {
  const out = execFileSync(ffprobe.path, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
  return JSON.parse(out.toString());
}

async function processVideo(file, work) {
  const info = probe(file);
  const v = info.streams.find((s) => s.codec_type === 'video');
  const hasAudio = info.streams.some((s) => s.codec_type === 'audio');
  const size = statSync(file).size;
  const out = join(work, 'video.mp4');
  const copyOk = v.codec_name === 'h264' && v.pix_fmt === 'yuv420p' && size <= MAX_VIDEO_BYTES
    && info.streams.every((s) => s.codec_type !== 'audio' || s.codec_name === 'aac');

  const common = ['-y', '-v', 'error', '-i', file, '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0'] : []), '-map_metadata', '-1', '-map_chapters', '-1'];
  if (copyOk) {
    execFileSync(ffmpegPath, [...common, '-c', 'copy', '-movflags', '+faststart', out]);
  } else {
    console.log('    ré-encodage en H.264 (peut prendre une minute)…');
    execFileSync(ffmpegPath, [...common,
      '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'",
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
  }
  if (statSync(out).size > MAX_VIDEO_BYTES) throw new Error('vidéo encore trop lourde après compression');

  const outInfo = probe(out);
  const ov = outInfo.streams.find((s) => s.codec_type === 'video');
  const rotation = Math.abs(Number(ov.tags?.rotate || ov.side_data_list?.find((d) => d.rotation !== undefined)?.rotation || 0)) % 180;
  const [w, h] = rotation === 90 ? [ov.height, ov.width] : [ov.width, ov.height];
  const duration = Number(outInfo.format.duration) || 0;

  const posterFile = join(work, 'poster.jpg');
  execFileSync(ffmpegPath, ['-y', '-v', 'error', '-ss', String(Math.min(1, duration / 3)), '-i', out, '-frames:v', '1', '-q:v', '2', posterFile]);
  const outputs = { 'video.mp4': readFileSync(out) };
  for (const name of ['s.jpg', 'm.jpg']) {
    outputs[name] = await sharp(posterFile)
      .resize({ width: SIZES[name], height: SIZES[name], fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true, progressive: true })
      .toBuffer();
  }
  return { outputs, w, h, duration, reencoded: !copyOk };
}

/* ---------------------------------------------------------------- programme */

const files = readdirSync(DIR)
  .map((f) => join(DIR, f))
  .filter((f) => statSync(f).isFile() && (PHOTO_EXT.has(extname(f).toLowerCase()) || VIDEO_EXT.has(extname(f).toLowerCase())));

console.log(`Album : ${API}\nDossier : ${DIR} (${files.length} fichiers)\n`);
const { token } = await api('POST', '/api/login', { body: { password: await getPassword() } });
const album = await api('GET', '/api/album');
const { trash } = await api('GET', '/api/trash', { token });
const known = new Set([...album.items.map((i) => i.id), ...trash.map((t) => t.item.id)]);

const entries = [];
for (const file of files) entries.push({ file, date: await shotDate(file) });
// Ordre chronologique ; à heure égale, l'ordre des noms de fichiers.
entries.sort((a, b) => a.date.iso.localeCompare(b.date.iso) || a.file.localeCompare(b.file, 'fr', { numeric: true }));

let added = 0, skipped = 0, errors = 0;
const seen = new Map();
for (const { file, date } of entries) {
  const name = basename(file);
  const id = fileId(file);
  if (seen.has(id)) {
    console.log(`  doublon        ${name}  (identique à ${seen.get(id)}, ignoré)`);
    skipped++;
    continue;
  }
  seen.set(id, name);
  if (known.has(id)) {
    console.log(`  déjà présent   ${name}`);
    skipped++;
    continue;
  }
  const isVideo = VIDEO_EXT.has(extname(file).toLowerCase());
  const work = mkdtempSync(join(tmpdir(), 'album-'));
  try {
    const r = isVideo ? await processVideo(file, work) : await processPhoto(file);
    for (const [variant, buf] of Object.entries(r.outputs)) {
      await api('PUT', `/api/upload/${id}/${variant}`, { token, body: buf, contentType: variant.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' });
    }
    await api('POST', '/api/items', {
      token,
      body: { id, type: isVideo ? 'video' : 'photo', day: date.iso.slice(0, 10), takenAt: date.iso, w: r.w, h: r.h, duration: r.duration },
    });
    const kb = Math.round(Object.values(r.outputs).reduce((s, b) => s + b.length, 0) / 1024);
    console.log(`  ajouté         ${name}  (${date.iso.replace('T', ' ')}, date: ${date.source}, ${r.w}×${r.h}, ${kb} Ko${r.reencoded ? ', ré-encodée' : ''})`);
    added++;
  } catch (err) {
    console.error(`  ERREUR         ${name} : ${err.message}`);
    errors++;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\nTerminé : ${added} ajouté(s), ${skipped} déjà présent(s), ${errors} erreur(s).`);
process.exit(errors ? 1 : 0);
