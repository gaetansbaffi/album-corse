// Visionneuse plein écran : balayage tactile, flèches du clavier, légendes, vidéos et diaporama.
import { el, mediaUrl } from './util.js';

const PHOTO_SECONDS = 6;

export class Viewer {
  constructor(getItems, captionFor) {
    this.getItems = getItems;
    this.captionFor = captionFor;
    this.dialog = document.getElementById('viewer');
    this.stage = document.getElementById('viewer-stage');
    this.caption = document.getElementById('viewer-caption');
    this.count = document.getElementById('viewer-count');
    this.progress = this.dialog.querySelector('.viewer__progress span');
    this.index = 0;
    this.playing = false;
    this.timer = null;
    this.wakeLock = null;

    this.dialog.addEventListener('click', (e) => {
      const action = e.target.closest('[data-viewer]')?.dataset.viewer;
      if (action === 'close') this.close();
      else if (action === 'prev') this.go(-1, true);
      else if (action === 'next') this.go(1, true);
      else if (action === 'play') this.togglePlay();
      else if (action === 'fullscreen') this.toggleFullscreen();
    });
    this.dialog.addEventListener('close', () => this.cleanup());
    this.dialog.addEventListener('keydown', (e) => this.onKey(e));
    this.bindSwipe();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.playing) this.requestWakeLock();
    });
  }

  get items() {
    return this.getItems();
  }

  open(index, { play = false } = {}) {
    if (!this.items.length) return;
    if (!this.dialog.open) this.dialog.showModal();
    this.show(index);
    if (play) {
      this.toggleFullscreen(true);
      this.play();
    } else {
      this.dialog.querySelector('[data-viewer="close"]').focus();
    }
  }

  close() {
    if (this.dialog.open) this.dialog.close();
  }

  cleanup() {
    this.stop();
    this.stage.querySelectorAll('video').forEach((v) => v.pause());
    this.stage.replaceChildren();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  go(delta, manual = false) {
    const n = this.items.length;
    let next = this.index + delta;
    if (this.playing) next = (next + n) % n; // le diaporama tourne en boucle
    if (next < 0 || next >= n) return;
    this.show(next);
    if (manual && this.playing) this.schedule();
  }

  show(index) {
    const items = this.items;
    this.index = Math.max(0, Math.min(index, items.length - 1));
    const item = items[this.index];

    this.stage.querySelectorAll('video').forEach((v) => v.pause());
    let media;
    if (item.type === 'video') {
      media = el('video', {
        src: mediaUrl(item, item.video || 'video.mp4'),
        poster: mediaUrl(item, 'm.jpg'),
        controls: true, playsinline: true, preload: 'metadata',
        'aria-label': item.caption || 'Vidéo du voyage',
      });
      media.addEventListener('ended', () => { if (this.playing) this.go(1); });
      media.addEventListener('error', () => { if (this.playing) setTimeout(() => this.go(1), 1500); });
    } else {
      media = el('img', { src: mediaUrl(item, 'l.jpg'), alt: item.caption || 'Photo du voyage', decoding: 'async', draggable: 'false' });
    }
    media.classList.add('is-entering');
    const reveal = () => requestAnimationFrame(() => {
      media.classList.remove('is-entering');
      if (this.playing && item.type === 'photo') media.classList.add('kenburns');
    });
    if (item.type === 'photo' && !media.complete) {
      media.addEventListener('load', reveal, { once: true });
      media.addEventListener('error', reveal, { once: true });
    } else reveal();

    // L'ancienne image s'efface pendant que la nouvelle apparaît
    for (const old of this.stage.children) {
      old.classList.add('is-entering');
      setTimeout(() => old.remove(), 450);
    }
    this.stage.append(media);

    this.count.textContent = `${this.index + 1} / ${items.length}`;
    this.caption.replaceChildren(el('div', { class: 'note-card' }, this.captionFor(item)));
    this.updateNav();

    // Préchargement des voisines pour un défilement fluide
    for (const d of [1, -1]) {
      const neighbour = items[this.index + d];
      if (neighbour?.type === 'photo') new Image().src = mediaUrl(neighbour, 'l.jpg');
    }
    if (this.playing) this.schedule();
  }

  /* -------------------------------------------------------------- diaporama */

  togglePlay() {
    if (this.playing) this.stop();
    else this.play();
  }

  play() {
    this.playing = true;
    this.dialog.classList.add('is-playing');
    this.dialog.querySelector('[data-viewer="play"]').setAttribute('aria-label', 'Mettre le diaporama en pause');
    this.requestWakeLock();
    this.show(this.index);
  }

  stop() {
    this.playing = false;
    clearTimeout(this.timer);
    this.dialog.classList.remove('is-playing');
    this.dialog.querySelector('[data-viewer="play"]').setAttribute('aria-label', 'Lancer le diaporama');
    this.resetProgress();
    this.stage.querySelectorAll('img.kenburns').forEach((img) => img.classList.remove('kenburns'));
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    this.updateNav();
  }

  updateNav() {
    // En diaporama on tourne en boucle ; sinon pas de « précédent » sur la première ni de « suivant » sur la dernière.
    this.dialog.querySelector('[data-viewer="prev"]').disabled = !this.playing && this.index === 0;
    this.dialog.querySelector('[data-viewer="next"]').disabled = !this.playing && this.index === this.items.length - 1;
  }

  schedule() {
    clearTimeout(this.timer);
    this.resetProgress();
    const item = this.items[this.index];
    if (item.type === 'video') {
      const video = this.stage.querySelector('video:last-of-type');
      video.play().catch(() => {
        // Le navigateur refuse le son automatique : on relance en muet.
        video.muted = true;
        video.play().catch(() => this.go(1));
      });
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.progress.style.transition = `width ${PHOTO_SECONDS}s linear`;
      this.progress.style.width = '100%';
    }));
    this.timer = setTimeout(() => this.go(1), PHOTO_SECONDS * 1000);
  }

  resetProgress() {
    this.progress.style.transition = 'none';
    this.progress.style.width = '0';
  }

  async requestWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch { /* pas grave : l'écran pourra se mettre en veille */ }
  }

  toggleFullscreen(force) {
    const fs = document.fullscreenElement;
    if (fs && force !== true) return document.exitFullscreen().catch(() => {});
    if (!fs && this.dialog.requestFullscreen) this.dialog.requestFullscreen().catch(() => {});
  }

  /* -------------------------------------------------------------- clavier et gestes */

  onKey(e) {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); this.go(1, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.go(-1, true); }
    else if (e.key === ' ' && e.target.tagName !== 'VIDEO' && e.target.tagName !== 'BUTTON') { e.preventDefault(); this.togglePlay(); }
    else if (e.key === 'Home') { e.preventDefault(); this.show(0); }
    else if (e.key === 'End') { e.preventDefault(); this.show(this.items.length - 1); }
  }

  bindSwipe() {
    let start = null;
    this.stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Ne pas confondre un balayage avec l'utilisation de la barre de lecture d'une vidéo
      if (e.target.tagName === 'VIDEO' && e.clientY > e.target.getBoundingClientRect().bottom - 80) return;
      start = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    this.stage.addEventListener('pointercancel', () => { start = null; });
    this.stage.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const fast = Date.now() - start.t < 700;
      start = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3 && fast) this.go(dx < 0 ? 1 : -1, true);
      else if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.5 && fast) this.close();
    });
  }
}
