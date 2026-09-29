# Conventions du projet

<!-- Reste sous 200 lignes. Au-dela, le modele suit moins bien, pas mieux.
     Le detail va dans .claude/rules/ (portee par chemin) ou en skills. -->

## Socle
Le socle technique est declare dans `stack.json`. Lis-le avant toute decision technique. Il est gele depuis l'approbation de l'architecture.

## Commandes
- Install : `pnpm i` — jamais npm ni yarn
- Dev : `pnpm dev` | Tests : `pnpm test` | Types : `pnpm typecheck`
- Migration : `pnpm db:generate` puis `pnpm db:migrate` — jamais de SQL manuel

## Regles absolues
- **Une tranche a la fois.** La tranche active est dans `.gates/current-slice`, son perimetre de fichiers dans `.gates/scope-<id>.txt`. Ecrire hors de ce perimetre est refuse par un hook.
- **Ne jamais modifier une migration deja appliquee.** Toujours en creer une nouvelle.
- **Toute entree externe passe par un schema de validation** avant usage : body, query, params, headers, webhooks, variables d'environnement.
- **Toute requete filtre explicitement sur le tenant.** Pas d'exception "interne", pas d'exception "c'est un job".
- Les secrets ne sont jamais en dur, jamais logges, jamais dans un message d'erreur renvoye au client.
- Les erreurs metier attendues sont des valeurs de retour typees. `throw` est reserve aux invariants qui ne devraient jamais arriver.
- Aucune dependance nouvelle sans ADR.
- **Tout est documente dans le depot** (`.claude/rules/documentation.md`) : chaque decision a sa ligne dans `docs/DECISIONS.md`, les choix structurants leur ADR, dans la meme PR que le changement.

## Interdits
- Pas de `any`, pas de suppression de verification de type
- Pas de `// TODO` dans du code committe : soit c'est fait, soit c'est une tranche dans le backlog
- Pas d'auto-approbation de gate : `.\gates.ps1 approve-*` appartient a l'humain
- Jamais lire ni afficher `.env*.local`, `*.local.ps1` ou l'environnement : les processus chargent eux-memes les secrets

## Workflow
1. Lire la tranche active dans `docs/03-slices/` et son journal `NNN-progress.md`
2. Ecrire les tests depuis les criteres d'acceptation, AVANT l'implementation
3. Implementer couche par couche ; **commit + journal apres chaque couche verte** (`rules/git.md`)
4. Lancer soi-meme `pnpm test` : le globalSetup prepare base de test et serveur
5. Trois relecteurs independants (`security-auditor`, `contract-guardian`, `code-reviewer`), registre des decisions, puis `bash scripts/close-slice.sh` (fiche de preuves), puis `bash scripts/ship-slice.sh`, puis s'arreter : l'humain fusionne sur preuves

## Comportement attendu
Si une decision metier manque, arrete-toi et demande. Ne comble jamais un trou de specification par une hypothese silencieuse : une hypothese inventee et propagee sur plusieurs tranches coute une reecriture, une question coute cinq minutes.

Si tu es bloque deux fois de suite sur le meme probleme, arrete-toi et remonte la cause, ce que tu as essaye, et les options.
