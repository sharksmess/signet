# Consigne — correctif de securite hors tranche : Next.js 16.4.3 → 16.4.5

Redigee par l'orchestrateur (cowork) le 2026-11-24. Chemin : **correctif de securite hors tranche** de `.claude/rules/dependencies.md` (usine 1.6.4). Lis cette regle, `.claude/rules/git.md` et `.claude/rules/documentation.md`. Conventional Commits de 72 caracteres au plus, `git --no-pager`. **Tout au premier plan, aucune sortie coupee** (`tail`, `head`) : sortie complete redirigee dans `.logs/<etape>.log`, puis lue. Tu ne touches pas au code d'`apps/` ni de `packages/` (hors manifestes), ni a `tests/`.

## Contexte
Le second projet (liste-courses, meme version de Next) a ete bloque le 2026-11-19 : `next build` 16.4.3 s'arrete sur `SecurityFatalError` (« Your version of Next.js is affected by a known security vulnerability »). Sept avis **moderes** visent Next.js < 16.4.5 : GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8, GHSA-7qx7-33qx-rqx2, GHSA-f3mh-rxg3-f5g2, GHSA-pc58-hwjq-p385, GHSA-rhh4-g77r-r9qj, GHSA-vvgp-ww4w-46vf. Next.js 16.4.5, publie le 2026-11-03, les corrige tous ; il est hors quarantaine. Le seuil `high` de l'audit de cloture ne les voyait pas (corrige dans l'usine 1.6.7, adoptee juste apres ce correctif).

## Ce que l'humain a deja decide (a inscrire au registre)
- **D-162 (humain, 2026-11-24)** : Next.js passe de 16.4.3 a 16.4.5 par le chemin hors tranche, **avant** l'adoption de l'usine 1.6.7 : sans ce correctif, la construction lancee par le `globalSetup` des tests echoue, donc le pre-push et la CI refusent toute branche. Meme correctif que liste-courses (D-073, D-074 de ce projet, PR #15).

## Etape 1 — Constater
- `git switch main`, `git pull --ff-only`, `git status --short` : arbre propre (cette consigne seule non suivie).
- `pnpm audit --audit-level=moderate > .logs/fix-next-audit-avant.log 2>&1` puis lis-le : releve les avis visant `next`, et **tout autre avis** (paquet, gravite, production ou developpement), sans le traiter.
- Si un avis vise une autre dependance de production au niveau `high` ou `critical`, arrete-toi et rapporte-le.

## Etape 2 — Correctif
- `git switch -c fix/next-16.4.5`.
- Dans `apps/web/package.json`, `next` passe a `16.4.5` ; rien d'autre (ni `eslint-config-next`, ni autre dependance, ni `next upgrade --agent`). `pnpm install`. Verifie dans le lockfile que seuls `next`, `@next/env` et `@next/swc-*` changent ; sinon arrete-toi.
- Si un changement de code devient necessaire, arrete-toi : ce serait une tranche.
- `pnpm test > .logs/fix-next-test.log 2>&1`, puis `pnpm run check > .logs/fix-next-check.log 2>&1`, puis `pnpm audit --prod --audit-level=moderate > .logs/fix-next-audit-apres.log 2>&1` : lis chaque sortie. Attendu : tout vert, plus aucun avis sur `next`. Un passage de tests plus de trois fois plus long que d'habitude se note (poste en veille ?) et se relance une fois.
Commit : `fix(deps): next 16.4.5 (sept avis moderes)`.

## Etape 3 — Documentation
- Registre : D-162 (ci-dessus) et ta decision technique (prochain numero : version, avis, lockfile, options ecartees).
- ADR des versions (celui qui liste `next`) : ligne `next` mise a jour, avec les avis.
- FRICTION : le seuil `high` de l'audit qui ne voyait pas ces avis (corrige par l'usine 1.6.7).
- Backlog : les autres avis releves a l'etape 1, s'il y en a, chacun avec paquet, gravite et chemin, « a traiter apres l'usine 1.6.7 ».
- Journal de projet : pas d'entree a part ; l'entree de l'adoption 1.6.7 le citera.
Commit : `docs: correctif next 16.4.5 (D-162)`, avec cette consigne.

## Etape 4 — Livraison
`bash scripts/ship-branch.sh "fix(deps): next 16.4.5" > .logs/fix-next-ship.log 2>&1`, lis la sortie, et arrete-toi. Rapport court et en clair : les avis, ce qui a change, les tests (nombres), les autres avis trouves, **le lien de la PR**.
