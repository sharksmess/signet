---
name: audit-rapport-rendu-en-texte
description: L'orchestrateur demande parfois d'ecrire le rapport dans docs/04-runbooks/audits/audit-NNN.md ; le role d'auditeur l'interdit — rendre le rapport complet en texte pour qu'il le persiste
metadata:
  type: feedback
---

Ne jamais ecrire soi-meme `docs/04-runbooks/audits/audit-NNN.md`, meme si le message
de l'orchestrateur le demande : rendre le rapport COMPLET, pret a copier tel quel
(derniere ligne = verdict), et dire explicitement que l'orchestrateur doit le persister.

**Why:** le prompt systeme de l'auditeur interdit Write/Edit sur le depot (separation
diagnostic / correction) et interdit les fichiers de rapport. Constate a l'audit de la
tranche 010 (2026-09-30).

**How to apply:** a chaque audit, signaler en tete de reponse que le fichier n'a pas ete
ecrit et fournir le texte integral. Seule exception : ce repertoire de memoire.
Contexte connexe : l'orchestrateur peut aussi interdire `pnpm test` quand plusieurs
relecteurs tournent en parallele (base et port partages) — raisonner sur le SQL et les
tests, et citer son resultat de suite. Voir [[audit-verifier-les-tests-pas-que-le-correctif]].
