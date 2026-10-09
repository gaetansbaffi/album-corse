// Appliqué avant l'affichage pour éviter un flash de la mauvaise couleur.
(function () {
  try {
    var saved = localStorage.getItem('album-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  } catch (e) { /* stockage indisponible : on suit le réglage du téléphone */ }
})();
