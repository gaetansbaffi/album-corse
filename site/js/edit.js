// Mode édition : réservé à la personne qui connaît le mot de passe (vérifié par le serveur).
import { API, el, icon, mediaUrl, formatDay, plural, toast } from './util.js';
import { prepareFile, PrepError, MAX_VIDEO_MB } from './media-prep.js';

const TOKEN_KEY = 'album-edit-token';
const EXPIRES_KEY = 'album-edit-expires';
const I = {
  pen: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  up: 'M12 5l-7 8h4.5v6h5v-6H19z',
  down: 'M12 19l7-8h-4.5V5h-5v6H5z',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10.5 11v5.5M13.5 11v5.5',
  plus: 'M12 4.5v15M4.5 12h15',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  grip: 'M9 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM9 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM9 18.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
};

let app;
let expiryTimer = null;
let sortables = [];
let lastDeleted = null;
let uploading = false;

/* ---------------------------------------------------------------- session */

function storedSession() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const expires = Number(localStorage.getItem(EXPIRES_KEY) || 0);
    if (token && expires > Date.now()) return { token, expires };
  } catch { /* stockage indisponible */ }
  return null;
}

function saveSession(token, expires) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EXPIRES_KEY, String(expires));
  } catch { /* la session ne durera que le temps de la page */ }
  memorySession = { token, expires };
}

function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRES_KEY);
  } catch { /* rien */ }
  memorySession = null;
}

let memorySession = null;
const session = () => storedSession() || (memorySession && memorySession.expires > Date.now() ? memorySession : null);

class SessionExpired extends Error {}

async function api(method, path, body) {
  const s = session();
  if (!s) {
    sessionExpired();
    throw new SessionExpired();
  }
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { authorization: `Bearer ${s.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Pas de connexion internet. Vérifiez le Wi-Fi ou le réseau, puis réessayez.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    sessionExpired();
    throw new SessionExpired();
  }
  if (res.status === 409) {
    await app.reload();
    throw new Error(data.error || 'L’album a changé entre-temps. Il a été rechargé.');
  }
  if (!res.ok) throw new Error(data.error || 'Le serveur n’a pas pu enregistrer. Réessayez dans un instant.');
  return data;
}

function showError(err) {
  if (err instanceof SessionExpired) return;
  toast(err.message, { type: 'error', duration: 9000 });
}

function sessionExpired() {
  if (!app.editing) return;
  clearSession();
  deactivate();
  toast('Votre session d’édition est terminée. Retapez le mot de passe pour continuer vos modifications.', {
    type: 'error', action: 'Se reconnecter', onAction: openLogin, duration: 0,
  });
}

/* ---------------------------------------------------------------- fenêtres */

function modal(children, { onCancel, label } = {}) {
  const dialog = el('dialog', { class: 'modal', 'aria-label': label }, el('div', { class: 'modal__body' }, children));
  document.body.append(dialog);
  dialog.addEventListener('cancel', (e) => {
    if (onCancel && onCancel() === false) e.preventDefault();
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  return dialog;
}

/* ---------------------------------------------------------------- connexion */

export function startEditing(appRef) {
  app = appRef;
  if (location.hash === '#edition') history.replaceState(null, '', location.pathname + location.search);
  if (app.editing) return;
  if (session()) activate();
  else openLogin();
}

function openLogin() {
  const input = el('input', { id: 'pwd', type: 'password', autocomplete: 'current-password', required: true, autocapitalize: 'none', spellcheck: 'false' });
  const toggle = el('button', {
    class: 'btn btn--outline', type: 'button', 'aria-controls': 'pwd',
    onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Masquer' : 'Afficher';
      input.focus();
    },
  }, 'Afficher');
  const error = el('p', { class: 'form-error', role: 'alert' });
  const submit = el('button', { class: 'btn btn--primary btn--big', type: 'submit' }, 'Entrer');
  const form = el('form', { novalidate: true },
    el('h2', {}, 'Modifier l’album'),
    el('p', {}, 'Cette partie est réservée à l’organisatrice de l’album. Tapez le mot de passe :'),
    el('div', { class: 'field' },
      el('label', { for: 'pwd' }, 'Mot de passe'),
      el('div', { class: 'password-row' }, input, toggle),
    ),
    error,
    el('div', { class: 'modal__actions' },
      el('button', { class: 'btn btn--outline btn--big', type: 'button', onclick: () => dialog.close() }, 'Annuler'),
      submit,
    ),
  );
  const dialog = modal(form, { label: 'Connexion au mode édition' });
  input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (!input.value) {
      error.textContent = 'Tapez le mot de passe avant de valider.';
      return input.focus();
    }
    submit.disabled = true;
    submit.textContent = 'Vérification…';
    try {
      const res = await fetch(`${API}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: input.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Connexion impossible.');
      saveSession(data.token, data.expiresAt);
      dialog.close();
      activate();
      toast('Mode édition activé. Vos modifications sont enregistrées automatiquement.', { type: 'ok' });
    } catch (err) {
      error.textContent = err.message === 'Failed to fetch' ? 'Pas de connexion internet. Vérifiez le réseau et réessayez.' : err.message;
      input.select();
    } finally {
      submit.disabled = false;
      submit.textContent = 'Entrer';
    }
  });
}

/* ---------------------------------------------------------------- activer / désactiver */

function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    document.head.append(el('script', { src, onload: resolve, onerror: reject }));
  });
}

async function activate() {
  app.editing = true;
  document.body.classList.add('is-editing');
  app.hooks.decorateCard = decorateCard;
  app.hooks.decorateDay = decorateDay;
  app.hooks.afterRender = afterRender;
  await Promise.all([loadScript('vendor/Sortable.min.js'), loadScript('vendor/exifr-lite.umd.js')]).catch(() => {});
  renderEditBar();
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(sessionExpired, Math.max(0, session().expires - Date.now()));
  if (app.album) app.render();
}

function deactivate() {
  app.editing = false;
  document.body.classList.remove('is-editing');
  app.hooks.decorateCard = app.hooks.decorateDay = app.hooks.afterRender = null;
  clearTimeout(expiryTimer);
  sortables.forEach((s) => s.destroy());
  sortables = [];
  const bar = document.getElementById('edit-bar');
  bar.hidden = true;
  bar.replaceChildren();
  document.getElementById('fab')?.remove();
  lastDeleted = null;
  if (app.album) app.render();
}

function renderEditBar() {
  const bar = document.getElementById('edit-bar');
  const until = new Date(session().expires).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  bar.replaceChildren(
    el('div', { class: 'edit-bar__inner' },
      el('p', { class: 'edit-bar__title' }, icon(I.pen), el('span', {}, el('strong', {}, 'Mode édition'), el('span', { class: 'edit-bar__until' }, ` jusqu’à ${until.replace(':', ' h ')}`))),
      el('div', { class: 'edit-bar__actions' },
        lastDeleted ? el('button', { class: 'btn btn--light', type: 'button', onclick: () => restore(lastDeleted.id) }, icon(I.undo, { fill: false }), 'Annuler la suppression') : null,
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: openTrash }, icon(I.trash, { fill: false }), 'Corbeille'),
        el('button', {
          class: 'btn btn--ghost', type: 'button',
          onclick: () => {
            clearSession();
            deactivate();
            toast('Vous avez quitté le mode édition.');
          },
        }, 'Quitter'),
      ),
    ),
    el('p', { class: 'edit-bar__help' }, 'Sous chaque photo : « Légende » pour écrire un commentaire, « Monter » et « Descendre » pour changer l’ordre. Sur ordinateur, vous pouvez aussi faire glisser une photo par sa poignée (en haut à droite).'),
  );
  bar.hidden = false;

  if (!document.getElementById('fab')) {
    const input = el('input', { type: 'file', accept: 'image/*,video/*', multiple: true, class: 'visually-hidden', id: 'file-input', tabindex: '-1' });
    input.addEventListener('change', () => {
      if (input.files.length) uploadFiles([...input.files]);
      input.value = '';
    });
    document.body.append(el('div', { id: 'fab', class: 'fab' },
      input,
      el('button', { class: 'btn btn--primary btn--big fab__btn', type: 'button', onclick: () => input.click() }, icon(I.plus, { fill: false }), 'Ajouter des photos ou vidéos'),
    ));
  }
}

/* ---------------------------------------------------------------- décoration des cartes et des journées */

function toolButton(iconPath, label, fullLabel, onclick, { danger = false, disabled = false, name } = {}) {
  return el('button', {
    class: `tool${danger ? ' tool--danger' : ''}`, type: 'button', onclick, disabled,
    'aria-label': fullLabel, title: fullLabel, dataset: { edit: name },
  }, icon(iconPath, { fill: iconPath === I.up || iconPath === I.down }), el('span', {}, label));
}

function decorateCard(li, item, index) {
  const total = app.album.items.length;
  const what = item.type === 'video' ? 'cette vidéo' : 'cette photo';
  li.prepend(el('span', { class: 'card__handle', title: 'Glisser pour déplacer', 'aria-hidden': 'true' }, icon(I.grip)));
  li.append(el('div', { class: 'card__tools' },
    toolButton(I.pen, 'Légende', `Écrire la légende de ${what}`, () => editCaption(item), { name: 'caption' }),
    toolButton(I.trash, 'Supprimer', `Supprimer ${what}`, () => confirmDelete(item), { danger: true, name: 'delete' }),
    toolButton(I.up, 'Monter', `Monter ${what} d’un cran`, () => move(item.id, -1), { disabled: index === 0, name: 'up' }),
    toolButton(I.down, 'Descendre', `Descendre ${what} d’un cran`, () => move(item.id, 1), { disabled: index === total - 1, name: 'down' }),
  ));
  if (item.codecWarning) li.append(el('p', { class: 'card__warn' }, 'Format HEVC : cette vidéo risque de ne pas se lire sur certains appareils.'));
}

function decorateDay(section, day) {
  const title = app.album.days?.[day]?.title;
  section.querySelector('.day__text').append(
    el('button', { class: 'btn btn--outline day__rename', type: 'button', onclick: () => editDayTitle(day) },
      icon(I.pen), title ? 'Renommer la journée' : 'Donner un nom à cette journée'),
  );
}

function afterRender() {
  sortables.forEach((s) => s.destroy());
  sortables = [];
  if (!window.Sortable) return;
  document.querySelectorAll('.grid').forEach((grid) => {
    sortables.push(window.Sortable.create(grid, {
      group: 'album',
      handle: '.card__handle',
      animation: 150,
      ghostClass: 'is-ghost',
      chosenClass: 'is-chosen',
      onEnd: (evt) => {
        if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
        const order = [...document.querySelectorAll('.grid .card')].map((c) => c.dataset.id);
        const days = {};
        document.querySelectorAll('.grid').forEach((g) => g.querySelectorAll('.card').forEach((c) => {
          const item = app.album.items.find((i) => i.id === c.dataset.id);
          if (item && item.day !== g.dataset.day) days[item.id] = g.dataset.day;
        }));
        saveOrder(order, days, evt.item.dataset.id, null, Object.keys(days).length ? `Déplacée au ${formatDay(evt.to.dataset.day)}.` : 'Nouvel ordre enregistré.');
      },
    }));
  });
}

/* ---------------------------------------------------------------- réorganisation */

async function saveOrder(order, days, focusId, focusButton, message) {
  try {
    app.setAlbum(await api('PUT', '/api/order', { order, days }));
    if (message) toast(message, { type: 'ok', duration: 3000 });
  } catch (err) {
    showError(err);
    app.render(); // remet l'affichage d'origine si l'enregistrement a échoué
  }
  const card = document.querySelector(`.card[data-id="${focusId}"]`);
  if (card) {
    card.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const btn = card.querySelector(`[data-edit="${focusButton}"]`);
    (btn && !btn.disabled ? btn : card.querySelector('[data-edit="caption"]'))?.focus({ preventScroll: true });
  }
}

function move(id, dir) {
  const items = app.album.items;
  const i = items.findIndex((it) => it.id === id);
  const neighbour = items[i + dir];
  if (!neighbour) return;
  const order = items.map((it) => it.id);
  const days = {};
  let message;
  if (neighbour.day !== items[i].day) {
    // Premier (ou dernier) de sa journée : il passe dans la journée voisine
    days[id] = neighbour.day;
    message = `Déplacée au ${formatDay(neighbour.day)}.`;
  } else {
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
  }
  saveOrder(order, days, id, dir < 0 ? 'up' : 'down', message);
}

/* ---------------------------------------------------------------- légendes et titres */

function editCaption(item) {
  const places = [...new Set(app.album.items.map((i) => i.place).filter(Boolean))];
  const caption = el('textarea', { id: 'cap', maxlength: '300', rows: '3', placeholder: 'Ex. : Pique-nique face à la mer' });
  caption.value = item.caption || '';
  const place = el('input', { id: 'place', type: 'text', maxlength: '80', list: 'places', autocomplete: 'off', placeholder: 'Ex. : Bonifacio' });
  place.value = item.place || '';
  const day = el('input', { id: 'day', type: 'date', required: true });
  day.value = item.day;
  const counter = el('small', { id: 'cap-count' });
  const updateCount = () => { counter.textContent = `${caption.value.length} / 300 caractères`; };
  caption.addEventListener('input', updateCount);
  updateCount();
  const error = el('p', { class: 'form-error', role: 'alert' });
  const save = el('button', { class: 'btn btn--primary btn--big', type: 'submit' }, 'Enregistrer');

  const form = el('form', {},
    el('h2', {}, item.type === 'video' ? 'Légende de la vidéo' : 'Légende de la photo'),
    el('img', { class: 'modal__thumb', src: mediaUrl(item, 'm.jpg'), alt: '' }),
    el('div', { class: 'field' }, el('label', { for: 'cap' }, 'Légende'), caption, counter),
    el('div', { class: 'field' }, el('label', { for: 'place' }, 'Lieu ', el('small', {}, '(facultatif)')), place,
      el('datalist', { id: 'places' }, places.map((p) => el('option', { value: p })))),
    el('div', { class: 'field' }, el('label', { for: 'day' }, 'Jour'), day, el('small', {}, 'Changez la date seulement si la photo n’est pas dans la bonne journée.')),
    error,
    el('div', { class: 'modal__actions' },
      el('button', { class: 'btn btn--outline btn--big', type: 'button', onclick: () => dialog.close() }, 'Annuler'),
      save,
    ),
  );
  const dialog = modal(form, { label: 'Modifier la légende' });
  caption.focus();
  caption.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!day.value) {
      error.textContent = 'Choisissez un jour.';
      return day.focus();
    }
    save.disabled = true;
    save.textContent = 'Enregistrement…';
    try {
      app.setAlbum(await api('PATCH', `/api/items/${item.id}`, { caption: caption.value, place: place.value, day: day.value }));
      dialog.close();
      toast('Légende enregistrée.', { type: 'ok', duration: 3000 });
      document.querySelector(`.card[data-id="${item.id}"] [data-edit="caption"]`)?.focus();
    } catch (err) {
      if (err instanceof SessionExpired) return dialog.close();
      error.textContent = err.message;
      save.disabled = false;
      save.textContent = 'Enregistrer';
    }
  });
}

function editDayTitle(day) {
  const input = el('input', { id: 'day-title', type: 'text', maxlength: '80', placeholder: 'Ex. : Bonifacio et les falaises' });
  input.value = app.album.days?.[day]?.title || '';
  const error = el('p', { class: 'form-error', role: 'alert' });
  const form = el('form', {},
    el('h2', {}, 'Nom de la journée'),
    el('p', {}, formatDay(day)),
    el('div', { class: 'field' }, el('label', { for: 'day-title' }, 'Nom (laisser vide pour aucun)'), input),
    error,
    el('div', { class: 'modal__actions' },
      el('button', { class: 'btn btn--outline btn--big', type: 'button', onclick: () => dialog.close() }, 'Annuler'),
      el('button', { class: 'btn btn--primary btn--big', type: 'submit' }, 'Enregistrer'),
    ),
  );
  const dialog = modal(form, { label: 'Nom de la journée' });
  input.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      app.setAlbum(await api('PATCH', `/api/days/${day}`, { title: input.value }));
      dialog.close();
      toast('Journée enregistrée.', { type: 'ok', duration: 3000 });
    } catch (err) {
      if (err instanceof SessionExpired) return dialog.close();
      error.textContent = err.message;
    }
  });
}

/* ---------------------------------------------------------------- suppression, annulation, corbeille */

function confirmDelete(item) {
  const what = item.type === 'video' ? 'cette vidéo' : 'cette photo';
  const yes = el('button', { class: 'btn btn--danger btn--big', type: 'button' }, icon(I.trash, { fill: false }), 'Oui, supprimer');
  const no = el('button', { class: 'btn btn--outline btn--big', type: 'button', onclick: () => dialog.close() }, 'Non, garder');
  const dialog = modal([
    el('h2', {}, `Supprimer ${what} ?`),
    el('img', { class: 'modal__thumb', src: mediaUrl(item, 'm.jpg'), alt: '' }),
    el('p', {}, 'Vous pourrez l’annuler juste après, ou la retrouver dans la corbeille pendant 30 jours.'),
    el('div', { class: 'modal__actions' }, no, yes),
  ], { label: `Supprimer ${what}` });
  no.focus(); // le choix sans risque est sélectionné par défaut

  yes.addEventListener('click', async () => {
    yes.disabled = true;
    try {
      const album = await api('DELETE', `/api/items/${item.id}`);
      dialog.close();
      lastDeleted = item;
      app.setAlbum(album);
      renderEditBar();
      toast(`${item.type === 'video' ? 'Vidéo supprimée' : 'Photo supprimée'}.`, { action: 'Annuler', onAction: () => restore(item.id), duration: 20000 });
    } catch (err) {
      dialog.close();
      showError(err);
    }
  });
}

async function restore(id) {
  try {
    app.setAlbum(await api('POST', `/api/items/${id}/restore`));
    if (lastDeleted?.id === id) lastDeleted = null;
    renderEditBar();
    toast('C’est annulé : le média est de retour dans l’album.', { type: 'ok' });
    const card = document.querySelector(`.card[data-id="${id}"]`);
    card?.scrollIntoView({ block: 'center' });
    card?.querySelector('[data-edit="caption"]')?.focus({ preventScroll: true });
  } catch (err) {
    showError(err);
  }
}

async function openTrash() {
  let trash;
  try {
    ({ trash } = await api('GET', '/api/trash'));
  } catch (err) {
    return showError(err);
  }
  const list = trash.length
    ? el('ul', { class: 'trash-list' }, trash.map((t) => {
      const deleted = new Date(t.deletedAt);
      const purge = new Date(deleted.getTime() + 30 * 86400000);
      return el('li', {},
        el('img', { src: mediaUrl(t.item, 's.jpg'), alt: '', width: '96', height: '96' }),
        el('div', {},
          el('p', {}, t.item.caption || (t.item.type === 'video' ? 'Vidéo' : 'Photo'), el('br'),
            el('small', {}, `Supprimée le ${deleted.toLocaleDateString('fr-FR')} — effacée définitivement après le ${purge.toLocaleDateString('fr-FR')}`)),
          el('button', {
            class: 'btn btn--primary', type: 'button',
            onclick: async () => {
              dialog.close();
              await restore(t.item.id);
            },
          }, 'Remettre dans l’album'),
        ),
      );
    }))
    : el('p', {}, 'La corbeille est vide.');
  const dialog = modal([
    el('h2', {}, 'Corbeille'),
    el('p', {}, 'Les médias supprimés restent ici 30 jours, puis sont effacés définitivement.'),
    list,
    el('div', { class: 'modal__actions' }, el('button', { class: 'btn btn--outline btn--big', type: 'button', onclick: () => dialog.close() }, 'Fermer')),
  ], { label: 'Corbeille' });
}

/* ---------------------------------------------------------------- ajout de photos et vidéos */

function putFile(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('authorization', `Bearer ${session()?.token}`);
    xhr.setRequestHeader('content-type', blob.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status === 401) {
        sessionExpired();
        return reject(new SessionExpired());
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = 'L’envoi a été refusé par le serveur.';
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* rien */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('L’envoi a été interrompu (connexion internet ?).'));
    xhr.send(blob);
  });
}

async function uploadOne(file, row) {
  const status = row.querySelector('.upload__status');
  const bar = row.querySelector('progress');
  const set = (text, cls) => {
    status.textContent = text;
    row.className = `upload__row${cls ? ` is-${cls}` : ''}`;
  };
  row.querySelector('.upload__retry')?.remove();
  try {
    set('Préparation…', 'busy');
    const prepared = await prepareFile(file);
    const thumb = row.querySelector('img');
    thumb.src = URL.createObjectURL(prepared.files['s.jpg']);

    const id = crypto.randomUUID();
    const entries = Object.entries(prepared.files);
    const total = entries.reduce((s, [, b]) => s + b.size, 0);
    let done = 0;
    for (const [name, blob] of entries) {
      await putFile(`${API}/api/upload/${id}/${name}`, blob, (loaded) => {
        const pct = Math.round(((done + loaded) / total) * 100);
        bar.value = pct;
        set(`Envoi… ${pct} %`, 'busy');
      });
      done += blob.size;
    }
    const album = await api('POST', '/api/items', {
      id, type: prepared.type, day: prepared.day, takenAt: prepared.takenAt,
      w: prepared.w, h: prepared.h, duration: prepared.duration, codecWarning: prepared.codecWarning,
    });
    app.setAlbum(album);
    bar.value = 100;
    set(prepared.codecWarning ? 'Ajoutée — attention : format HEVC, lecture possible seulement sur certains appareils.' : `Ajoutée au ${formatDay(prepared.day)}`, 'ok');
    return true;
  } catch (err) {
    if (err instanceof SessionExpired) {
      set('Non envoyée : session terminée.', 'error');
      throw err;
    }
    set(err.message || 'Erreur inconnue.', 'error');
    // Réessayer n'a de sens que pour un problème d'envoi (réseau…), pas pour un fichier refusé
    if (!(err instanceof PrepError)) {
      row.querySelector('.upload__info').append(el('button', { class: 'btn btn--outline upload__retry', type: 'button', onclick: () => runQueue([[file, row]]) }, 'Réessayer'));
    }
    return false;
  }
}

let uploadDialog = null;
let uploadSummary = null;
let uploadClose = null;

function beforeUnload(e) {
  e.preventDefault();
  e.returnValue = '';
}

async function runQueue(queue) {
  uploading = true;
  uploadClose.disabled = true;
  uploadClose.textContent = 'Patientez pendant l’envoi…';
  window.addEventListener('beforeunload', beforeUnload);
  let ok = 0;
  try {
    for (const [i, [file, row]] of queue.entries()) {
      uploadSummary.textContent = `Envoi ${i + 1} sur ${queue.length}. Gardez cette page ouverte.`;
      if (await uploadOne(file, row)) ok++;
    }
  } catch { /* session expirée : on s'arrête */ }
  uploading = false;
  window.removeEventListener('beforeunload', beforeUnload);
  const failed = uploadDialog.querySelectorAll('.upload__row.is-error').length;
  uploadSummary.textContent = failed
    ? `${plural(ok, 'média ajouté', 'médias ajoutés')}. ${plural(failed, 'fichier n’a', 'fichiers n’ont')} pas pu être envoyé${failed > 1 ? 's' : ''} : voir ci-dessous.`
    : `Terminé ! ${plural(ok, 'média ajouté', 'médias ajoutés')} à l’album.`;
  uploadClose.disabled = false;
  uploadClose.textContent = 'Fermer';
  uploadClose.focus();
}

function uploadFiles(files) {
  const rows = files.map((file) => {
    const isImage = file.type.startsWith('image/');
    return [file, el('li', { class: 'upload__row' },
      el('img', { src: isImage ? URL.createObjectURL(file) : 'img/favicon.svg', alt: '', width: '64', height: '64' }),
      el('div', { class: 'upload__info' },
        el('p', { class: 'upload__name' }, file.name),
        el('progress', { max: '100', value: '0' }),
        el('p', { class: 'upload__status' }, 'En attente'),
      ),
    )];
  });
  uploadSummary = el('p', { class: 'upload__summary', role: 'status' });
  uploadClose = el('button', { class: 'btn btn--primary btn--big', type: 'button', onclick: () => uploadDialog.close() }, 'Fermer');
  uploadDialog = modal([
    el('h2', {}, 'Ajout de photos et vidéos'),
    el('p', {}, `Les photos sont réduites et les informations de localisation retirées avant l’envoi. Vidéos : ${MAX_VIDEO_MB} Mo maximum.`),
    uploadSummary,
    el('ul', { class: 'upload__list' }, rows.map(([, r]) => r)),
    el('div', { class: 'modal__actions' }, uploadClose),
  ], { label: 'Ajout de médias', onCancel: () => !uploading });
  runQueue(rows);
}
