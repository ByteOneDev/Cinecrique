# Composants tiers

## FFmpeg

Cinécrique utilise les exécutables `ffmpeg` et `ffprobe` du projet FFmpeg pour inspecter les médias et créer des proxies de lecture locaux.

- Version distribuée : FFmpeg 8.1.2
- Licence : GNU Lesser General Public License, version 2.1 ou ultérieure
- Projet : https://ffmpeg.org/
- Source : `ffmpeg-8.1.2-source.tar.xz`, jointe aux releases de Cinécrique
- Configuration : produite dans `Contents/Resources/Tools/BUILD-CONFIG.txt`

La compilation distribuée par Cinécrique n’active ni `--enable-gpl` ni `--enable-nonfree`. Les fichiers `COPYING.LGPLv2.1`, `LICENSE.md`, la configuration et le SHA-256 de la source sont inclus dans l’application.
