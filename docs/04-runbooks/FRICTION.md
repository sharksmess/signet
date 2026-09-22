# Journal des frictions

Une ligne **des que quelque chose grince**, pas en fin de projet. Une friction
notee trois jours plus tard a perdu son contexte et la solution qu'on avait en
tete sur le moment. C'est la matiere premiere de `/retro`.

Ce qui merite une entree : un hook qui bloque a tort, une skill dont les
instructions sont ambigues, une etape qu'il a fallu faire a la main, un agent
qui a derive, un gabarit incomplet, une decision qu'on a du reprendre.

| Date | Ou | Ce qui s'est passe | Contournement | Se reproduira ? |
|---|---|---|---|---|
| | | | | oui / non / peut-etre |

<!-- Exemple :
| 2026-09-18 | /slice 012 | Le perimetre ne couvrait pas apps/web/lib/auth.ts, l'implementeur s'est bloque | Elargi le scope a la main | oui, /slice doit inclure les fichiers partages touches par une route |
-->
| 2026-09-17 | install-project.ps1 | Copy-Item -Recurse sur un dossier existant imbrique au lieu de remplacer | Suppression puis recopie | oui, corriger install-project.ps1 et update-factory.ps1 |
| 2026-09-22 | install-project.ps1 | gates.ps1 bloque par RemoteSigned : marque 'telecharge' heritee de l'archive | Unblock-File sur usine et projet | oui, install-project.ps1 doit faire Unblock-File |
| 2026-09-22 | /spec | Premier appel a l'outil de questions en erreur, rattrape seul | aucun | peut-etre, surveiller |
| 2026-09-22 | /spec | Les boutons de reponse ne capturent pas les details (quota 50 liens perdu) | amendement du PRD | oui, /spec doit demander les details apres les choix |
| 2026-09-22 | skills | Les skills citent make approve-* au lieu de gates.ps1 sous Windows | aucun | oui, citer les deux |
| 2026-09-22 | block-dangerous.sh | Auto-approbation possible via make/gates.ps1 : le hook bloquait le chemin, pas l'intention | regle approve-* + 2 tests | oui, corrige |
| 2026-09-22 | /architect | 2e erreur d'appel d'outil rattrapee seule | aucun | peut-etre, tendance a surveiller |
| 2026-09-22 | /architect | 9 tranches pour un banc d'essai, une par user story ; SECURITY DEFINER sans exigence de search_path | reponses manuelles | oui, /architect doit regrouper les stories et db-architect doit exiger search_path |
