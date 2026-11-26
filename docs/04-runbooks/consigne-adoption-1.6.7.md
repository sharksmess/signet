# Consigne — adopter l'usine 1.6.7 (branche `chore/usine-1.6.7`)

Redigee par l'orchestrateur (cowork) le 2026-11-24. Prealable : les PR du correctif Next.js 16.4.5 (D-162, D-163) et des avis transitifs (D-164 a D-166, journal 28) sont fusionnees. L'humain a cree la branche depuis `main` a jour et lance `update-factory.ps1` (tests de l'usine : 201/201 sur le poste). Signet passe de l'usine 1.6.5 a 1.6.7 : il n'a jamais installe la 1.6.6. Lis `.claude/rules/git.md` et `.claude/rules/documentation.md`. Un commit par etape, Conventional Commits de 72 caracteres au plus, `git --no-pager`. Aucune tranche n'est active : tu ne touches ni `apps/`, ni `packages/`, ni `tests/` (hors ce que le script d'installation a copie). **Tout au premier plan, aucune sortie coupee** : sortie complete redirigee dans `.logs/<etape>.log`, puis lue.

## Ce que l'humain a deja decide (a inscrire au registre, prochain numero libre)
- **Adoption (humain, 2026-11-24)** : l'usine 1.6.7 est publiee (depot `saas-factory`, commit `65b45b7`, tag `v1.6.7`) et adoptee, 1.6.6 comprise. Elles viennent du second projet (liste-courses), cote usine D-037 a D-051 :
  - **1.6.6** : premier commit d'un depot neuf ; depot de cadrage reconnu (`scripts/app-present.sh`) ; `block-dangerous` qui distingue mention et lecture de `.env` ; recherches jugees sur les fichiers de secrets reellement presents, `*.local.ps1` protege comme `.env` (hooks et `settings.json`) ; `git add` d'une approbation deja posee par l'humain admis ; perimetre limite a `apps/`, `packages/`, `tests/` ; `slice-implementer` ne modifie aucun test ; `next-env.d.ts` non versionne (deja le cas ici) ; `allowBuilds` de pnpm 12 documente.
  - **1.6.7** : sorties completes conservees (`close-slice.sh` dans `.logs/close-slice-NNN/`, regle « aucune sortie coupee ») ; audit de production au seuil `moderate` a la cloture et en CI ; `ci-build.sh typegen` ; motif de recherche jamais pris pour une lecture ou une destruction ; ecriture admise dans le dossier temporaire de session ; PR ouverte mise a jour par son script de livraison ; poste sans mise en veille en mode autonome.
- **CI (humain, 2026-11-24)** : l'installeur ne remplace pas un `ci.yml` existant. Dans `.github/workflows/ci.yml`, l'etape « Audit des dependances de production » passe a `pnpm audit --prod --audit-level=moderate`, comme la cloture. Rien d'autre ne change dans ce fichier.

## Etape 1 — Installation
`.claude/FACTORY_VERSION` doit contenir `1.6.7` ; sinon arrete-toi. Verifie qu'un garde-fou mord : une tentative d'ecrire dans `.gates/` avec l'outil Write doit etre refusee (constate seulement le refus). Committe les fichiers de l'usine que montre `git status --short` (attendus : `.claude/`, `.githooks/`, `.gitignore`, `scripts/`), sans cette consigne : `chore: installer l'usine 1.6.7`. Signale tout fichier inattendu, en particulier hors de ces dossiers.

## Etape 2 — CI
La modification de `ci.yml` ci-dessus. Commit : `ci: audit de production au seuil modere`.

## Etape 3 — Preuve : la suite complete
`mkdir -p .logs`, puis `pnpm test > .logs/usine-1.6.7-test.log 2>&1`, `pnpm run check > .logs/usine-1.6.7-check.log 2>&1` et `pnpm audit --prod --audit-level=moderate > .logs/usine-1.6.7-audit.log 2>&1`, au premier plan : lis chaque sortie. Attendu : tout vert (981 reussis, 1 ignore, comme apres les correctifs), audit propre hors des deux avis ecartes par D-165 (`auditConfig.ignoreGhsas`).
- Si l'audit signale un avis **modere** en production : arrete-toi et rapporte-le (paquet, avis, chemin). Il se traitera par le chemin hors tranche ou par une decision ecrite (`auditConfig.ignoreGhsas`, `rules/dependencies.md`), decision humaine.
- Si le `globalSetup` refuse de demarrer a cause d'un fichier d'environnement dans `apps/web/` : arrete-toi et donne le **nom** du fichier, jamais son contenu.
- Si un test echoue : arrete-toi avec le nom du test et le message complet ; ne modifie aucun test.

## Etape 4 — Documentation
- Registre : les deux decisions ci-dessus.
- Journal de projet : entree 29 `docs/00-context/journal/29-usine-1.6.7.md` (gabarit `docs/templates/JOURNAL-ENTREE.md`) et sa ligne d'index. Contenu : les deux correctifs qui l'ont precedee (Next.js, D-162 et D-163 ; avis transitifs, D-164 a D-166), ce que 1.6.6 et 1.6.7 apportent, les preuves (usine 201/201 ; suite de l'etape 3), ce qui reste.
- Backlog : rien de nouveau, sauf ce que l'etape 3 ferait apparaitre. Le point « source de l'adresse IP du limiteur de connexions » reste ouvert : il sera verifie juste apres cette adoption.
- FRICTION : rien a ajouter sauf incident pendant cette adoption.
Commit : `docs: adoption de l'usine 1.6.7`, avec cette consigne.

## Etape 5 — Livraison
`bash scripts/ship-branch.sh "chore: adopter l'usine 1.6.7" > .logs/usine-1.6.7-ship.log 2>&1`, lis la sortie, et arrete-toi. Rapport court et en clair : resultat de la suite, fichiers installes, tout ecart, **le lien de la PR**.
