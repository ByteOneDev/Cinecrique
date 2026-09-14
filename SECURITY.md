# Politique de sécurité

## Versions prises en charge

| Version | Correctifs de sécurité |
|---------|------------------------|
| 1.1.x   | Oui                    |
| 1.0.x   | Non — mettez à jour vers 1.1.x |

## Signaler une vulnérabilité

Merci de **ne pas ouvrir d’issue publique** pour un problème de sécurité.

Utilisez le signalement privé de GitHub : onglet **Security** du dépôt →
**Report a vulnerability**. Le rapport reste visible uniquement par les
mainteneurs jusqu’à la publication d’un correctif.

Indiquez si possible :

- la version de Cinécrique et celle de macOS ;
- les étapes de reproduction, et un fichier d’exemple si le problème vient d’un
  média, d’un sous-titre ou d’un projet `.cinecrique` ;
- l’impact que vous estimez, et toute limite d’exploitation que vous avez
  constatée.

**Délai de réponse indicatif** : premier accusé de réception sous 7 jours,
évaluation sous 30 jours. Cinécrique est un projet développé sur du temps
personnel : ces délais sont un engagement de bonne foi, pas un contrat de
service.

## Périmètre

Sont dans le périmètre :

- l’application macOS distribuée (`.dmg`, `.zip`) et son pont natif ;
- le traitement des fichiers apportés par l’utilisateur : médias, sous-titres,
  projets `.cinecrique` et fichiers d’état ;
- la chaîne de build et les artefacts publiés.

Sont hors périmètre :

- les vulnérabilités de FFmpeg lui-même — signalez-les à
  [ffmpeg.org](https://ffmpeg.org/security.html) ; nous suivrons la mise à jour ;
- les scénarios supposant qu’un attaquant exécute déjà du code dans la session
  de l’utilisateur ;
- l’absence de bac à sable applicatif, déjà documentée dans
  [`AUDIT-SECURITE.md`](AUDIT-SECURITE.md) (constat S-02).

## État connu

Une revue de sécurité complète du code est publiée dans
[`AUDIT-SECURITE.md`](AUDIT-SECURITE.md). Elle liste les constats ouverts et
ceux déjà corrigés. Les deux limites les plus importantes à connaître avant
d’installer :

1. Les binaires publiés sont signés en ad hoc et **non notarisés** tant qu’un
   certificat Developer ID n’est pas disponible. Vérifiez systématiquement
   l’empreinte SHA-256 fournie avec le DMG.
2. L’application n’est pas confinée par l’App Sandbox : elle dispose des droits
   du compte utilisateur qui la lance.

## Confidentialité

Cinécrique fonctionne hors ligne. Aucun média, aucune note et aucune donnée
d’analyse ne quitte la machine. La seule requête réseau possible est
l’enrichissement TMDB, déclenché explicitement par l’utilisateur, qui ne
transmet qu’un titre et une langue.
