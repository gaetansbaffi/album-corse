// Film du voyage : mise en scène animée des photos et vidéos de l'album.
// Tout est calculé à partir du temps t (en secondes) : le film se lit dans le navigateur
// et peut aussi être enregistré image par image en MP4 (scripts/record-film.mjs, page ouverte avec ?capture).
import { formatDay, dayNumber, plural } from './util.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
const API = params.get('api') === 'prod' ? window.ALBUM_API_PROD : window.ALBUM_API;
const W = 1920;
const H = 1080;
const FADE = 0.8; // durée des fondus entre scènes

if (CAPTURE) document.documentElement.classList.add('capture');
const stage = document.getElementById('stage');
const mediaUrl = (item, file) => `${API}/media/${item.id}/${file}`;

/* ---------------------------------------------------------------- outils */

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = {
  out: (p) => 1 - (1 - p) ** 3,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
  back: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
};
const portrait = (item) => item.h > item.w;
const shortDate = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const stampDate = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).toUpperCase();

function make(tag, { cls, text, style } = {}, parent) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  if (style) Object.assign(node.style, style);
  if (parent) parent.append(node);
  return node;
}

const loads = [];
function img(src, cls, parent, style) {
  const node = make('img', { cls, style }, parent);
  node.alt = '';
  node.decoding = 'sync';
  node.src = src;
  // decode() peut rester en attente si l'onglet est masqué : on se contente du chargement, avec un délai maximal
  loads.push(new Promise((resolve) => {
    if (node.complete) return resolve();
    node.addEventListener('load', resolve, { once: true });
    node.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 20000);
  }));
  return node;
}

function video(src, parent) {
  const node = make('video', {}, parent);
  node.muted = true;
  node.playsInline = true;
  node.preload = 'auto';
  node.src = src;
  loads.push(new Promise((resolve) => {
    node.addEventListener('loadeddata', resolve, { once: true });
    node.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 20000);
  }));
  return node;
}

let contourSvg = '';
function contours(parent, cls = '') {
  const box = make('div', { cls: `fill contours ${cls}` }, parent);
  box.innerHTML = contourSvg; // fichier statique du site (img/contours.svg)
  const paths = [...box.querySelectorAll('path')];
  paths.forEach((p) => p.setAttribute('pathLength', '1'));
  return { box, paths };
}

function tag(parent, item, n) {
  const node = make('div', { cls: 'abs tag', style: { left: '60px', bottom: '60px' } }, parent);
  make('span', { cls: 'balise' }, node);
  make('span', { text: `Jour ${n} · ${formatDay(item.day)}` }, node);
  return node;
}

function captionStrip(parent, item) {
  const text = [item.caption, item.place].filter(Boolean).join(' — ');
  if (!text) return null;
  return make('div', { cls: 'abs caption-strip', text, style: { left: '50%', bottom: '70px', transform: 'translateX(-50%)' } }, parent);
}

/* ---------------------------------------------------------------- scènes */

const scenes = [];
let cursor = 0;

function addScene(dur, build) {
  const root = make('div', { cls: 'scene' }, stage);
  const scene = { start: cursor, dur, root, on: false, video: null, videoTime: 0 };
  scene.update = build(root, scene);
  scenes.push(scene);
  cursor += dur - FADE;
  return scene;
}

function introScene() {
  addScene(8, (root) => {
    root.classList.add('bg-sea');
    const c = contours(root);
    c.paths.forEach((p) => { p.style.strokeDasharray = '1'; });
    const kicker = make('div', { cls: 'abs center-x kicker', text: 'Carnet de voyage', style: { top: '300px' } }, root);
    const title = make('div', { cls: 'abs center-x title', style: { top: '355px' } }, root);
    const letters = [...'Voyage en Corse'].map((ch) => make('span', { text: ch === ' ' ? ' ' : ch }, title));
    const date = make('div', { cls: 'abs hand', text: 'Octobre 2026', style: { top: '575px', left: '50%', fontSize: '130px', color: 'var(--gold)', whiteSpace: 'nowrap' } }, root);
    const balise = make('div', { cls: 'abs balise', style: { left: `${W / 2 - 60}px`, top: '800px' } }, root);
    make('div', { cls: 'vignette' }, root);
    return (p, t) => {
      c.paths.forEach((path, i) => { path.style.strokeDashoffset = String(1 - ease.inOut(seg(t, i * 0.6, 5 + i * 0.6))); });
      c.box.style.transform = `scale(${lerp(1.08, 1, ease.out(p))})`;
      kicker.style.opacity = seg(t, 0.6, 1.4);
      kicker.style.letterSpacing = `${lerp(0.7, 0.32, ease.out(seg(t, 0.6, 2.2)))}em`;
      letters.forEach((s, i) => {
        const q = ease.out(seg(t, 1 + i * 0.06, 1.9 + i * 0.06));
        s.style.opacity = q;
        s.style.transform = `translateY(${(1 - q) * 70}px)`;
      });
      const w = ease.inOut(seg(t, 2.7, 4.2)); // « écrit à la main » de gauche à droite
      date.style.transform = 'translateX(-50%)';
      date.style.clipPath = `inset(-20% ${(1 - w) * 100}% -20% 0)`;
      balise.style.opacity = seg(t, 3.9, 4.1);
      balise.style.transform = `scale(${ease.back(seg(t, 3.9, 4.6))})`;
    };
  });
}

// Silhouette simplifiée de la Corse (longitude, latitude), dans le sens des aiguilles d'une montre depuis le cap Corse
const CORSICA = [[9.40, 43.01], [9.45, 42.96], [9.48, 42.85], [9.46, 42.75], [9.45, 42.70], [9.53, 42.55], [9.54, 42.40], [9.55, 42.20],
  [9.52, 42.10], [9.45, 41.97], [9.40, 41.86], [9.37, 41.72], [9.33, 41.60], [9.28, 41.55], [9.25, 41.45], [9.16, 41.37], [9.08, 41.40],
  [8.95, 41.48], [8.87, 41.56], [8.85, 41.67], [8.78, 41.71], [8.72, 41.78], [8.62, 41.83], [8.70, 41.89], [8.68, 41.93], [8.61, 41.92],
  [8.62, 42.02], [8.60, 42.13], [8.55, 42.23], [8.64, 42.27], [8.60, 42.33], [8.56, 42.38], [8.64, 42.43], [8.68, 42.53], [8.75, 42.57],
  [8.85, 42.62], [8.94, 42.64], [9.05, 42.68], [9.30, 42.68], [9.33, 42.80], [9.34, 42.92]];
const project = ([lon, lat]) => [1150 + (lon - 8.5) * 470 * 0.743, 110 + (43.05 - lat) * 470];

function smoothClosed(points) {
  const pts = points.map(project);
  const n = pts.length;
  const f = (v) => v.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

function mapScene(firstDay, lastDay, days) {
  addScene(8, (root) => {
    root.classList.add('bg-night');
    const c = contours(root);
    c.box.style.opacity = '0.25';
    const [px, py] = project([9.05, 42.2]);
    const route = `M300 -80 C 520 320, 880 160, ${px} ${py}`;
    root.insertAdjacentHTML('beforeend', `
      <svg class="fill" viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <defs><mask id="route-mask" maskUnits="userSpaceOnUse"><path class="reveal" d="${route}" fill="none" stroke="#fff" stroke-width="14" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></mask></defs>
        <path class="island" d="${smoothClosed(CORSICA)}" fill="#e9dcc0" fill-opacity="0" stroke="#fff" stroke-width="4" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>
        <path d="${route}" fill="none" stroke="#ffe9b8" stroke-width="6" stroke-linecap="round" stroke-dasharray="18 16" mask="url(#route-mask)"/>
        <g class="pin" transform="translate(${px} ${py}) scale(0)">
          <ellipse cx="0" cy="2" rx="16" ry="5" fill="rgba(0,0,0,.35)"/>
          <path d="M0 0 C -14 -22 -30 -34 -30 -56 A30 30 0 1 1 30 -56 C 30 -34 14 -22 0 0Z" fill="#d1272f" stroke="#fff" stroke-width="4"/>
          <circle cx="0" cy="-56" r="11" fill="#fff"/>
        </g>
      </svg>`);
    const island = root.querySelector('.island');
    const reveal = root.querySelector('.reveal');
    const pin = root.querySelector('.pin');
    const sea = make('div', { cls: 'abs map-label', text: 'Méditerranée', style: { left: '170px', top: '520px' } }, root);
    const name = make('div', { cls: 'abs hand', text: 'Corse', style: { left: '880px', top: '430px', fontSize: '110px', color: '#fff' } }, root);
    const card = make('div', { cls: 'abs dates-card', style: { left: '160px', top: '700px' } }, root);
    card.append(`du ${shortDate(firstDay).replace(' octobre', '')} au ${shortDate(lastDay)} 2026`);
    make('small', { text: `${plural(days, 'jour', 'jours')} de voyage` }, card);
    make('div', { cls: 'vignette' }, root);
    return (p, t) => {
      island.style.strokeDashoffset = String(1 - ease.inOut(seg(t, 0.3, 3)));
      island.setAttribute('fill-opacity', String(0.95 * seg(t, 2.2, 3.4)));
      reveal.style.strokeDashoffset = String(1 - ease.inOut(seg(t, 3, 5)));
      const s = ease.back(seg(t, 5, 5.6));
      pin.setAttribute('transform', `translate(${px} ${py}) scale(${s})`);
      sea.style.opacity = seg(t, 1, 2) * 1;
      name.style.opacity = seg(t, 3.2, 4);
      name.style.transform = `translateY(${(1 - ease.out(seg(t, 3.2, 4))) * 30}px)`;
      const q = ease.out(seg(t, 5.4, 6.2));
      card.style.opacity = q;
      card.style.transform = `translateY(${(1 - q) * 40}px) rotate(-2deg)`;
    };
  });
}

function chapterScene(day, n, items, title) {
  addScene(3.8, (root) => {
    root.classList.add('bg-paper');
    const c = contours(root, 'contours--ink');
    c.box.style.opacity = '0.35';
    const id = `trail-${day}`;
    const mirror = n % 2 === 0; // une journée sur deux : rocher à droite, texte à gauche
    const trail = 'M-60 960 C 160 880, 220 760, 420 720';
    root.insertAdjacentHTML('beforeend', `
      <svg class="fill" viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <defs><mask id="${id}" maskUnits="userSpaceOnUse"><path class="reveal" d="${trail}" fill="none" stroke="#fff" stroke-width="20" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></mask></defs>
        <g${mirror ? ` transform="translate(${W} 0) scale(-1 1)"` : ''}>
          <path d="${trail}" fill="none" stroke="#d1272f" stroke-width="9" stroke-linecap="round" stroke-dasharray="28 20" mask="url(#${id})"/>
        </g>
      </svg>`);
    const reveal = root.querySelector('.reveal');
    const rock = make('div', { cls: 'abs rock', style: { left: mirror ? `${W - 360 - 300}px` : '360px', top: '410px' } }, root);
    make('div', { cls: 'balise' }, rock);
    const text = make('div', { cls: 'abs', style: { left: mirror ? '140px' : '780px', top: '330px', width: '1000px', textAlign: mirror ? 'right' : 'left' } }, root);
    const lines = [
      make('div', { cls: 'chapter__num', text: `Jour ${n}` }, text),
      make('div', { cls: 'chapter__date', text: formatDay(day) }, text),
    ];
    if (title) lines.push(make('div', { cls: 'chapter__title', text: title }, text));
    const photos = items.filter((i) => i.type === 'photo').length;
    const videos = items.length - photos;
    lines.push(make('div', { cls: 'chapter__meta', text: [photos ? plural(photos, 'photo', 'photos') : '', videos ? plural(videos, 'vidéo', 'vidéos') : ''].filter(Boolean).join(' · '), style: { marginTop: '24px' } }, text));
    return (p, t) => {
      reveal.style.strokeDashoffset = String(1 - ease.inOut(seg(t, 0, 1.3)));
      const r = ease.back(seg(t, 0.5, 1.2));
      const side = mirror ? -1 : 1;
      rock.style.transform = `scale(${r}) rotate(${lerp(-12, -3, r) * side}deg)`;
      lines.forEach((line, i) => {
        const q = ease.out(seg(t, 0.8 + i * 0.18, 1.6 + i * 0.18));
        line.style.opacity = q;
        line.style.transform = `translateX(${(1 - q) * 80 * side}px)`;
      });
      text.style.transform = `translateX(${-t * 8 * side}px)`;
    };
  });
}

/** Une photo en plein écran, avec un lent zoom (effet « Ken Burns »). */
function fullScene(item, n, dir) {
  addScene(5, (root) => {
    root.style.background = '#000';
    let main;
    if (portrait(item)) {
      img(mediaUrl(item, 'm.jpg'), 'cover', root, { filter: 'blur(36px) brightness(.55)', transform: 'scale(1.2)' });
      const h = 1000;
      const w = Math.round((h * item.w) / item.h);
      main = img(mediaUrl(item, 'l.jpg'), 'abs', root, { left: `${(W - w) / 2}px`, top: '40px', width: `${w}px`, height: `${h}px`, objectFit: 'cover', boxShadow: '0 30px 80px rgb(0 0 0 / .6)' });
    } else {
      main = img(mediaUrl(item, 'l.jpg'), 'cover', root);
    }
    const label = tag(root, item, n);
    const caption = captionStrip(root, item);
    make('div', { cls: 'vignette' }, root);
    return (p, t) => {
      const s = portrait(item) ? lerp(1.05, 1, p) : lerp(1.16, 1.03, ease.inOut(p));
      const x = portrait(item) ? 0 : lerp(-50, 50, p) * dir;
      main.style.transform = `translateX(${x}px) scale(${s})`;
      label.style.opacity = seg(t, 0.5, 1.2);
      if (caption) {
        caption.style.opacity = seg(t, 1, 1.6);
        caption.style.transform = `translateX(-50%) rotate(-1deg) translateY(${(1 - ease.out(seg(t, 1, 1.6))) * 30}px)`;
      }
    };
  });
}

/** Une photo en carte postale tamponnée. */
function postcardScene(item, n) {
  addScene(5.2, (root) => {
    root.classList.add('bg-table');
    const c = contours(root, 'contours--ink');
    c.box.style.opacity = '0.2';
    const imgW = 1100;
    const imgH = Math.min(760, Math.round((imgW * item.h) / item.w));
    const note = item.caption || item.place;
    const bottom = note ? 120 : 34;
    const card = make('div', { cls: 'postcard', style: { width: `${imgW + 68}px`, height: `${imgH + 34 + bottom}px`, left: `${(W - imgW - 68) / 2}px`, top: `${(H - imgH - 34 - bottom) / 2}px`, paddingBottom: `${bottom}px` } }, root);
    img(mediaUrl(item, 'l.jpg'), '', card);
    if (note) make('div', { cls: 'abs hand', text: note, style: { left: '40px', right: '40px', bottom: '22px', fontSize: '64px', color: '#1f3a5f', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' } }, card);
    const stamp = make('div', { cls: 'stamp', style: { right: '-50px', top: '-70px' } }, card);
    const inner = make('div', { cls: 'stamp__inner' }, stamp);
    inner.append('Corse');
    make('small', { text: '2026' }, inner);
    const postmark = make('div', { cls: 'postmark', style: { right: '110px', top: '-40px' } }, card);
    postmark.append(stampDate(item.day));
    postmark.append(document.createElement('br'));
    postmark.append('2026');
    const label = tag(root, item, n);
    make('div', { cls: 'vignette' }, root);
    return (p, t) => {
      const q = ease.out(seg(t, 0, 1.3));
      card.style.transform = `translateY(${(1 - q) * 800}px) rotate(${lerp(10, -2.5, q) + t * 0.15}deg) scale(${lerp(1, 1.04, p)})`;
      const st = ease.out(seg(t, 1.3, 1.8));
      stamp.style.opacity = seg(t, 1.3, 1.4);
      stamp.style.transform = `scale(${lerp(1.7, 1, st)}) rotate(6deg)`;
      postmark.style.opacity = 0.9 * seg(t, 1.9, 2.1);
      postmark.style.transform = `scale(${lerp(1.3, 1, ease.out(seg(t, 1.9, 2.3)))}) rotate(-14deg)`;
      label.style.opacity = seg(t, 0.8, 1.4);
    };
  });
}

/** 2 ou 3 tirages qui tombent sur la table. */
function printsScene(items, n) {
  const three = items.length === 3;
  addScene(three ? 6.2 : 5.4, (root) => {
    root.classList.add('bg-table');
    const table = make('div', { cls: 'fill' }, root);
    const c = contours(table, 'contours--ink');
    c.box.style.opacity = '0.2';
    const slots = three
      ? [{ x: 150, y: 130, r: -7 }, { x: 700, y: 230, r: 4 }, { x: 1250, y: 120, r: -3 }]
      : [{ x: 330, y: 150, r: -5 }, { x: 1010, y: 190, r: 4 }];
    const width = three ? 520 : 580;
    const prints = items.map((item, i) => {
      const print = make('div', { cls: 'print', style: { left: `${slots[i].x}px`, top: `${slots[i].y}px`, width: `${width}px` } }, table);
      img(mediaUrl(item, 'm.jpg'), '', print);
      make('div', { cls: 'print__note', text: item.caption || item.place || shortDate(item.day) }, print);
      return print;
    });
    const label = tag(root, items[0], n);
    make('div', { cls: 'vignette' }, root);
    return (p, t) => {
      table.style.transform = `scale(${lerp(1, 1.05, p)})`;
      prints.forEach((print, i) => {
        const s = 0.2 + i * 0.7;
        const q = ease.out(seg(t, s, s + 0.75));
        print.style.opacity = seg(t, s, s + 0.15);
        print.style.transform = `translateY(${(1 - q) * -140}px) rotate(${slots[i].r + (1 - q) * 14}deg) scale(${lerp(1.4, 1, q)})`;
      });
      label.style.opacity = seg(t, 0.6, 1.2);
    };
  });
}

/** Deux photos verticales côte à côte, qui glissent en sens opposés. */
function diptychScene(a, b, n) {
  addScene(5.2, (root) => {
    root.classList.add('bg-night');
    const c = contours(root);
    c.box.style.opacity = '0.2';
    const h = 900;
    const wa = Math.round((h * a.w) / a.h);
    const wb = Math.round((h * b.w) / b.h);
    const gap = 70;
    const left = (W - wa - wb - gap) / 2;
    const pa = make('div', { cls: 'panel', style: { left: `${left}px`, top: '70px', width: `${wa}px`, height: `${h}px` } }, root);
    const pb = make('div', { cls: 'panel', style: { left: `${left + wa + gap}px`, top: '70px', width: `${wb}px`, height: `${h}px` } }, root);
    const ia = img(mediaUrl(a, 'l.jpg'), '', pa);
    const ib = img(mediaUrl(b, 'l.jpg'), '', pb);
    const label = tag(root, a, n);
    make('div', { cls: 'vignette' }, root);
    return (p, t) => {
      const qa = ease.out(seg(t, 0, 1.2));
      const qb = ease.out(seg(t, 0.25, 1.45));
      pa.style.transform = `translateY(${(1 - qa) * -1100}px) rotate(-1.5deg)`;
      pb.style.transform = `translateY(${(1 - qb) * 1100}px) rotate(1.5deg)`;
      ia.style.transform = `scale(${lerp(1.1, 1, p)})`;
      ib.style.transform = `scale(${lerp(1.1, 1, p)})`;
      label.style.opacity = seg(t, 1, 1.6);
    };
  });
}

/** Un extrait de vidéo dans un cadre de pellicule. */
function videoScene(item, n) {
  const clip = Math.min(7, Math.max(2, (item.duration || 6) - 1));
  addScene(clip + 1.4, (root, scene) => {
    root.style.background = '#151515';
    const strips = [make('div', { cls: 'film-strip', style: { left: '40px' } }, root), make('div', { cls: 'film-strip', style: { right: '40px' } }, root)];
    const maxW = 1460;
    const maxH = 860;
    const ratio = item.w / item.h;
    const w = Math.round(Math.min(maxW, maxH * ratio));
    const h = Math.round(w / ratio);
    const box = make('div', { cls: 'clip', style: { width: `${w}px`, height: `${h}px`, left: `${(W - w) / 2}px`, top: `${(H - h) / 2 - 20}px` } }, root);
    scene.video = video(mediaUrl(item, item.video || 'video.mp4'), box);
    scene.video.poster = mediaUrl(item, 'm.jpg');
    const rec = make('div', { cls: 'abs rec', style: { left: `${(W - w) / 2}px`, top: `${(H - h) / 2 - 75}px` } }, root);
    const dot = make('i', {}, rec);
    rec.append('Souvenir filmé');
    const label = tag(root, item, n);
    return (p, t) => {
      strips.forEach((s, i) => { s.style.backgroundPosition = `center ${(i ? -1 : 1) * t * 180}px`; });
      const q = ease.out(seg(t, 0, 0.8));
      box.style.transform = `scale(${lerp(0.9, 1, q)})`;
      dot.style.opacity = Math.floor(t * 2) % 2 ? 0.25 : 1;
      label.style.opacity = seg(t, 0.4, 1);
      scene.videoTime = 0.5 + Math.max(0, t - 0.5);
    };
  });
}

function outroScene(stats) {
  const s = addScene(8, (root) => {
    root.classList.add('bg-sea');
    const c = contours(root);
    c.paths.forEach((p) => { p.style.strokeDasharray = '1'; });
    const line1 = make('div', { cls: 'abs center-x hand', text: 'À bientôt, la Corse', style: { top: '330px', fontSize: '160px', color: 'var(--gold)' } }, root);
    const line2 = make('div', { cls: 'abs center-x', text: stats, style: { top: '560px', font: '700 56px/1.2 var(--serif)' } }, root);
    const balise = make('div', { cls: 'abs balise', style: { left: `${W / 2 - 60}px`, top: '700px' } }, root);
    const line3 = make('div', { cls: 'abs center-x kicker', text: 'Octobre 2026', style: { top: '860px', fontSize: '26px' } }, root);
    make('div', { cls: 'vignette' }, root);
    return (p, t) => {
      c.paths.forEach((path, i) => { path.style.strokeDashoffset = String(1 - ease.inOut(seg(t, i * 0.5, 4 + i * 0.5))); });
      const q = ease.inOut(seg(t, 0.6, 2.2));
      line1.style.clipPath = `inset(-20% ${(1 - q) * 100}% -20% 0)`;
      line2.style.opacity = seg(t, 2.2, 3);
      balise.style.opacity = seg(t, 2.8, 3);
      balise.style.transform = `scale(${ease.back(seg(t, 2.8, 3.5))})`;
      line3.style.opacity = seg(t, 3.4, 4.2);
    };
  });
  s.last = true;
}

/* ---------------------------------------------------------------- montage */

function groupByDay(items) {
  const groups = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.day === item.day) last.items.push(item);
    else groups.push({ day: item.day, items: [item] });
  }
  return groups;
}

function buildFilm(album) {
  const { items, days = {} } = album;
  const groups = groupByDay(items);
  const firstDay = groups[0].day;
  const lastDay = groups[groups.length - 1].day;
  const span = dayNumber(lastDay, firstDay);
  const photos = items.filter((i) => i.type === 'photo').length;
  const videos = items.length - photos;

  introScene();
  mapScene(firstDay, lastDay, span);
  let variety = 0;
  for (const g of groups) {
    const n = dayNumber(g.day, firstDay);
    chapterScene(g.day, n, g.items, days[g.day]?.title);
    const queue = [...g.items];
    let first = true;
    while (queue.length) {
      if (queue[0].type === 'video') {
        videoScene(queue.shift(), n);
        continue;
      }
      const run = [];
      for (const x of queue) {
        if (x.type === 'video') break;
        run.push(x);
      }
      if (first) {
        fullScene(queue.shift(), n, variety % 2 ? -1 : 1);
      } else if (run.length >= 2 && portrait(run[0]) && portrait(run[1]) && variety % 2 === 0) {
        diptychScene(queue.shift(), queue.shift(), n);
      } else if (run.length >= 3 && variety % 3 !== 2) {
        printsScene(queue.splice(0, 3), n);
      } else if (!portrait(run[0])) {
        postcardScene(queue.shift(), n);
      } else if (run.length >= 2) {
        printsScene(queue.splice(0, 2), n);
      } else {
        fullScene(queue.shift(), n, variety % 2 ? -1 : 1);
      }
      first = false;
      variety++;
    }
  }
  outroScene(`${plural(photos, 'photo', 'photos')} · ${plural(videos, 'vidéo', 'vidéos')} · ${plural(span, 'jour', 'jours')}`);
}

/* ---------------------------------------------------------------- lecture */

let duration = 0;

/** Affiche l'image du film au temps t. En mode enregistrement, attend que les vidéos soient positionnées. */
function renderAt(t, { exact = false, playing = false } = {}) {
  const waits = [];
  for (const s of scenes) {
    const local = t - s.start;
    const visible = local >= 0 && local < s.dur;
    if (!visible) {
      if (s.on) {
        s.root.style.display = 'none';
        s.on = false;
        s.video?.pause();
      }
      continue;
    }
    if (!s.on) {
      s.root.style.display = 'block';
      s.on = true;
    }
    // La nouvelle scène apparaît en fondu par-dessus la précédente ; la dernière s'efface vers le noir.
    let opacity = s === scenes[0] ? seg(local, 0, 1) : seg(local, 0, FADE);
    if (s.last) opacity = Math.min(opacity, seg(s.dur - local, 0, 1.5));
    s.root.style.opacity = opacity;
    s.update(local / s.dur, local);
    if (s.video) {
      const v = s.video;
      const target = Math.min(s.videoTime, (v.duration || 999) - 0.05);
      if (exact) {
        v.pause();
        if (Math.abs(v.currentTime - target) > 0.001) {
          waits.push(new Promise((resolve) => {
            v.addEventListener('seeked', resolve, { once: true });
            setTimeout(resolve, 3000);
            v.currentTime = target;
          }));
        }
      } else if (playing) {
        if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
        if (v.paused) v.play().catch(() => {});
      } else {
        v.pause();
        v.currentTime = target;
      }
    }
  }
  return Promise.all(waits);
}

function fit() {
  if (CAPTURE) return;
  const s = Math.min(innerWidth / W, innerHeight / H);
  stage.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
}

const ui = {
  root: document.getElementById('film-ui'),
  start: document.getElementById('start'),
  label: document.getElementById('start-label'),
  controls: document.getElementById('controls'),
  play: document.getElementById('play'),
  seek: document.getElementById('seek'),
  time: document.getElementById('time'),
  fs: document.getElementById('fs'),
};
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let playing = false;
let offset = 0;
let t0 = 0;

function tick(now) {
  if (!playing) return;
  const t = offset + (now - t0) / 1000;
  if (t >= duration) {
    renderAt(duration - 0.01);
    pause();
    offset = 0;
    ui.start.hidden = false;
    ui.label.textContent = 'Revoir le film';
    return;
  }
  renderAt(t, { playing: true });
  ui.seek.value = String(Math.round((t / duration) * 1000));
  ui.time.textContent = `${fmt(t)} / ${fmt(duration)}`;
  requestAnimationFrame(tick);
}

function play() {
  playing = true;
  t0 = performance.now();
  ui.play.textContent = '❚❚';
  ui.play.setAttribute('aria-label', 'Pause');
  requestAnimationFrame(tick);
}

function pause() {
  if (playing) offset += (performance.now() - t0) / 1000;
  playing = false;
  ui.play.textContent = '▶';
  ui.play.setAttribute('aria-label', 'Lecture');
  scenes.forEach((s) => s.video?.pause());
}

function bindUi() {
  ui.start.addEventListener('click', () => {
    ui.start.hidden = true;
    document.getElementById('rotate-hint').hidden = true;
    ui.controls.hidden = false;
    if (offset >= duration - 0.1) offset = 0;
    play();
    showControls();
  });
  ui.play.addEventListener('click', () => (playing ? pause() : play()));
  ui.seek.addEventListener('input', () => {
    offset = (Number(ui.seek.value) / 1000) * duration;
    t0 = performance.now();
    if (!playing) renderAt(offset);
    ui.time.textContent = `${fmt(offset)} / ${fmt(duration)}`;
  });
  ui.fs.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  addEventListener('keydown', (e) => {
    if (e.key === ' ' && !ui.controls.hidden) {
      e.preventDefault();
      if (playing) pause();
      else play();
    }
  });
  let hideTimer;
  function showControls() {
    ui.root.classList.add('show-controls');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => ui.root.classList.remove('show-controls'), 2500);
  }
  addEventListener('pointermove', showControls);
  addEventListener('pointerdown', showControls);
  addEventListener('resize', fit);
}

/* ---------------------------------------------------------------- démarrage */

const ready = (async () => {
  const [album, svg] = await Promise.all([
    fetch(`${API}/api/album`, { cache: 'no-store' }).then((r) => r.json()),
    fetch('img/contours.svg').then((r) => r.text()),
  ]);
  contourSvg = svg;
  buildFilm(album);
  const last = scenes[scenes.length - 1];
  duration = last.start + last.dur;
  fit();
  await Promise.all([...loads, document.fonts.ready]);
  await renderAt(0, { exact: true });
  return duration;
})();

window.film = {
  ready,
  get duration() { return duration; },
  async seek(t) {
    await renderAt(t, { exact: true });
  },
};

if (!CAPTURE) {
  bindUi();
  ready.then(() => {
    ui.start.disabled = false;
    ui.label.textContent = `Lancer le film (${fmt(duration)})`;
    renderAt(4.6); // image d'aperçu : le titre (la lecture repart bien du début)
  }).catch(() => {
    ui.label.textContent = 'Impossible de charger l’album. Vérifiez la connexion.';
  });
}
