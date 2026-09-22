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
