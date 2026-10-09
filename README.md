# Album « Voyage en Corse — Octobre 2026 »

Album photo et vidéo familial : consultation par toute la famille (téléphone, tablette, ordinateur) et mode édition protégé par mot de passe pour l'organisatrice. Elle peut y ajouter, légender, réordonner et supprimer des médias.

> ## ⚠️ À savoir avant de partager
> **Toute personne qui a le lien peut voir les photos et les vidéos.** Il n'y a pas de mot de passe pour regarder. Seule la modification est protégée.
> Le site demande aux moteurs de recherche de ne pas le référencer (`noindex`), mais ce n'est qu'une consigne, pas un verrou. Si le lien est transféré, la personne qui le reçoit voit tout.
> N'envoyez donc le lien qu'à la famille, et ne publiez rien que vous ne voudriez pas voir circuler.

---

## Sommaire

1. [Comment ça marche](#1-comment-ça-marche)
2. [Contenu du dossier](#2-contenu-du-dossier)
3. [Installation sur votre ordinateur](#3-installation-sur-votre-ordinateur)
4. [Variables d'environnement](#4-variables-denvironnement)
5. [Déploiement pas à pas](#5-déploiement-pas-à-pas)
6. [Changer le mot de passe](#6-changer-le-mot-de-passe)
7. [Sauvegarder et restaurer les médias](#7-sauvegarder-et-restaurer-les-médias)
8. [Vidéos : taille maximale et compression](#8-vidéos--taille-maximale-et-compression)
9. [Mode d'emploi pour l'organisatrice](#9-mode-demploi-pour-lorganisatrice)
10. [Quotas et coûts](#10-quotas-et-coûts)
11. [Limites et risques connus](#11-limites-et-risques-connus)
12. [Dépannage](#12-dépannage)

---

## 1. Comment ça marche

```
 Téléphone / ordinateur
        │
        ▼
 GitHub Pages  ──────────►  Worker Cloudflare (l'« API »)  ──────►  Cloudflare R2
 (le site : HTML, CSS, JS)   vérifie le mot de passe,               (stockage des photos,
  gratuit, aucun secret       enregistre les modifications           vidéos et album.json)
```

- **Le site** (dossier `site/`) est un ensemble de fichiers statiques publiés sur GitHub Pages. Il ne contient ni photo, ni mot de passe.
- **L'API** (dossier `worker/`) est un petit programme qui tourne chez Cloudflare. Elle sert les médias aux visiteurs et accepte les modifications seulement avec une session valide.
- **Le mot de passe** est un « secret » Cloudflare : il est vérifié sur le serveur et n'est jamais envoyé au navigateur. Quand le mot de passe est correct, le serveur remet une session signée valable 12 h.
- **Les photos** sont redimensionnées en 3 tailles (480, 1024 et 1600 px). Les informations cachées (EXIF, **GPS**, modèle d'appareil) sont supprimées *avant* l'envoi, et les vidéos sont nettoyées de leur position GPS.
- **Les suppressions** passent par une corbeille gardée 30 jours. On peut donc toujours annuler.

## 2. Contenu du dossier

| Dossier / fichier | Rôle |
|---|---|
| `site/` | Le site publié sur GitHub Pages |
| `site/js/app.js` | Affichage de l'album (consultation) |
| `site/js/viewer.js` | Visionneuse plein écran et diaporama |
| `site/js/edit.js` | Mode édition (chargé seulement après le mot de passe) |
| `site/js/media-prep.js` | Préparation des photos et vidéos dans le navigateur avant envoi |
| `site/js/config.js` | Adresse de l'API (réglée par `npm run set-api-url`) |
| `worker/` | L'API Cloudflare (`src/index.js`) et sa configuration (`wrangler.toml`) |
| `scripts/import.mjs` | Import d'un dossier de photos et vidéos |
| `scripts/backup.mjs` / `restore.mjs` | Sauvegarde et restauration |
| `scripts/test-api.mjs` | Tests automatiques de l'API |
| `scripts/gen-contours.mjs` | Génère le fond « courbes de niveau » de l'en-tête |
| `medias-source/` | Les fichiers d'origine reçus par WhatsApp (**jamais publiés**, exclus de Git) |
| `outils/` | Node.js portable installé pour ce projet (exclu de Git) |

## 3. Installation sur votre ordinateur

Node.js 24 est installé en version portable dans `outils/node`, sans droits administrateur. Au début de **chaque nouvelle fenêtre PowerShell**, ouverte dans le dossier du projet, tapez :

```powershell
$env:Path = "$PWD\outils\node;$env:Path"
```

Si vous préférez installer Node.js pour de bon, prenez la version LTS sur https://nodejs.org : la ligne ci-dessus devient alors inutile.

Puis, une seule fois :

```powershell
npm install
```

Trois paquets (`ffmpeg-static`, `esbuild`, `workerd`) ont des scripts d'installation : ce sont les outils officiels de compression vidéo et de Cloudflare. Leur autorisation est déjà enregistrée dans `package.json` (rubrique `allowScripts`). Si npm les signale malgré tout, approuvez-les :

```powershell
npm install-scripts approve ffmpeg-static esbuild workerd
npm rebuild ffmpeg-static esbuild workerd
```

### Tester en local

1. Copiez `worker/.dev.vars.example` en `worker/.dev.vars`, puis mettez-y un mot de passe de test et une longue chaîne aléatoire. Ce fichier n'est jamais publié.
2. Ouvrez deux fenêtres PowerShell.
   - Dans la première, lancez l'API locale :
     ```powershell
     npm run dev:api
     ```
   - Dans la seconde, lancez le site :
     ```powershell
     npm run dev:site
     ```
3. Ouvrez http://localhost:8080 dans votre navigateur.
4. Remplissez l'album local :
   ```powershell
   npm run import -- --api http://127.0.0.1:8787 --dir medias-source
   ```
5. Pour les tests automatiques, il faut une API de test **vide**, dans une autre fenêtre :
   ```powershell
   npx wrangler dev --config worker/wrangler.toml --port 8788 --inspector-port 9230 --persist-to .wrangler/test-state
   ```
   Lancez ensuite :
   ```powershell
   npm run test:api -- http://127.0.0.1:8788
   ```
   Pour relancer les tests, supprimez d'abord le dossier `.wrangler/test-state` : le dernier test bloque volontairement les connexions pendant 15 minutes.

## 4. Variables d'environnement

Elles se règlent dans `worker/wrangler.toml` (partie `[vars]`) ou comme **secrets** Cloudflare. Aucune valeur réelle n'est écrite dans le dépôt.

| Nom | Type | Rôle | Valeur par défaut |
|---|---|---|---|
| `ADMIN_PASSWORD` | **secret** | Le mot de passe de l'organisatrice (6 caractères minimum) | — |
| `SESSION_SECRET` | **secret** | Clé qui signe les sessions (48 caractères aléatoires minimum conseillés, 32 obligatoires) | — |
| `ALLOWED_ORIGINS` | variable | Adresse(s) du site autorisées à modifier l'album, séparées par des virgules | `http://localhost:8080,…` |
| `SESSION_HOURS` | variable | Durée d'une session d'édition, en heures | `12` |
| `MAX_VIDEO_MB` | variable | Taille maximale d'une vidéo envoyée | `95` |
| `STORAGE_LIMIT_MB` | variable | Garde-fou : refuse les envois au-delà de ce volume total | `9000` |
| `TRASH_DAYS` | variable | Durée de conservation dans la corbeille | `30` |

En local, les secrets se mettent dans `worker/.dev.vars`. En production, on utilise `npx wrangler secret put` (voir ci-dessous).

## 5. Déploiement pas à pas

### Étape 1 — Cloudflare (stockage et API)

1. Créez un compte gratuit sur https://dash.cloudflare.com.
2. Dans le menu **R2 Object Storage**, activez R2. Cloudflare fait passer par une étape de souscription (« checkout ») qui peut demander un moyen de paiement. Rien n'est facturé tant que vous restez sous les quotas gratuits (voir §10).
3. Dans PowerShell, dans le dossier du projet :
   ```powershell
   npx wrangler login
   npx wrangler r2 bucket create album-corse-medias
   ```
4. Créez la clé de signature des sessions. La commande ci-dessous génère une chaîne aléatoire, que vous copiez quand elle vous est demandée :
   ```powershell
   node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
   ```
   ```powershell
   npx wrangler secret put SESSION_SECRET --config worker/wrangler.toml
   ```
5. Choisissez le mot de passe de votre mère : facile à taper sur un téléphone, mais pas évident. Par exemple trois mots et un nombre. Enregistrez-le :
   ```powershell
   npx wrangler secret put ADMIN_PASSWORD --config worker/wrangler.toml
   ```

### Étape 2 — GitHub (le site)

1. Créez un dépôt sur GitHub, par exemple `album-corse`. Avec l'offre gratuite, **il doit être public** pour utiliser GitHub Pages. Ce n'est pas un problème : le dépôt ne contient ni photo ni mot de passe, car `.gitignore` exclut `medias-source/`, les `.jpg`, les `.mp4` et `.dev.vars`.
2. Dans le dépôt, allez dans **Settings → Pages → Build and deployment → Source** et choisissez **GitHub Actions**. Le fichier `.github/workflows/pages.yml` publie automatiquement le dossier `site/`.
3. L'adresse du site sera `https://VOTRE-COMPTE.github.io/album-corse/`.

### Étape 3 — Relier le site et l'API

1. Dans `worker/wrangler.toml`, mettez l'adresse de votre site dans `ALLOWED_ORIGINS`. Indiquez **seulement le domaine, sans le chemin** :
   ```toml
   ALLOWED_ORIGINS = "https://VOTRE-COMPTE.github.io"
   ```
2. Publiez l'API :
   ```powershell
   npm run deploy:api
   ```
   Notez l'adresse affichée, par exemple `https://album-corse.VOTRE-COMPTE.workers.dev`.
3. Inscrivez cette adresse dans le site. Le script met à jour `config.js`, l'aperçu Open Graph et la politique de sécurité :
   ```powershell
   npm run set-api-url -- https://album-corse.VOTRE-COMPTE.workers.dev
   ```
4. Envoyez le tout sur GitHub :
   ```powershell
   git init
   git add .
   git commit -m "Album Corse"
   git branch -M main
   git remote add origin https://github.com/VOTRE-COMPTE/album-corse.git
   git push -u origin main
   ```
   Avant le premier `git push`, vérifiez avec `git status` qu'aucun fichier de `medias-source/` ni `.dev.vars` n'apparaît.

### Étape 4 — Importer les photos et vidéos

Le mot de passe vous est demandé au clavier :

```powershell
npm run import -- --api https://album-corse.VOTRE-COMPTE.workers.dev --dir medias-source
```

Le script peut être relancé sans risque. Il ignore :
- les fichiers déjà importés ;
- les doublons exacts (2 fichiers WhatsApp identiques ont été repérés) ;
- les médias mis à la corbeille.

### Étape 5 — Vérifier et partager

- Ouvrez le site, lancez le diaporama et testez le mode édition (crayon en haut à droite).
- Lien à envoyer à la famille : `https://VOTRE-COMPTE.github.io/album-corse/`.
- Lien à donner **à votre mère seulement** (il ouvre directement la fenêtre du mot de passe) : `https://VOTRE-COMPTE.github.io/album-corse/#edition`. Ajoutez-le à l'écran d'accueil de son téléphone.
- L'aperçu dans WhatsApp ou SMS affiche le titre et la **première photo** de l'album. WhatsApp garde les aperçus en mémoire : si vous changez la première photo, l'ancien aperçu peut rester affiché quelque temps.

## 6. Changer le mot de passe

```powershell
npx wrangler secret put ADMIN_PASSWORD --config worker/wrangler.toml
```

Tapez le nouveau mot de passe. C'est immédiat, sans redéploiement. **Toutes les sessions d'édition ouvertes sont fermées automatiquement**, car la signature des sessions dépend du mot de passe.

Pour fermer toutes les sessions sans changer le mot de passe, changez `SESSION_SECRET` de la même façon.

Après 8 mots de passe faux en 15 minutes depuis une même connexion, l'API bloque les essais pendant 15 minutes.

## 7. Sauvegarder et restaurer les médias

### Sauvegarde (à faire régulièrement, par exemple après chaque séance d'ajout)

```powershell
npm run backup -- --api https://album-corse.VOTRE-COMPTE.workers.dev
```

Tout est téléchargé dans `sauvegarde/AAAA-MM-JJ/` :
- `album.json` (légendes, lieux, ordre, titres des journées, corbeille) ;
- toutes les photos et vidéos.

Ce dossier est exclu de Git. Copiez-le sur un disque externe ou un cloud personnel.

### Restauration (dans un album vide ou partiellement vide)

```powershell
npm run restore -- --api https://album-corse.VOTRE-COMPTE.workers.dev --from sauvegarde/2026-10-20
```

Ce qui est remis : les médias, les légendes, l'ordre et les noms de journées. La corbeille n'est pas restaurée.

Les fichiers d'origine reçus de votre mère, dans `medias-source/`, constituent aussi une sauvegarde : gardez-les.

## 8. Vidéos : taille maximale et compression

- **Taille maximale : 95 Mo par vidéo.** Le plan gratuit de Cloudflare refuse les envois de plus de 100 Mo. En qualité normale, cela représente environ **5 à 8 minutes**.
- Format idéal : **MP4 (H.264)**. Les vidéos WhatsApp le sont déjà.
- Les iPhone filment par défaut en **HEVC**. Ces vidéos sont acceptées, mais elles ne se lisent pas sur certains ordinateurs ou téléphones Android ; une mention l'indique alors en mode édition. Deux solutions :
  - sur l'iPhone, **Réglages → Appareil photo → Formats → « Le plus compatible »** ;
  - ou passer la vidéo par le script d'import, qui la convertit automatiquement en H.264.

**Si une vidéo est trop lourde ou en HEVC**, compressez-la avec ffmpeg. ffmpeg est déjà fourni : `node_modules\ffmpeg-static\ffmpeg.exe`.

```powershell
.\node_modules\ffmpeg-static\ffmpeg.exe -i "entree.mov" -map_metadata -1 -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -vf "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'" -c:a aac -b:a 128k -movflags +faststart "sortie.mp4"
```

- `-crf 26` règle la qualité : plus le nombre est grand, plus le fichier est léger. Essayez 28 si c'est encore trop lourd.
- Le filtre `scale` limite le plus grand côté à 1280 px, que la vidéo soit en paysage ou en portrait.
- `-map_metadata -1` retire la position GPS.
- `+faststart` permet de lancer la lecture avant la fin du téléchargement.

Testé ici : une vidéo portrait 1080×1920 de 35,4 Mo est passée à 2,6 Mo, en 720×1280.

Ensuite, envoyez `sortie.mp4` par le mode édition, ou placez-la dans un dossier et lancez `npm run import` sur ce dossier.

## 9. Mode d'emploi pour l'organisatrice

> À imprimer ou à lui envoyer.

1. **Ouvrir le mode édition** : touchez le **crayon** en haut à droite (ou le lien spécial qu'on vous a donné), tapez le mot de passe, puis **Entrer**. Le bouton **Afficher** montre ce que vous tapez.
2. **Ajouter des photos ou vidéos** : touchez le grand bouton **« + Ajouter des photos ou vidéos »** en bas, puis choisissez une ou plusieurs photos. Gardez la page ouverte pendant l'envoi. Les photos se rangent toutes seules dans la bonne journée.
3. **Écrire une légende** : sous la photo, touchez **Légende**, écrivez, ajoutez un lieu si vous voulez, puis **Enregistrer**.
4. **Changer l'ordre** : sous la photo, touchez **Monter** ou **Descendre**. Sur ordinateur, on peut aussi faire glisser la photo par la poignée (les petits points en haut à droite).
5. **Supprimer** : touchez **Supprimer**, puis confirmez avec **Oui, supprimer**.
   - Vous vous êtes trompée ? Touchez **Annuler** dans le message en bas de l'écran, ou **Annuler la suppression** dans la barre verte en haut.
   - Plus tard, la **Corbeille** permet de remettre une photo pendant 30 jours.
6. **Nommer une journée** : sous la date, touchez **Donner un nom à cette journée** (par exemple « Bonifacio »).
7. Le mode édition se ferme tout seul au bout de 12 heures. Il suffit alors de retaper le mot de passe. Touchez **Quitter** si vous prêtez votre téléphone.

## 10. Quotas et coûts

Vérifiés le 9 octobre 2026 dans les documentations officielles.

| Service | Gratuit | Source |
|---|---|---|
| Cloudflare R2 | 10 Go stockés, 1 million d'écritures et 10 millions de lectures par mois, **trafic sortant gratuit** | [Tarifs R2](https://developers.cloudflare.com/r2/pricing/) |
| Cloudflare Workers | 100 000 requêtes par jour ; corps de requête limité à **100 Mo** (plan Free) | [Limites Workers](https://developers.cloudflare.com/workers/platform/limits/) |
| GitHub Pages | Site de 1 Go maximum, 100 Go de trafic par mois (limite souple), dépôt public avec l'offre gratuite | [Limites Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) |

Pour donner un ordre d'idée :
- l'album actuel (34 médias) pèse **environ 22 Mo** ;
- une photo représente environ 0,3 Mo pour ses 3 tailles ;
- une visite complète de l'album sur téléphone charge environ 1 à 2 Mo de miniatures.

Le garde-fou `STORAGE_LIMIT_MB` refuse les envois avant d'atteindre les 10 Go.

## 11. Limites et risques connus

- **Confidentialité** : l'album est accessible à toute personne qui a le lien (voir l'encadré en haut). Les adresses des fichiers sont longues et aléatoires, mais elles ne sont pas secrètes.
- **Photos WhatsApp** : WhatsApp a déjà réduit les photos à 1280 px et effacé leur date de prise de vue. La date utilisée est celle du nom du fichier, c'est-à-dire **l'envoi WhatsApp**, en général le jour même. Pour une meilleure qualité, demandez les originaux, par exemple par e-mail ou via « Envoyer en tant que document ».
- **Photos iPhone HEIC** envoyées depuis un ordinateur Windows : Chrome ne sait pas les lire, et un message clair s'affiche. Depuis l'iPhone lui-même, la conversion est automatique.
- **Deux appareils modifiant en même temps** : rare dans un usage familial. Si l'ordre a changé ailleurs, l'album se recharge et le déplacement est à refaire.
- **Session expirée pendant la saisie d'une légende** : le texte tapé est perdu et il faut le retaper après reconnexion.
- **La session est gardée dans le navigateur** (stockage local) pendant 12 h. Sur un appareil partagé, touchez **Quitter**.
- **Mot de passe unique** : quiconque le connaît peut modifier l'album. Changez-le s'il a circulé (§6).
- **Diaporama** : sur iPhone, le vrai plein écran n'existe pas pour une page web, et le son des vidéos peut être coupé au démarrage automatique (limite d'iOS).

## 12. Dépannage

| Problème | Solution |
|---|---|
| « Ce site n'est pas autorisé à modifier l'album » | `ALLOWED_ORIGINS` ne contient pas exactement l'adresse du site (sans `/` final ni chemin). Corrigez, puis lancez `npm run deploy:api` |
| « Le mot de passe n'est pas configuré sur le serveur » | Les secrets `ADMIN_PASSWORD` ou `SESSION_SECRET` manquent ou sont trop courts (§5, étape 1) |
| « L'album n'a pas pu être chargé » | Vérifiez l'adresse dans `site/js/config.js` (`npm run set-api-url`) et que l'API répond à `…/api/album` |
| « Trop d'essais » | Attendre 15 minutes |
| L'aperçu WhatsApp n'affiche pas la photo | Vérifiez que `…/api/cover` affiche bien une image dans le navigateur ; WhatsApp met parfois plusieurs heures à rafraîchir |
| `npm` introuvable | Retapez `$env:Path = "$PWD\outils\node;$env:Path"` dans la fenêtre PowerShell |
