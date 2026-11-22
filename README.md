# Cinécrique

**Analyse filmique, image par image.**

Cinécrique est un atelier macOS local pour analyser, annoter et réécrire films et séries.

## Lancer l’application

Prérequis : macOS 13 ou supérieur, Node.js et Swift 5.9 ou supérieur. Les builds macOS intègrent une version contrôlée de `ffmpeg` et `ffprobe`.

```bash
npm install
npm run macos:run
```

Le bouton **Run** de Codex exécute le même script : [`scripts/build_and_run.sh`](scripts/build_and_run.sh).

Commandes utiles :

```bash
npm test
npm run macos:ffmpeg
npm run media:check
npm run macos:build
npm run macos:dmg
npm run macos:verify
npm run release:check
```

Les artefacts générés se trouvent dans `dist/` : application, ZIP, DMG, checksums et source FFmpeg correspondante. Par défaut, l’application est signée localement pour le développement, mais non notarisée pour une distribution publique.

## Fonctions disponibles

- accueil façon logiciel de montage : liste des projets, reprise du dernier projet, recherche, tri et archives, avant d’ouvrir l’atelier ;
- import local par sélecteur macOS, ouverture de fichier ou glisser-déposer ;
- import de vidéos en ligne (YouTube, Internet Archive, Vimeo, plateformes de streaming moins connues…) via yt-dlp, avec sous-titres et couverture ;
- plans insérés et annotés directement dans les notes Markdown ;
- import de scénarios Fountain et plans liés aux scènes par des notes Fountain `[[plan:…]]` ;
- mises à jour automatiques signées (Ed25519) ;
- lecture, pause, navigation par plan et image par image avec timecode ;
- métadonnées techniques extraites localement avec `ffprobe` ;
- lecture des conteneurs MKV, AVI, MXF et autres via un proxy MP4 local, avec remux sans perte lorsque les pistes sont compatibles ;
- sous-titres SRT, WebVTT, ASS et SSA incrustés sur l’image ;
- repères timecodés de type note, lien ou image, sous forme de points ou de plages ;
- création, édition, duplication, suppression confirmée, tags, signets, recherche et filtres combinables ;
- annotations image sélectionnables, déplaçables et supprimables : note, flèche, rectangle et point numéroté ;
- scénario Fountain et notes Markdown, avec suggestion visible et validation par `Tab` ;
- dispositions Montage, Écriture et Image, plus séparateur redimensionnable ;
- bibliothèque de projets repliable, sauvegarde automatique et dix snapshots locaux ;
- détection et reliaison des médias déplacés sans perte de l’analyse ;
- export sélectif du scénario, de l’analyse, des repères, des sous-titres, des métadonnées, de la vidéo et des images annotées ;
- studio d’extraits en second mode : points A/B au timecode exact, extraits MP4 ou GIF, images fixes PNG ou JPEG, panier d’extraits et filigrane de citation désactivable ;
- export et réimport d’un projet Cinécrique complet, avec migration des anciens formats ;
- éditeur Notes en Markdown et éditeur Scénario en Fountain, tous deux en JetBrains Mono ;
- enrichissement TMDB facultatif dans la langue choisie.

Les vidéos en ligne sont enregistrées dans `~/Movies/Cinécrique`. Le moteur yt-dlp géré par Cinécrique
est installé à la demande dans `~/Library/Application Support/Cinecrique/Tools`, après vérification de
l’empreinte SHA-256 publiée avec chaque version de yt-dlp ; un yt-dlp installé par Homebrew est aussi
reconnu. Les flux protégés par DRM (Netflix, Disney+, Prime Video…) ne sont pas pris en charge.

Le jeton TMDB est stocké dans le Trousseau macOS. Le fichier vidéo n’est jamais envoyé à TMDB : seules la recherche textuelle et la langue sont transmises quand l’utilisateur lance l’enrichissement.

## Publier une mise à jour automatique

Une seule fois, sur la machine de publication :

```bash
node scripts/sign_update.mjs keygen
```

La clé privée est écrite dans `~/.cinecrique/update-signing-key.pem` (jamais dans le dépôt) ; copiez la
clé publique affichée dans `resources/macos/Info.plist` → `CinecriqueUpdatePublicKey`. Les copies
installées avant cette étape annoncent les nouvelles versions et ouvrent leur page, sans les installer.

À chaque version :

```bash
npm run release:check
npm run release:sign
```

Joignez `dist/Cinecrique-<version>.dmg` et `dist/cinecrique-update.json` à la publication GitHub dont le
tag est le numéro de version. L’application lit le manifeste de la dernière publication, vérifie la
signature, la taille et le SHA-256 du DMG, puis la signature de code de la nouvelle version avant de la
mettre en place.

## Données locales

Les projets sont enregistrés dans :

```text
~/Library/Application Support/Cinecrique/state.json
```

Les snapshots sont conservés dans `~/Library/Application Support/Cinecrique/Snapshots`. Si la sauvegarde principale est corrompue, le dernier snapshot valide est restauré et le fichier fautif est conservé pour diagnostic.

Les proxies de lecture sont conservés dans `~/Library/Application Support/Cinecrique/Media Proxies`. Ils peuvent être supprimés et régénérés depuis le panneau Métadonnées. Le fichier original reste la référence des projets et des exports vidéo.

Un export unique produit directement le fichier choisi. Plusieurs éléments sont regroupés dans une archive ZIP sans modifier le média original.

## Architecture

- `source/macos/Analyse` : coque AppKit de Cinécrique, WKWebView, menus natifs, streaming local, Trousseau et TMDB ;
- `source/macos/AnalyseCore` : logique Swift testable du streaming par plages d’octets et de la sauvegarde locale ;
- `source/web` : interface React et logique du lecteur, des notes, des sous-titres et de l’éditeur ;
- `test/web` : tests unitaires Node du code React/JS (`node --test`) ;
- `test/fixtures` : médias d’exemple pour des vérifications manuelles ;
- `checks/AnalyseCoreChecks` : suite de vérifications Swift exécutables pour `AnalyseCore` (`npm run macos:verify`) ;
- vérifications intégrées au binaire livré : `--check-media-proxy`, `--check-exact-frame` et `--check-window-drag`, toutes exécutées par `npm run release:check` ;
- `resources/macos` : icônes, `Info.plist` et mentions embarquées dans l’application ;
- `scripts/build_and_run.sh` : build web, build SwiftPM, vérifications, signature et lancement.
- `scripts/build_ffmpeg_tools.sh` : compilation reproductible des outils FFmpeg LGPL utilisés pour les proxies locaux.
- `design` : captures et notes de comparaison visuelle du prototype, sans lien avec le code exécuté ;
- `docs` : page de présentation publiée sur GitHub Pages, indépendante de l’application.

L’historique des versions est consigné dans [`CHANGELOG.md`](CHANGELOG.md). Les mentions et
conditions des composants tiers sont décrites dans
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). La revue de sécurité du code est publiée dans
[`AUDIT-SECURITE.md`](AUDIT-SECURITE.md), et la procédure de signalement dans
[`SECURITY.md`](SECURITY.md).

La couche d’interface reste web et portable afin de préparer une future version Windows/Linux, tandis que les accès fichiers et services système sont isolés derrière le pont natif macOS.
