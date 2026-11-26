# 29 — Usine 1.6.7 (1.6.6 comprise) : sorties completes, audit au seuil modere

- **Dates** : 2026-11-24 → 2026-11-26
- **Objectif** : adopter les ameliorations de l'usine issues du second projet (liste-courses), en passant directement de 1.6.5 a 1.6.7.

## Ce qui a ete fait
- **Deux correctifs prealables**, fusionnes avant l'adoption, sans quoi l'audit au seuil modere de 1.6.7 aurait refuse toute cloture :
  - Next.js 16.4.3 -> 16.4.5, avec `eslint-config-next` (D-162, D-163, PR #49) : sept avis moderes corriges, et la construction ne tombe plus en `SecurityFatalError`.
  - Avis transitifs (D-164 a D-166, PR #51) : copie `next@16.3.8` sous `@inngest/test` remplacee par 16.4.5 (`overrides` `inngest>next`) ; `glob` et `minimatch` ecartes par `auditConfig.ignoreGhsas` (jamais charges en production), reexamen au backlog.
- **Installation** par l'humain (`update-factory.ps1`), committee : `chore: installer l'usine 1.6.7` (commit 5854492). Fichiers : `.claude/` (agents, regles `dependencies`, `git`, `nextjs`, `settings.json`, skills `implement`, `init-stack` et ses references de socles, `run-queue`, `slice`), `.githooks/pre-commit` et `pre-push`, `.gitignore`, `scripts/` (`app-present.sh` nouveau, `ci-build.sh`, `close-slice.sh`, `env-check.ps1`). Aucun fichier inattendu.
- **Garde-fou constate** : une ecriture dans `.gates/` par l'outil Write est refusee (`gate-check` : « fichier .gates/ non prevu »).
- **CI** : etape « Audit des dependances de production » au seuil `moderate` (D-168, commit 2a16498).

### Ce que 1.6.6 apporte
Premier commit d'un depot neuf ; depot de cadrage reconnu (`scripts/app-present.sh`) ; `block-dangerous` distingue mention et lecture de `.env` ; recherches jugees sur les fichiers de secrets reellement presents, `*.local.ps1` protege comme `.env` ; `git add` d'une approbation deja posee par l'humain admis ; perimetre limite a `apps/`, `packages/`, `tests/` ; `slice-implementer` ne modifie aucun test ; `allowBuilds` de pnpm 12 documente.

### Ce que 1.6.7 apporte
Sorties completes conservees (`.logs/`, `close-slice.sh` dans `.logs/close-slice-NNN/`, regle « aucune sortie coupee ») ; audit de production au seuil `moderate` a la cloture et en CI ; `ci-build.sh typegen` ; motif de recherche jamais pris pour une lecture ou une destruction ; ecriture admise dans le dossier temporaire de session ; PR deja ouverte mise a jour par son script de livraison ; poste sans mise en veille en mode autonome.

## Decisions
- D-167 : adoption de l'usine 1.6.7, 1.6.6 comprise (humain).
- D-168 : audit de production de la CI au seuil `moderate` (humain).
Le detail est dans `docs/DECISIONS.md`.

## Preuves
- Usine : 201/201 tests sur le poste (lances par l'humain avec `update-factory.ps1`).
- `pnpm test` : 75 fichiers, 981 verts, 1 ignore, 270 s (`.logs/usine-1.6.7-test.log`, local).
- `pnpm run check` : vert (`.logs/usine-1.6.7-check.log`).
- `pnpm audit --prod --audit-level=moderate` : sortie 0, « 2 moderate (2 ignored) », les deux avis ecartes par D-165 (`.logs/usine-1.6.7-audit.log`).

## Incidents
Aucun.

## Etat a la fin
Signet sur l'usine 1.6.7, suite verte, aucune tranche active ; PR `chore: adopter l'usine 1.6.7` ouverte, en attente de fusion par l'humain.

## Etape suivante
Verifier la source de l'adresse IP du limiteur de connexions (point du backlog, reste ouvert).
