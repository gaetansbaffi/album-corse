// Petits outils partagés (affichage, dates, adresses des médias).

export const API = window.ALBUM_API;

/** Crée un élément DOM sans jamais interpréter de HTML (protège contre l'injection de code). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'html') throw new Error('html interdit');
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Icône SVG à partir d'un tracé (chemin « d »). */
export function icon(d, { fill = true, viewBox = '0 0 24 24' } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  if (!fill) {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2.2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(path);
  return svg;
}

export const ICONS = {
  play: 'M8 5.5v13l10.5-6.5z',
  pin: 'M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 4.9 6.5 12.5 6.5 12.5s6.5-7.6 6.5-12.5A6.5 6.5 0 0 0 12 2.5zm0 9a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
  video: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h10A1.5 1.5 0 0 1 16 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 17.5zM17 10l4-2.5v9L17 14z',
};

export function mediaUrl(item, file) {
  return `${API}/media/${item.id}/${file}`;
}

/** Dimensions d'une version réduite (côté le plus long limité à `max`). */
export function scaled(item, max) {
  const f = Math.min(1, max / Math.max(item.w, item.h));
  return { w: Math.round(item.w * f), h: Math.round(item.h * f) };
}

export function parseDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDay(day) {
  return parseDay(day).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatShortDay(day) {
  return parseDay(day).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function dayNumber(day, firstDay) {
  return Math.round((parseDay(day) - parseDay(firstDay)) / 86400000) + 1;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}

/** Message temporaire en bas de l'écran, avec un bouton facultatif. */
export function toast(message, { type = 'info', action, onAction, duration = 6000 } = {}) {
  const box = document.getElementById('toasts');
  const node = el('div', { class: `toast toast--${type}` }, el('p', {}, message));
  let timer;
  const close = () => {
    clearTimeout(timer);
    node.remove();
  };
  if (action) {
    node.append(el('button', {
      class: 'btn', type: 'button',
      onclick: () => {
        close();
        onAction();
      },
    }, action));
  }
  if (!duration) node.append(el('button', { class: 'btn', type: 'button', onclick: close }, 'Fermer'));
  box.append(node);
  if (duration) timer = setTimeout(close, duration);
  return close;
}
