# Journal des modifications

Toutes les modifications notables de Cinécrique sont consignées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le versionnage respecte le
[versionnage sémantique](https://semver.org/lang/fr/).

## [1.1.0] — 2026-09-14

Deuxième version. Elle ajoute un second mode à l’atelier d’analyse — un studio d’extraits pour sortir
des images et des séquences prêtes à monter — et corrige un défaut qui empêchait de déplacer la
fenêtre.

### Ajouté

- **Studio d’extraits.** Un bouton en forme de ciseaux dans la barre du haut bascule vers un second
  mode. L’atelier d’analyse reste intact : repères, annotations, scénario et notes sont conservés, et
  on revient d’un clic.
- **Extraits vidéo.** Export en MP4 (H.264) jusqu’à 10 minutes ou en GIF jusqu’à 30 secondes, entre un
  point A et un point B. Définition au choix (source, 2160p, 1080p, 720p, 480p), trois niveaux de
  qualité, son conservé ou coupé.
- **Deux modes de découpe.** *Précision image*, qui coupe au timecode exact par ré-encodage, ou
  *copie directe*, sans ré-encodage, qui coupe au plan-clé le plus proche. La copie directe bascule
  automatiquement vers le ré-encodage lorsque les pistes source ne le permettent pas.
- **Images fixes.** Export PNG ou JPEG à l’image exacte, sans tolérance de recherche.
- **Filigrane de citation.** La réplique présente dans la sélection est lue depuis les sous-titres et
  proposée automatiquement ; elle peut être remplacée par un texte libre. S’y ajoutent une ligne
  d’attribution et le timecode. Cinq positions, trois tailles, opacité réglable, aperçu en direct
  aligné sur l’image réellement projetée. **Le filigrane se désactive entièrement.**
- **Panier d’extraits.** Jusqu’à 60 éléments accumulés pendant le visionnage, exportés d’un coup dans
  un dossier, avec progression en direct et annulation à tout moment.
- **Page de présentation** publiable sur GitHub Pages, dans `docs/`.
- **Audit de sécurité** complet du code, publié dans [`AUDIT-SECURITE.md`](AUDIT-SECURITE.md).
- **Politique de signalement de vulnérabilité**, dans [`SECURITY.md`](SECURITY.md).
- **Vérification `--check-window-drag`** sur le binaire livré, qui contrôle la géométrie réelle de la
  bande de déplacement de la fenêtre.

### Modifié

- Réorganisation de l’arborescence : `src/` → `source/web`, `macOS/Sources` → `source/macos`,
  `script/` → `scripts/`, `Tests/` → `test/web`, `test-fixtures/` → `test/fixtures`.
- `vite` et `@vitejs/plugin-react` sont déclarés en `devDependencies` : `dependencies` ne contient
  plus que ce qui finit réellement dans l’application.
- Le bac à sable de SwiftPM est de nouveau actif pendant les constructions de publication.

### Corrigé

- **La fenêtre se déplace à nouveau.** La zone de déplacement était calculée dans un repère dont
  l’origine était supposée en bas à gauche, alors que `WKWebView` est inversé : elle se retrouvait
  dans les 55 pixels du bas de la fenêtre, où elle absorbait aussi les clics sur la timeline et la
  liste des repères. Le déplacement est désormais assuré par une vue dédiée posée en haut de la
  fenêtre, et le double-clic respecte le réglage système « Double-cliquer sur la barre de titre d’une
  fenêtre pour ».
- Les commandes `npm run macos:*` échouaient sur `Permission denied` : les scripts de construction
  avaient perdu leur bit exécutable.
- `.npmrc` pointait vers un répertoire de cache absolu propre à une seule machine.

### Sécurité

- **Injection d’options `unzip` corrigée.** Un nom d’entrée commençant par `-` dans une archive
  `.cinecrique` reçue d’un tiers était transmis tel quel à `unzip`, qui l’interprétait comme une
  option. Les noms d’entrée sont désormais rejetés s’ils peuvent être confondus avec un paramètre.
- `npm audit` ne remonte plus aucune vulnérabilité.
- Deux limites connues restent ouvertes et sont documentées dans l’audit : les binaires publiés sont
  signés en ad hoc et **non notarisés** (constat S-01), et l’application n’est pas confinée par l’App
  Sandbox (constat S-02).

### Mise à jour

Vos projets, repères et annotations sont conservés. Aucune manipulation particulière.

## [1.0.0] — 2026-07-14

Première version publiée. Atelier macOS local d’analyse filmique, image par image.

### Ajouté

- Import local par sélecteur macOS, ouverture de fichier ou glisser-déposer.
- Lecture, pause, navigation par plan et image par image avec timecode SMPTE, réglages de timecode
  propres à chaque projet (cadences courantes, décalage, *drop-frame* 29,97).
- Transport professionnel : boucle A/B persistante, vitesses de lecture, comportement J/K/L, coupure
  du son persistante, lecture silencieuse et raccourcis à touche unique configurables.
- Métadonnées techniques extraites localement avec `ffprobe`.
- Lecture des conteneurs MKV, AVI, MXF et autres via un proxy MP4 local, avec remux sans perte
  lorsque les pistes sont compatibles.
- Sous-titres SRT, WebVTT, ASS et SSA incrustés sur l’image, et onglet de transcription synchronisé.
- Repères timecodés de type note, lien ou image, en points ou en plages, avec tags, signets,
  recherche et filtres combinables.
- Annotations d’image sélectionnables, déplaçables et supprimables : note, flèche, rectangle et point
  numéroté.
- Éditeur de scénario en Fountain avec complétion contextuelle, et éditeur de notes en Markdown.
- Onglet Plans, dérivé des repères de plage, et comparateur d’images.
- Bibliothèque de projets repliable, sauvegarde automatique et dix instantanés locaux.
- Détection et reliaison des médias déplacés sans perte de l’analyse.
- Export sélectif du scénario, de l’analyse, des repères, des sous-titres, des métadonnées, de la
  vidéo et des images annotées ; export et réimport d’un projet Cinécrique complet.
- Rapports HTML et PDF locaux, avec sections sélectionnables.
- Enrichissement TMDB facultatif, jeton stocké dans le Trousseau macOS.
- Couvertures de projet : image locale, affiche TMDB, image courante, texte ou marque Cinécrique.

[1.1.0]: https://github.com/ByteOneDev/Cinecrique/releases/tag/v1.1.0
[1.0.0]: https://github.com/ByteOneDev/Cinecrique/releases/tag/v1.0.0
