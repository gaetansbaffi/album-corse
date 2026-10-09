// Affichage de l'album (consultation). Le mode édition est chargé à la demande (edit.js).
import { API, el, icon, ICONS, mediaUrl, scaled, formatDay, formatShortDay, dayNumber, formatDuration, plural, toast } from './util.js';
import { Viewer } from './viewer.js';

export const app = {
  album: null,
  editing: false,
  // Points d'accroche utilisés par le mode édition
  hooks: { decorateCard: null, decorateDay: null, afterRender: null },
  render,
  setAlbum,
  reload: loadAlbum,
};

const albumEl = document.getElementById('album');
const viewer = new Viewer(() => app.album?.items || [], (item) => note(item, { withDay: true }));
app.viewer = viewer;

/* ---------------------------------------------------------------- chargement */

async function loadAlbum() {
  try {
    const res = await fetch(`${API}/api/album`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    setAlbum(await res.json());
  } catch {
    document.getElementById('stats').textContent = 'L’album n’a pas pu être chargé.';
    albumEl.replaceChildren(el('p', { class: 'notice' },
      'Impossible de charger les photos pour le moment. Vérifiez votre connexion internet puis ',
      el('button', { class: 'btn btn--outline', type: 'button', onclick: () => location.reload() }, 'réessayez'),
    ));
  }
}

function setAlbum(album) {
  app.album = album;
  render();
}

/* ---------------------------------------------------------------- rendu */

function groupByDay(items) {
  const groups = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.day === item.day) last.items.push(item);
    else groups.push({ day: item.day, items: [item] });
  }
  return groups;
}

function render() {
  const { items, days = {} } = app.album;
  const groups = groupByDay(items);
  const firstDay = groups[0]?.day;
  const lastDay = groups[groups.length - 1]?.day;
  app.firstDay = firstDay;

  // Statistiques de la page d'accueil
  const photos = items.filter((i) => i.type === 'photo').length;
  const videos = items.length - photos;
  const span = firstDay ? dayNumber(lastDay, firstDay) : 0;
  const stats = document.getElementById('stats');
  stats.replaceChildren(
    ...(items.length
      ? [el('strong', {}, plural(photos, 'photo', 'photos')),
        videos ? ' · ' : '', videos ? el('strong', {}, plural(videos, 'vidéo', 'vidéos')) : '',
        ' · ', el('strong', {}, plural(span, 'jour', 'jours'))]
      : ['L’album est encore vide.']),
  );

  // Étapes
  const stages = document.getElementById('stages');
  stages.hidden = groups.length < 2;
  document.getElementById('stages-list').replaceChildren(...groups.map((g) => el('li', {},
    el('a', { href: `#jour-${g.day}` }, el('span', { class: 'balise balise--small', 'aria-hidden': 'true' }),
      el('b', {}, `J${dayNumber(g.day, firstDay)}`), formatShortDay(g.day)),
  )));

  let index = 0;
  const sections = groups.map((g) => {
    const n = dayNumber(g.day, firstDay);
    const p = g.items.filter((i) => i.type === 'photo').length;
    const v = g.items.length - p;
    const title = days[g.day]?.title;
    const head = el('header', { class: 'day__head' },
      el('div', { class: 'day__marker', 'aria-hidden': 'true' }, el('span', { class: 'balise' })),
      el('div', { class: 'day__text' },
        el('p', { class: 'day__num' }, `Jour ${n}`),
        el('h2', { class: 'day__date', id: `titre-${g.day}` }, formatDay(g.day)),
        title ? el('p', { class: 'day__title' }, title) : null,
        el('p', { class: 'day__meta' }, [p ? plural(p, 'photo', 'photos') : '', v ? plural(v, 'vidéo', 'vidéos') : ''].filter(Boolean).join(' · ')),
      ),
    );
    const list = el('ul', { class: 'grid', dataset: { day: g.day } }, g.items.map((item) => card(item, index++, n)));
    const section = el('section', { class: 'day', id: `jour-${g.day}`, 'aria-labelledby': `titre-${g.day}` }, head, list);
    app.hooks.decorateDay?.(section, g.day);
    return section;
  });

  albumEl.replaceChildren(...(sections.length ? sections : [el('p', { class: 'notice' }, 'Aucune photo pour le moment.')]));
  app.hooks.afterRender?.();
}

function card(item, index, dayNum) {
  const s = scaled(item, 480);
  const m = scaled(item, 1024);
  const label = item.type === 'video' ? 'Vidéo' : 'Photo';
  const alt = item.caption || `${label} du jour ${dayNum}, ${formatDay(item.day)}${item.place ? `, ${item.place}` : ''}`;
  const img = el('img', {
    src: mediaUrl(item, 's.jpg'),
    srcset: `${mediaUrl(item, 's.jpg')} ${s.w}w, ${mediaUrl(item, 'm.jpg')} ${m.w}w`,
    sizes: '(min-width: 1200px) 290px, (min-width: 1000px) 24vw, (min-width: 600px) 32vw, 50vw',
    width: s.w, height: s.h,
    alt,
    loading: index < 6 ? 'eager' : 'lazy',
    decoding: 'async',
  });
  const markLoaded = () => img.classList.add('is-loaded');
  if (img.complete) markLoaded();
  else {
    img.addEventListener('load', markLoaded, { once: true });
    img.addEventListener('error', markLoaded, { once: true });
  }

  const open = el('button', { class: 'card__open', type: 'button', title: 'Agrandir', onclick: () => viewer.open(index) }, img);
  if (item.type === 'video') {
    open.append(
      el('span', { class: 'card__play', 'aria-hidden': 'true' }, el('span', {}, icon(ICONS.play))),
      el('span', { class: 'card__badge' }, icon(ICONS.video), el('span', { class: 'visually-hidden' }, 'Vidéo, '), formatDuration(item.duration)),
    );
  }

  const li = el('li', { class: 'card', dataset: { id: item.id } }, open);
  if (item.caption || item.place) li.append(note(item));
  else li.append(el('div', { class: 'card__foot' }));
  app.hooks.decorateCard?.(li, item, index);
  return li;
}

export function note(item, { withDay = false } = {}) {
  return el('div', { class: 'note' },
    withDay ? el('div', { class: 'note__day' }, `Jour ${dayNumber(item.day, app.firstDay)} · ${formatDay(item.day)}`) : null,
    item.caption ? el('p', { class: 'note__text' }, item.caption) : null,
    item.place ? el('span', { class: 'note__place' }, icon(ICONS.pin), item.place) : null,
  );
}

/* ---------------------------------------------------------------- boutons globaux */

function currentTheme() {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced) return forced;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateThemeButton() {
  const dark = currentTheme() === 'dark';
  document.querySelectorAll('[data-action="theme"]').forEach((b) => b.setAttribute('aria-label', dark ? 'Passer en mode clair' : 'Passer en mode sombre'));
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0e191d' : '#0e4f5c');
}

async function enterEdit() {
  const { startEditing } = await import('./edit.js');
  startEditing(app);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'slideshow') {
    if (!app.album?.items.length) return toast('Il n’y a pas encore de photo à montrer.');
    viewer.open(0, { play: true });
  } else if (action === 'theme') {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('album-theme', next); } catch { /* sans importance */ }
    updateThemeButton();
  } else if (action === 'login') {
    enterEdit();
  }
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeButton);
updateThemeButton();

/* ---------------------------------------------------------------- démarrage */

await loadAlbum();

// Reprise automatique du mode édition si une session est encore valide, ou lien direct « #edition »
let hasSession = false;
try { hasSession = Number(localStorage.getItem('album-edit-expires') || 0) > Date.now(); } catch { /* rien */ }
if (hasSession || location.hash === '#edition') enterEdit();
addEventListener('hashchange', () => { if (location.hash === '#edition') enterEdit(); });
