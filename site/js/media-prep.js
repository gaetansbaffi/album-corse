// Préparation des fichiers dans le navigateur, avant l'envoi :
// - photos : orientation corrigée, 3 tailles en JPEG, toutes les métadonnées (EXIF, GPS) supprimées ;
// - vidéos : métadonnées (dont la position GPS) neutralisées, image d'aperçu générée.

export const MAX_VIDEO_MB = 95;
const SIZES = { 's.jpg': 480, 'm.jpg': 1024, 'l.jpg': 1600 };
const QUALITY = { 's.jpg': 0.74, 'm.jpg': 0.8, 'l.jpg': 0.82 };

export class PrepError extends Error {}

/* ---------------------------------------------------------------- date de prise de vue */

const pad = (n) => String(n).padStart(2, '0');
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const isVideoFile = (file) => file.type.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(file.name);

/** Date d'enregistrement inscrite dans une vidéo MP4/MOV (bloc « mvhd », secondes depuis 1904). */
async function videoCreationDate(file) {
  const moov = (await readBoxes(file, 0, file.size)).find((b) => b.type === 'moov');
  if (!moov) return null;
  const bytes = new Uint8Array(await file.slice(moov.off, moov.off + Math.min(moov.size, 4096)).arrayBuffer());
  const view = new DataView(bytes.buffer);
  for (let i = 8; i + 24 < bytes.length; i++) {
    if (bytes[i] === 0x6d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) { // « mvhd »
      const version = bytes[i + 4];
      const secs = version === 1 ? Number(view.getBigUint64(i + 8)) : view.getUint32(i + 8);
      if (!secs) return null;
      const d = new Date((secs - 2082844800) * 1000);
      // Rejette les dates absurdes (horloge non réglée, valeur par défaut…)
      return d.getFullYear() >= 2015 && d <= new Date(Date.now() + 86400000) ? d : null;
    }
  }
  return null;
}

/**
 * Date de prise de vue et sa fiabilité :
 *  - 'photo' : date enregistrée par l'appareil (EXIF ou vidéo) → fiable ;
 *  - 'whatsapp' / 'nom' / 'fichier' : déduite autrement → à vérifier.
 */
export async function detectDate(file) {
  if (!isVideoFile(file) && window.exifr) {
    try {
      // (la version « lite » d'exifr n'accepte pas la forme parse(fichier, [liste de champs]))
      const exif = await window.exifr.parse(file);
      const d = exif?.DateTimeOriginal || exif?.CreateDate;
      if (d instanceof Date && !isNaN(d)) return { takenAt: localIso(d), source: 'photo' };
    } catch { /* pas d'EXIF lisible */ }
  }
  // WhatsApp efface la date des photos et ré-encode les vidéos : la date de son nom de fichier est celle de l'envoi.
  let m = file.name.match(/(\d{4})-(\d{2})-(\d{2}) at (\d{2})\.(\d{2})\.(\d{2})/);
  if (m) return { takenAt: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, source: 'whatsapp' };
  if (isVideoFile(file)) {
    try {
      const d = await videoCreationDate(file);
      if (d) return { takenAt: localIso(d), source: 'photo' };
    } catch { /* structure illisible : on continue */ }
  }
  m = file.name.match(/(20\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/);
  if (m) return { takenAt: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, source: 'nom' };
  return { takenAt: localIso(new Date(file.lastModified || Date.now())), source: 'fichier' };
}

/* ---------------------------------------------------------------- photos */

async function decodeImage(file) {
  // createImageBitmap applique l'orientation EXIF (comportement par défaut des navigateurs récents)
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* on tente la méthode classique */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new PrepError('Ce format de photo n’est pas reconnu par ce navigateur (photo iPhone « HEIC » ?). Essayez depuis le téléphone, ou enregistrez-la en JPEG.');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PrepError('La photo n’a pas pu être préparée (mémoire insuffisante ?).'))), 'image/jpeg', quality));
}

/** Redimensionne par étapes successives (meilleure netteté que d'un seul coup). */
function resize(source, srcW, srcH, max) {
  const f = Math.min(1, max / Math.max(srcW, srcH));
  const w = Math.round(srcW * f);
  const h = Math.round(srcH * f);
  let current = source, cw = srcW, ch = srcH;
  while (cw / 2 >= w && ch / 2 >= h) {
    const step = document.createElement('canvas');
    step.width = Math.round(cw / 2);
    step.height = Math.round(ch / 2);
    const sctx = step.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(current, 0, 0, step.width, step.height);
    current = step; cw = step.width; ch = step.height;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(current, 0, 0, w, h);
  return canvas;
}

async function preparePhoto(file) {
  const image = await decodeImage(file);
  const w = image.width || image.naturalWidth;
  const h = image.height || image.naturalHeight;
  const files = {};
  // Ré-encoder via un canevas supprime toutes les métadonnées : rien d'autre que les pixels n'est conservé.
  for (const [name, max] of Object.entries(SIZES)) files[name] = await canvasToBlob(resize(image, w, h, max), QUALITY[name]);
  image.close?.();
  return { type: 'photo', files, w, h };
}

/* ---------------------------------------------------------------- vidéos : lecture de la structure MP4/MOV */

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
const PRIVATE = new Set(['udta', 'meta', 'uuid', 'XMP_']);

async function readBoxes(blob, start, end) {
  const boxes = [];
  let off = start;
  while (off + 8 <= end) {
    const head = new DataView(await blob.slice(off, Math.min(off + 16, end)).arrayBuffer());
    let size = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    let header = 8;
    if (size === 1) {
      size = Number(head.getBigUint64(8));
      header = 16;
    } else if (size === 0) size = end - off;
    if (size < header || off + size > end) throw new PrepError('Cette vidéo semble abîmée ou incomplète.');
    boxes.push({ type, off, size, header });
    off += size;
  }
  return boxes;
}

/** Dans le bloc « moov » : neutralise les métadonnées (renommées en « free », contenu effacé) et repère le codec. */
function scrubMoov(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const codecs = [];
  const walk = (start, end) => {
    let off = start;
    while (off + 8 <= end) {
      let size = view.getUint32(off);
      const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      let header = 8;
      if (size === 1) { size = Number(view.getBigUint64(off + 8)); header = 16; }
      else if (size === 0) size = end - off;
      if (size < header || off + size > end) return;
      if (PRIVATE.has(type)) {
        bytes.set([0x66, 0x72, 0x65, 0x65], off + 4); // « free »
        bytes.fill(0, off + header, off + size);
      } else if (type === 'stsd') {
        const entry = off + header + 8;
        codecs.push(String.fromCharCode(bytes[entry + 4], bytes[entry + 5], bytes[entry + 6], bytes[entry + 7]));
      } else if (CONTAINERS.has(type)) {
        walk(off + header, off + size);
      }
      off += size;
    }
  };
  walk(8, bytes.length);
  return codecs;
}

async function cleanVideo(file) {
  const boxes = await readBoxes(file, 0, file.size);
  if (!boxes.some((b) => b.type === 'moov')) throw new PrepError('Ce fichier vidéo n’est pas reconnu (formats acceptés : MP4 ou MOV).');
  let codecs = [];
  const parts = [];
  for (const box of boxes) {
    if (box.type === 'moov') {
      const bytes = new Uint8Array(await file.slice(box.off, box.off + box.size).arrayBuffer());
      codecs = scrubMoov(bytes);
      parts.push(bytes);
    } else if (PRIVATE.has(box.type) && box.size < 16 * 1024 * 1024) {
      // Bloc de métadonnées au premier niveau (ex. XMP) : remplacé par un bloc vide de même taille
      const bytes = new Uint8Array(box.size);
      new DataView(bytes.buffer).setUint32(0, box.header === 16 ? 1 : box.size);
      bytes.set([0x66, 0x72, 0x65, 0x65], 4);
      if (box.header === 16) new DataView(bytes.buffer).setBigUint64(8, BigInt(box.size));
      parts.push(bytes);
    } else {
      parts.push(file.slice(box.off, box.off + box.size)); // les images de la vidéo ne sont pas recopiées en mémoire
    }
  }
  return { blob: new Blob(parts, { type: 'video/mp4' }), codecs };
}

function posterFrame(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const fail = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error('aperçu impossible'));
    };
    const timer = setTimeout(fail, 20000);
    video.addEventListener('error', fail, { once: true });
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(1, (video.duration || 3) / 3);
    }, { once: true });
    video.addEventListener('seeked', () => {
      clearTimeout(timer);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      URL.revokeObjectURL(url);
      resolve({ canvas, w: video.videoWidth, h: video.videoHeight, duration: video.duration });
    }, { once: true });
    video.src = url;
  });
}

/** Image d'aperçu de secours si le navigateur ne sait pas lire la vidéo. */
function fallbackPoster() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 1280, 720);
  g.addColorStop(0, '#0e4f5c');
  g.addColorStop(1, '#3d5e3a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.beginPath();
  ctx.moveTo(590, 290); ctx.lineTo(590, 430); ctx.lineTo(710, 360); ctx.closePath();
  ctx.fill();
  return { canvas, w: 1280, h: 720, duration: 0 };
}

async function prepareVideo(file) {
  if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
    throw new PrepError(`Cette vidéo est trop lourde (${Math.round(file.size / 1048576)} Mo, maximum ${MAX_VIDEO_MB} Mo). Envoyez-la au webmaster pour qu’il la compresse, ou filmez une séquence plus courte.`);
  }
  if (/webm$/i.test(file.type) || /\.webm$/i.test(file.name)) {
    throw new PrepError('Le format WebM n’est pas accepté. Utilisez une vidéo MP4 ou MOV (celles du téléphone).');
  }
  const { blob, codecs } = await cleanVideo(file);
  let poster;
  try {
    poster = await posterFrame(blob);
  } catch {
    poster = fallbackPoster();
  }
  const files = { 'video.mp4': blob };
  for (const name of ['s.jpg', 'm.jpg']) files[name] = await canvasToBlob(resize(poster.canvas, poster.w, poster.h, SIZES[name]), 0.78);
  const codecWarning = codecs.some((c) => /^(hvc1|hev1|dvh1|dvhe)$/.test(c)); // HEVC : pas lisible partout
  return { type: 'video', files, w: poster.w, h: poster.h, duration: poster.duration || 0, codecWarning };
}

/* ---------------------------------------------------------------- point d'entrée */

/** `day` (AAAA-MM-JJ) : jour choisi par l'utilisatrice, prioritaire sur la date détectée. */
export async function prepareFile(file, { day } = {}) {
  const isVideo = isVideoFile(file);
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  if (!isVideo && !isImage) throw new PrepError('Ce fichier n’est ni une photo ni une vidéo.');
  let { takenAt } = await detectDate(file);
  if (day && day !== takenAt.slice(0, 10)) takenAt = `${day}${takenAt.slice(10)}`; // garde l'heure, change le jour
  const result = isVideo ? await prepareVideo(file) : await preparePhoto(file);
  return { ...result, takenAt, day: takenAt.slice(0, 10) };
}
