#!/bin/bash
# Nettoyage post-rangement pour Cinécrique.
# À lancer depuis la racine du dépôt : cd ~/Desktop/Cinécrique && bash cleanup.sh
#
# Supprime les anciens emplacements maintenant remplacés par :
#   source/web, source/macos, test/web, test/fixtures, checks/, resources/macos, scripts/, design/
# Ne touche à rien d'autre (dist/, web-dist/, output/, .build/, node_modules/, public/ restent inchangés).

set -euo pipefail

rm -rf src
rm -rf macOS
rm -rf Tests
rm -rf script
rm -rf test-fixtures
rm -f design-comparison-editor.png design-comparison-viewer.png design-comparison.png \
      design-qa.md design-reference-1440.png design-reference.png image-prompts.md \
      prototype-compact.png prototype-desktop-final.png prototype-desktop.png prototype-final.png

echo "Nettoyage terminé."
echo
echo "Vérifications à lancer ensuite :"
echo "  npm test"
echo "  npm run macos:verify"
echo "  git status"
