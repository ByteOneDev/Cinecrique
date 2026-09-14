# Audit de sécurité — Cinécrique 1.1.0

**Date** : 14 septembre 2026
**Périmètre** : coque macOS Swift (`source/macos/`), interface web embarquée (`source/web/`), chaîne de
build et de distribution (`scripts/`, `resources/macos/`), dépendances npm.
**Méthode** : revue manuelle de l’intégralité du code source, vérification dynamique ciblée des points
sensibles (comportement réel d’`unzip`, `npm audit`), exécution des suites `npm test` et
`npm run macos:verify`.
**Hors périmètre** : audit du code de FFmpeg lui-même, revue cryptographique, tests d’intrusion sur la
machine hôte, analyse binaire du bundle signé.

---

## 1. Synthèse

Cinécrique est une application **locale par conception**, et cette intention est tenue dans le code. La
surface d’attaque réseau est quasi nulle : l’interface web ne peut émettre aucune requête sortante
(`connect-src 'none'`), le FFmpeg embarqué est compilé avec `--disable-network`, et le seul trafic
possible est l’enrichissement TMDB, déclenché explicitement par l’utilisateur.

Le pont natif est le point de contact le plus sensible entre la vue web et le système : il est
correctement verrouillé (liste blanche de commandes, vérification de l’origine du message, bornes de
taille sur chaque champ, validation des chemins). La lecture d’archives de projet est protégée contre
le *zip slip* et les bombes de décompression. Les rapports HTML exportés échappent toutes les entrées
utilisateur et embarquent leur propre CSP.

Les faiblesses réelles se situent **au niveau de l’isolation du processus et de la distribution**, pas
de la logique applicative.

| Réf. | Constat | Sévérité | État |
|------|---------|----------|------|
| S-01 | Distribution non notarisée, signature ad hoc par défaut | Élevée *(distribution)* | Ouvert |
| S-02 | Aucun App Sandbox ni entitlements, FFmpeg exécuté dans le processus principal | Moyenne | Ouvert |
| S-03 | Injection d’options `unzip` via un nom d’entrée d’archive | Moyenne | **Corrigé dans cet audit** |
| S-04 | Ré-autorisation automatique des chemins lus depuis l’état persisté | Faible à moyenne | Ouvert |
| S-05 | Dépendances de build vulnérables et mal classées | Moyenne *(chaîne d’appro.)* | **Corrigé** |
| S-06 | Fenêtre TOCTOU entre la validation d’un fichier et son usage | Faible | Ouvert |
| S-07 | `.npmrc` pointe vers un cache absolu inexistant | Faible *(hygiène)* | **Corrigé** |
| S-08 | Bac à sable SwiftPM désactivé dans le script de release | Faible | **Corrigé** |
| S-09 | `style-src 'unsafe-inline'` dans la CSP de l’application | Informative | Accepté |
| S-10 | Aucune politique de signalement de vulnérabilité | Informative | **Corrigé** |
| S-11 | Proxies de lecture non chiffrés dans Application Support | Informative | Accepté |
| S-12 | Le filigrane de citation n’est pas une mesure de protection | Informative | Par conception |

Trois défauts de **disponibilité** sans lien avec la sécurité ont également été trouvés et corrigés
pendant l’audit, dont un qui empêchait l’application de démarrer (voir §5).

---

## 2. Modèle de menace retenu

| Attaquant | Capacité supposée | Couvert ? |
|-----------|-------------------|-----------|
| Fichier média hostile | MKV/MP4/MXF forgé, ouvert par l’utilisateur | Partiellement — voir S-02 |
| Projet `.cinecrique` hostile | Archive reçue d’un tiers et importée | Oui — voir §4 et S-03 |
| Sous-titres hostiles | SRT/ASS forgés | Oui (analyse purement textuelle, bornée) |
| Réponse TMDB hostile | Serveur ou intermédiaire malveillant | Oui (réponse bornée, normalisée, jamais évaluée) |
| Page web hostile dans la WebView | Nécessiterait une XSS dans une app sans contenu distant | Oui (CSP stricte, pont figé) |
| Autre utilisateur local du Mac | Accès au compte de l’utilisateur | Non — hors périmètre d’une app locale |

---

## 3. Ce qui est solide

Ces points sont documentés ici parce qu’ils constituent la véritable défense du produit et ne doivent
pas être affaiblis par de futures évolutions.

**Cloisonnement de la vue web** — `BundledAppSchemeHandler` sert chaque ressource avec une CSP
restrictive (`default-src 'none'`, `script-src 'self'`, `connect-src 'none'`, `object-src 'none'`,
`frame-ancestors 'none'`), plus `X-Content-Type-Options: nosniff` et `Referrer-Policy: no-referrer`.
La liste d’extensions servies est fermée et la racine est vérifiée par préfixe après résolution des
liens symboliques. `WebAppViewController` refuse toute navigation en dehors de `analyse-app://local`
et utilise un `websiteDataStore` non persistant.

**Pont natif** — `NativeBridge.userContentController` vérifie le nom du canal, l’appartenance à la
*frame* principale, le protocole et l’hôte de l’origine, l’identité de la WebView émettrice, puis
borne l’identifiant et le nom de commande. Les commandes inconnues sont rejetées explicitement. Le
script injecté gèle l’objet `AnalyseNative` et plafonne à 64 le nombre d’appels concurrents.

**Réponses vers la vue web** — `respond` et `emitEvent` utilisent `callAsyncJavaScript(_:arguments:)`,
jamais d’interpolation de chaîne dans du JavaScript. Aucune injection possible par les données.

**Accès aux fichiers** — `MediaAccessRegistry` maintient une liste blanche de chemins normalisés
(liens symboliques résolus) ; chaque commande touchant un média vérifie l’appartenance à cette liste,
puis `validatedVideoURL` revérifie l’extension, le type de fichier régulier et l’absence de lien
symbolique.

**Archives de projet** — `ProjectArchivePolicy.validatedEntries` rejette les chemins absolus, les
remontées `..`, les segments vides, les caractères de contrôle et les motifs glob ; les doublons sont
détectés après normalisation Unicode et insensibilité à la casse. La destination est recalculée côté
Swift et vérifiée par préfixe. Le ratio de décompression est plafonné à 200, l’expansion totale à
100 Go, et l’espace disque est vérifié avant extraction.

**Données persistées** — `PersistedStatePolicy` interdit les clés `__proto__`, `prototype` et
`constructor`, borne la profondeur (32), le nombre de valeurs (1 000 000) et la taille des chaînes.
La même politique est appliquée en miroir côté JavaScript dans `source/web/project.js`.
`state.json` et les snapshots sont écrits en `0600` dans des répertoires `0700`.

**Rapports exportés** — `ReportHTMLBuilder` échappe systématiquement `&`, `<`, `>`, `"` et `'`, filtre
les images sur le préfixe `data:image/png;base64,`, valide les liens via `AppURLPolicy`, et insère une
CSP `default-src 'none'` dans le document produit. Le rendu PDF se fait dans une WebView éphémère
**avec JavaScript désactivé**.

**Moteur média** — FFmpeg est compilé depuis une source dont le SHA-256 est épinglé, avec
`--disable-network`, `--disable-autodetect`, sans `--enable-gpl` ni `--enable-nonfree` ; ces
contraintes sont revérifiées à la publication par `scripts/check_release.sh`. `MediaToolLocator`
n’accepte que des exécutables situés sous `Contents/Resources/Tools`, et le repli vers Homebrew est
compilé uniquement en `DEBUG` **et** conditionné à une variable d’environnement — l’absence de ces
chemins dans le binaire de release est vérifiée par `strings`.

**Processus enfants** — Aucun appel ne passe par un shell : tous utilisent un vecteur d’arguments.
`BoundedProcessRunner` et les lecteurs de `MediaProxyService`/`FFprobeService` appliquent des délais
d’expiration, plafonnent les sorties lues et escaladent `terminate()` puis `SIGKILL`.

**Secret TMDB** — Jeton stocké dans le Trousseau avec `kSecUseDataProtectionKeychain`,
`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` et `kSecAttrSynchronizable: false`. Le jeu de
caractères est validé, la taille bornée à 4 Ko, et le jeton n’apparaît dans aucun message d’erreur.
Seuls un titre et une langue (liste blanche de cinq valeurs) sont transmis à TMDB.

**Nouveau studio d’extraits** — Le texte du filigrane ne rejoint **jamais** la ligne de commande
FFmpeg : il est rendu en PNG par AppKit puis composé avec le filtre `overlay`, ce qui supprime toute
possibilité d’injection dans une expression de filtre. Les noms de fichiers produits sont réduits à
`[A-Za-z0-9._-]`, la destination provient d’un panneau système, et la cible calculée est revérifiée
comme étant bien un enfant direct du dossier choisi.

---

## 4. Constats détaillés

### S-01 — Distribution non notarisée, signature ad hoc par défaut · Sévérité élevée (distribution)

**Localisation** : `scripts/build_and_run.sh` (`SIGN_IDENTITY="${CINECRIQUE_SIGN_IDENTITY:--}"`),
`scripts/check_release.sh` (avertissement seulement).

Le script de build signe par défaut en *ad hoc* (`--sign -`). `check_release.sh` détecte
`Signature=adhoc` mais se contente d’un avertissement sur la sortie d’erreur : une release non
signée par un Developer ID et non notarisée passe donc la vérification.

**Impact** : Gatekeeper refusera d’ouvrir l’application téléchargée. L’utilisateur sera invité à
contourner la protection (clic droit → Ouvrir, voire `xattr -d com.apple.quarantine`), ce qui
l’entraîne à désactiver précisément le mécanisme censé détecter une substitution du binaire. Par
ailleurs, le fichier `.sha256` est publié sur le même canal que le DMG : il détecte une corruption de
transfert, pas une substitution malveillante.

**Recommandation** : signer avec une identité Developer ID puis notariser — le script
`scripts/notarize_dmg.sh` existe déjà et fait le travail. Faire échouer `check_release.sh` (et non
avertir) lorsque la signature est ad hoc ou le ticket de notarisation absent. Publier les empreintes
via les *release notes* GitHub signées plutôt que par un simple fichier joint.

### S-02 — Aucun App Sandbox, FFmpeg exécuté avec les droits complets de l’utilisateur · Sévérité moyenne

**Localisation** : absence de fichier `.entitlements` dans le dépôt ; `codesign --options runtime`
sans entitlements ; `MediaProxyService`, `FFprobeService` et le nouveau `ClipExportService` lancent
`ffmpeg`/`ffprobe` comme processus enfants directs.

Le *hardened runtime* est activé, mais l’application ne demande **ni App Sandbox, ni aucune
restriction d’accès disque**. Elle dispose donc de l’ensemble des droits du compte utilisateur, et
les processus FFmpeg héritent de ce contexte.

**Impact** : les démuxeurs et décodeurs de FFmpeg constituent historiquement la surface d’attaque la
plus exposée d’une application média : un fichier MKV ou MXF forgé qui déclencherait une corruption
mémoire dans FFmpeg s’exécuterait avec un accès complet aux Documents, au Bureau, au Trousseau
déverrouillé et au réseau du système — alors même que le FFmpeg embarqué est, lui, privé de réseau.

**Recommandation, par ordre d’efficacité** :

1. Isoler l’exécution de FFmpeg dans un service XPC sandboxé recevant des descripteurs de fichiers
   plutôt que des chemins. C’est la seule mesure qui confine réellement une faille du décodeur.
2. À défaut, activer l’App Sandbox sur l’application
   (`com.apple.security.app-sandbox`, `com.apple.security.files.user-selected.read-write`) et
   remplacer la liste blanche de chemins de `MediaAccessRegistry` par des *security-scoped bookmarks*
   obtenus des panneaux d’ouverture. Ce changement résout aussi S-04 et S-06.
3. Documenter explicitement le choix inverse s’il est assumé, pour que la décision soit visible.

### S-03 — Injection d’options `unzip` via un nom d’entrée d’archive · Sévérité moyenne · **Corrigé**

**Localisation** : `source/macos/AnalyseCore/ProjectArchivePolicy.swift`,
`NativeBridge.extractArchive`.

`validatedEntries` rejetait les chemins absolus, les remontées et les motifs glob, mais pas un nom
d’entrée **commençant par un tiret**. Chaque entrée est ensuite passée telle quelle à
`/usr/bin/unzip -p <archive> <entrée>`, où elle est interprétée comme une option d’`unzip`.

Vérification effectuée pendant l’audit sur une archive contenant une entrée nommée `-x` :

```
$ unzip -p test.zip -x
contenu
charge utile
```

`-x` est lu comme le commutateur d’exclusion sans liste associée : `unzip` écrit alors **le contenu
concaténé de tous les membres de l’archive** sur la sortie standard, au lieu du seul membre demandé.

**Impact** : l’import d’un projet `.cinecrique` reçu d’un tiers peut détourner le comportement de
l’extracteur — un fichier extrait reçoit le contenu d’autres membres, et le budget d’expansion est
consommé plusieurs fois. Il n’y a **ni évasion de répertoire ni exécution de code** : le chemin de
destination reste calculé côté Swift et vérifié par préfixe, et le plafond d’expansion continue de
s’appliquer. L’import échoue ensuite sur la validation du manifeste. C’est donc une faiblesse de
validation d’entrée exploitable en déni de service ou en confusion de contenu, pas une compromission.

**Correction appliquée** : `validatedEntries` rejette désormais tout nom d’entrée commençant par `-`
(`ProjectArchiveError.unsafeEntry`). Quatre cas (`-x`, `-d`, `--help`, `-P`) sont couverts par
`checks/AnalyseCoreChecks`.

**Recommandation complémentaire** : à terme, remplacer l’appel à `/usr/bin/unzip` par `libarchive` ou
`NSFileCoordinator`, ce qui supprime définitivement la classe « injection d’argument dans un
utilitaire en ligne de commande ».

### S-04 — Ré-autorisation automatique des chemins lus depuis l’état persisté · Sévérité faible à moyenne

**Localisation** : `NativeBridge.sanitizedPersistedState` et `NativeBridge.restoreMediaRuntime`.

Au chargement de l’état, chaque projet dont le champ `path` porte une extension vidéo connue est
réinjecté dans `MediaAccessRegistry` via `approve(...)`, sans nouvelle intervention de l’utilisateur.

**Impact** : quiconque peut écrire dans `~/Library/Application Support/Cinecrique/state.json`, ou
faire importer un projet contenant un chemin choisi, ajoute ce chemin à la liste blanche de lecture
du schéma `analyse-media://`. Le contenu devient alors lisible par la vue web. L’exposition reste
contenue — la CSP interdit toute exfiltration réseau et l’attaquant doit déjà pouvoir écrire dans le
compte de l’utilisateur — mais l’autorisation est accordée sans consentement explicite, ce qui
contredit le principe affiché « l’application ne lit que les médias que vous avez ouverts ».

**Recommandation** : persister des *security-scoped bookmarks* plutôt que des chemins nus, et
redemander confirmation pour tout chemin qui ne provient pas d’un panneau d’ouverture ou d’un
glisser-déposer de la session en cours.

### S-05 — Dépendances de build vulnérables et classées en `dependencies` · Sévérité moyenne (chaîne d’approvisionnement) · **Corrigé**

**Localisation** : `package.json`, `package-lock.json`.

`npm audit --omit=dev` remonte **12 vulnérabilités, dont 10 hautes**, toutes dans la chaîne de build :
`vite`, `@vitejs/plugin-react`, `@babel/*`, `postcss` (deux traversées de chemin via
`sourceMappingURL`, GHSA-fxqj-rqcc-2cmp et GHSA-r28c-9q8g-f849), `nanoid`, `browserslist`,
`baseline-browser-mapping`.

Ces paquets ne sont pas embarqués dans l’application livrée — seuls `react`, `react-dom` et
`@phosphor-icons/react` finissent dans le bundle. Mais ils s’exécutent sur la machine de build avec un
accès complet au dépôt, et `vite` comme `@vitejs/plugin-react` sont déclarés en `dependencies` au lieu
de `devDependencies`, ce qui brouille la frontière entre ce qui est livré et ce qui ne l’est pas.

**Correction appliquée** : `npm audit fix` exécuté — l’audit remonte désormais **0 vulnérabilité**.
`vite` et `@vitejs/plugin-react` ont été déplacés vers `devDependencies` ; `dependencies` ne contient
plus que ce qui finit réellement dans le bundle (`react`, `react-dom`, `@phosphor-icons/react`).

**Recommandation restante** : utiliser `npm ci` plutôt que `npm install` dans les builds de release,
pour garantir la reproductibilité depuis le fichier de verrouillage.

### S-06 — Fenêtre TOCTOU entre validation et usage · Sévérité faible

**Localisation** : `NativeBridge.validatedFileURL` et l’ensemble des appelants.

Le fichier est validé (fichier régulier, pas un lien symbolique, extension autorisée) puis son
**chemin** est réutilisé plus tard par FFmpeg, AVFoundation ou `FileHandle`. Entre les deux, le
chemin peut désigner autre chose.

**Impact** : faible sur une application mono-utilisateur locale — l’attaquant devrait déjà exécuter du
code dans la session. À signaler toutefois car le proxy média écrit dans un répertoire partagé
(`Media Proxies`) et les exports écrivent à côté de la destination choisie.

**Recommandation** : ouvrir un descripteur de fichier avec `O_NOFOLLOW` au moment de la validation et
le transmettre (`/dev/fd/N` pour FFmpeg), ou s’appuyer sur des bookmarks à portée de sécurité.

### S-07 — `.npmrc` pointe vers un cache absolu inexistant · Sévérité faible (hygiène) · **Corrigé**

```
cache=/Users/perezmatthieu/Desktop/analyse/.npm-cache
```

Le dossier a été renommé depuis : ce chemin n’existe plus. Le fichier est versionné et divulgue
l’arborescence locale de l’auteur ; sur toute autre machine, npm tentera de créer ce chemin.

**Correction appliquée** : remplacé par le chemin relatif `cache=.npm-cache`, qui correspond au
répertoire déjà ignoré par Git et fonctionne sur n’importe quelle machine.

### S-08 — Bac à sable SwiftPM désactivé dans le script de release · Sévérité faible · **Corrigé**

`scripts/check_release.sh` exporte `CINECRIQUE_DISABLE_SWIFTPM_SANDBOX=1` pour la build officielle,
ce qui autorise les scripts de build du paquet Swift à écrire hors de leur bac à sable. Le paquet
n’a aucune dépendance externe aujourd’hui, donc l’exposition réelle est nulle — mais elle le
deviendrait dès la première dépendance tierce ajoutée.

**Correction appliquée** : la variable a été retirée après vérification qu’une build de release
complète aboutit avec le bac à sable de SwiftPM actif. La possibilité de la définir à la main reste
disponible dans `build_and_run.sh` pour les environnements qui l’exigeraient.

### S-09 — `style-src 'unsafe-inline'` · Informative, accepté

La CSP de l’application autorise les styles en ligne, nécessaires aux `style={{...}}` de React.
Combiné à `default-src 'none'`, `script-src 'self'` et `connect-src 'none'`, le risque résiduel se
limite à une injection purement visuelle, et il n’existe aucun contenu distant pour la déclencher.
Acceptable en l’état.

### S-10 — Aucune politique de signalement de vulnérabilité · Informative · **Corrigé**

Le dépôt ne contient pas de `SECURITY.md`. Un chercheur qui trouverait une faille n’a pas de canal
privé pour la signaler.

**Correction appliquée** : ajout de [`SECURITY.md`](SECURITY.md), qui oriente vers le signalement
privé de GitHub plutôt que vers une adresse personnelle, précise les versions supportées, le
périmètre, un délai de réponse indicatif et les deux limites connues à la distribution.

### S-11 — Proxies de lecture non chiffrés · Informative, accepté

Les conteneurs non natifs (MKV, AVI, MXF…) produisent un proxy MP4 dans
`~/Library/Application Support/Cinecrique/Media Proxies`, en `0600`. Il s’agit d’une copie
potentiellement intégrale du film, en clair, protégée uniquement par les permissions POSIX et par
FileVault s’il est activé. Le comportement est documenté et le proxy peut être purgé depuis le
panneau Métadonnées ; c’est un compromis assumé pour la lecture.

### S-12 — Le filigrane de citation n’est pas une mesure de protection · Informative, par conception

Le filigrane introduit par le studio d’extraits est une **mention d’attribution**, pas un dispositif
technique de protection : il est désactivable par une case à cocher, et un extrait exporté peut être
recadré. Il ne doit être présenté ni comme un DRM, ni comme une justification juridique de
réutilisation — l’exception de courte citation reste soumise à ses propres conditions (brièveté,
finalité critique ou pédagogique, mention de la source). Si un jour une édition payante devait rendre
le filigrane obligatoire, il faudrait garder à l’esprit qu’une désactivation côté client reste
triviale à contourner pour un utilisateur déterminé : le modèle économique ne peut pas reposer
uniquement dessus.

---

## 5. Défauts de disponibilité corrigés pendant l’audit

Aucun des trois n’est une faille de sécurité, mais tous étaient bloquants et méritent d’être
consignés.

### 5.1 — L’interface ne démarrait plus

**`source/web/App.jsx`.**

Le composant `App` déclarait `persistedState` et `saveNow` (lignes ~2380 dans la version auditée)
**après** les `useCallback` qui les citent dans leurs tableaux de dépendances (`restoreReplacementSnapshot`,
`resolveProjectImport`, ~lignes 2012 et 2071). Un tableau de dépendances est évalué au rendu : React
levait donc `ReferenceError: Cannot access 'saveNow' before initialization` dès le premier rendu, et
l’application restait sur un écran noir. Le défaut est présent dans le commit `d1e5db7`
(« Harden project import and local persistence »).

Les deux déclarations ont été déplacées avant leur première utilisation ; l’application démarre et
fonctionne à nouveau. Une vérification automatique du démarrage (montage du composant dans un test)
éviterait une régression de cette classe.

### 5.2 — La fenêtre ne pouvait pas être déplacée

**`source/macos/Analyse/DropWebView.swift`.**

L’interface occupant toute la fenêtre, barre de titre comprise, AppKit ne reçoit jamais de clic sur
sa propre barre de titre : le déplacement était donc réimplémenté à la main dans `mouseDown`. Le test
de zone s’écrivait `point.y >= bounds.height - titlebarHeight`, ce qui suppose un repère dont
l’origine est en bas à gauche. Or **`WKWebView.isFlipped` vaut `true`** — l’origine est en haut à
gauche. La zone de déplacement se trouvait donc dans les 55 pixels du **bas** de la fenêtre, au-dessus
de la timeline et de la liste des repères, où elle avalait aussi les clics au profit d’un
`performDrag`.

La correction ne se contente pas d’inverser le test. Le déplacement est désormais assuré par une vue
AppKit transparente dédiée (`WindowDragView`) posée au-dessus de la vue web : `WKWebView` transmet ses
événements souris au processus de contenu web, ce qui rend peu fiable tout déplacement initié depuis
elle. La géométrie de la bande est isolée dans `WindowDragPolicy` (`AnalyseCore`) et couverte par neuf
vérifications — insets des feux de signalisation et des contrôles de la barre, hauteur, largeur
minimale, comportement en dessous de la largeur utilisable. Le double-clic respecte le réglage système
« Double-cliquer sur la barre de titre d’une fenêtre pour ».

### 5.3 — Toutes les commandes `npm run macos:*` échouaient

**`scripts/*.sh`.**

Lors du renommage `script/` → `scripts/`, les scripts ont perdu leur bit exécutable : mode `600` au
lieu du `755` enregistré dans Git. `npm run macos:dmg`, `macos:build`, `macos:run`, `release:check` et
`media:check` échouaient tous sur `Permission denied`, rendant toute construction impossible. Les
modes ont été rétablis à l’identique du dépôt.

---

## 6. Vérifications effectuées

| Contrôle | Résultat |
|----------|----------|
| Injection de commande shell | Aucune — tous les processus reçoivent un vecteur d’arguments |
| Injection d’argument dans un processus enfant | Une occurrence trouvée et corrigée (S-03) |
| Traversée de chemin à l’import d’archive | Bloquée (chemins recalculés et vérifiés par préfixe) |
| Bombe de décompression | Bloquée (ratio 200, plafond 100 Go, préflight disque) |
| Pollution de prototype via un projet importé | Bloquée côté Swift et côté JavaScript |
| XSS dans l’interface | Aucun `innerHTML`, `dangerouslySetInnerHTML`, `eval` ni `new Function` |
| XSS dans les rapports exportés | Échappement systématique + CSP dans le document produit |
| Exfiltration réseau depuis la vue web | Impossible (`connect-src 'none'`, FFmpeg sans réseau) |
| Secret en clair dans le dépôt ou les journaux | Aucun ; jeton TMDB dans le Trousseau |
| Ouverture d’URL non fiable | `http`/`https` uniquement, sans identifiants intégrés |
| Permissions des fichiers écrits | `0600` pour les fichiers, `0700` pour les répertoires |
| Suites de tests | `npm test` : 93/93 · `AnalyseCoreChecks` : toutes passées |
| Vulnérabilités npm après correction | `npm audit` : 0 |

---

## 7. Priorités recommandées

1. **Signer et notariser les releases** (S-01) — c’est le seul constat qui affecte directement tous
   les utilisateurs dès le premier téléchargement.
2. **Isoler FFmpeg** (S-02) — le chantier le plus lourd, mais celui qui change la classe de risque de
   l’application face à un fichier média hostile.
3. **Passer aux security-scoped bookmarks** (S-04 et S-06 d’un seul coup), idéalement en même temps
   que l’App Sandbox.
4. **Utiliser `npm ci`** dans les builds de release, pour verrouiller les versions installées.

Les constats S-03, S-05, S-07, S-08 et S-10 ont été traités pendant l’audit et ne demandent plus
d’action.

---

## 8. Limites de cet audit

Cet audit repose sur une revue manuelle du code et sur des vérifications dynamiques ponctuelles. Il
ne remplace ni un test d’intrusion, ni une campagne de *fuzzing* sur les chemins d’analyse média —
qui serait la démarche la plus pertinente ici, en particulier sur `parseSubtitles`, sur les métadonnées
renvoyées par `ffprobe` et sur les conteneurs passés à FFmpeg. Le code de FFmpeg lui-même n’a pas été
examiné ; sa mise à jour régulière reste la principale mesure de réduction de risque le concernant.
