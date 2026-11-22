# Composants tiers

## FFmpeg

Cinécrique utilise les exécutables `ffmpeg` et `ffprobe` du projet FFmpeg pour inspecter les médias et créer des proxies de lecture locaux.

- Version distribuée : FFmpeg 8.1.2
- Licence : GNU Lesser General Public License, version 2.1 ou ultérieure
- Projet : https://ffmpeg.org/
- Source : `ffmpeg-8.1.2-source.tar.xz`, jointe aux releases de Cinécrique
- Configuration : produite dans `Contents/Resources/Tools/BUILD-CONFIG.txt`

La compilation distribuée par Cinécrique n’active ni `--enable-gpl` ni `--enable-nonfree`. Les fichiers `COPYING.LGPLv2.1`, `LICENSE.md`, la configuration et le SHA-256 de la source sont inclus dans l’application.

## yt-dlp

yt-dlp n’est pas inclus dans l’application. À la demande de l’utilisateur, Cinécrique télécharge le
binaire `yt-dlp_macos` publié sur <https://github.com/yt-dlp/yt-dlp/releases>, vérifie son empreinte
SHA-256 contre le fichier `SHA2-256SUMS` de la même publication et l’installe dans
`~/Library/Application Support/Cinecrique/Tools`. yt-dlp est distribué sous licence Unlicense ; son
binaire autonome embarque des composants sous leurs propres licences, décrites dans sa publication.
