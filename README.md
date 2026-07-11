# Cinécrique

**Analyse filmique, image par image.**

Cinécrique est un atelier macOS local pour analyser, annoter et réécrire films et séries.

## Lancer l’application

Prérequis : macOS 13 ou supérieur, Node.js, Swift 5.9 ou supérieur et `ffprobe` (fourni par FFmpeg).

```bash
npm install
npm run macos:run
```

Le bouton **Run** de Codex exécute le même script : [`script/build_and_run.sh`](script/build_and_run.sh).

Commandes utiles :

```bash
npm test
npm run macos:build
npm run macos:verify
```

L’archive générée se trouve dans `dist/Cinécrique.zip`. Elle contient une application signée localement pour le développement, mais non notarisée pour une distribution publique.

## Fonctions disponibles

- import local par sélecteur macOS, ouverture de fichier ou glisser-déposer ;
- lecture, pause, navigation par plan et image par image avec timecode ;
- métadonnées techniques extraites localement avec `ffprobe` ;
- sous-titres SRT, WebVTT, ASS et SSA incrustés sur l’image ;
- repères timecodés de type note, lien ou image, sous forme de points ou de plages ;
- création, édition, duplication, suppression confirmée, tags, signets, recherche et filtres combinables ;
- annotations image sélectionnables, déplaçables et supprimables : note, flèche, rectangle et point numéroté ;
- éditeur Fountain et Markdown, avec suggestion visible et validation par `Tab` ;
- dispositions Montage, Écriture et Image, plus séparateur redimensionnable ;
- bibliothèque de projets repliable, sauvegarde automatique et dix snapshots locaux ;
- détection et reliaison des médias déplacés sans perte de l’analyse ;
- export sélectif du scénario, de l’analyse, des repères, des sous-titres, des métadonnées, de la vidéo et des images annotées ;
- export et réimport d’un projet Cinécrique complet, avec migration des anciens formats ;
- éditeurs Notes, Markdown et Fountain en JetBrains Mono ;
- enrichissement TMDB facultatif dans la langue choisie.

Le jeton TMDB est stocké dans le Trousseau macOS. Le fichier vidéo n’est jamais envoyé à TMDB : seules la recherche textuelle et la langue sont transmises quand l’utilisateur lance l’enrichissement.

## Données locales

Les projets sont enregistrés dans :

```text
~/Library/Application Support/Cinecrique/state.json
```

Les snapshots sont conservés dans `~/Library/Application Support/Cinecrique/Snapshots`. Si la sauvegarde principale est corrompue, le dernier snapshot valide est restauré et le fichier fautif est conservé pour diagnostic.

Un export unique produit directement le fichier choisi. Plusieurs éléments sont regroupés dans une archive ZIP sans modifier le média original.

## Architecture

- `macOS/Sources/Analyse` : coque AppKit de Cinécrique, WKWebView, menus natifs, streaming local, Trousseau et TMDB ;
- `macOS/Sources/AnalyseCore` : logique Swift testable du streaming par plages d’octets et de la sauvegarde locale ;
- `src` : interface React et logique du lecteur, des notes, des sous-titres et de l’éditeur ;
- `script/build_and_run.sh` : build web, build SwiftPM, vérifications, signature et lancement.

La couche d’interface reste web et portable afin de préparer une future version Windows/Linux, tandis que les accès fichiers et services système sont isolés derrière le pont natif macOS.
