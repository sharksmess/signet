# Consigne — regrouper les mises a jour Dependabot (#2 a #10)

Redigee par l'orchestrateur (cowork) le 2026-09-30, en application de la decision humaine D-035 (`docs/DECISIONS.md`) : les PR Dependabot ouvertes sont regroupees dans **une seule** branche `chore/`, avec **un ADR**. Lis d'abord `.claude/rules/dependencies.md`, `.claude/rules/git.md` et `.claude/rules/documentation.md`. Un commit par etape, messages de 72 caracteres au plus, `git --no-pager`, tests au premier plan.

## Etape 0 — Branche
Depuis `main` a jour : `git switch -c chore/dependances-2026-09-30`. Ce fichier de consigne, non suivi, te suit.

## Etape 1 — Inventaire
`gh pr list --state open --author app/dependabot --json number,title,headRefName` puis, pour chacune, `gh pr view <n> --json title,body,files`. Dresse le tableau : PR, paquet ou action, version actuelle -> proposee, nature (action GitHub, npm correctif/mineure, npm majeure), et ce que dit le registre aujourd'hui (`pnpm view <paquet> version`, `dist-tags`) — le registre fait foi, pas la PR.

## Etape 2 — Tri (regles de `dependencies.md`)
- **Actions GitHub, correctifs et mineures npm** : appliquees, sauf incompatibilite **reproduite**.
- **Majeures npm** : appliquees seulement si la suite complete, `check` et le build passent sans changer le code applicatif. Une majeure du socle (`next`, `react`, `react-dom`, `better-auth`, `drizzle-orm`, `drizzle-kit`, `pg`, `typescript`, `eslint`, `vitest`) **n'est pas appliquee ici** : elle est decrite dans l'ADR comme reportee, avec la raison, et proposee a l'humain comme tranche ou chantier a part. Rappel du backlog : ESLint 10 est incompatible avec `eslint-config-next` 15 et se reevalue avec Next 16.
- Aucune retrogradation, jamais de version choisie « de memoire ».

## Etape 3 — Application
- Actions : edite `.github/workflows/ci.yml` (versions des `uses:`). Commit : `ci: mettre a jour les actions GitHub`.
- Paquets : **par les commandes pnpm** (`pnpm add -E ...`, `pnpm --filter <paquet> add -E ...`, `-D` pour les devDependencies), pas a la main : aucune tranche n'est active, et le hook refuse l'edition directe de `apps/` et `packages/`. Epinglage exact. Commit : `build: mettre a jour les dependances (Dependabot)`.
- Si une mise a jour casse quelque chose : annule-la (`git restore`/nouvelle commande pnpm vers la version precedente), note-la comme reportee avec l'erreur exacte dans l'ADR.

## Etape 4 — Preuve
`pnpm install --frozen-lockfile`, `pnpm run check`, `pnpm test`, `pnpm run build`, `pnpm audit --prod --audit-level=high`. Tout doit passer.

## Etape 5 — Documentation (meme PR)
- `docs/02-architecture/ADR/0012-mises-a-jour-dependabot-2026-09-30.md` (gabarit `docs/templates/ADR.md`) : tableau complet (PR, de -> vers, applique ou reporte, raison), options, consequences, signal de reexamen. Chaque paquet mis a jour y est **nomme**.
- `docs/DECISIONS.md` : ligne D-039 (decideur : claude-code, en application de D-035), lien vers ADR-0012.
- Journal de projet : entree `docs/00-context/journal/09-dependances-groupees.md` (gabarit `docs/templates/JOURNAL-ENTREE.md`) et sa ligne dans `docs/00-context/JOURNAL.md`. Dans cet index, mets aussi a jour le resultat de la ligne 08 : « Adoption fusionnee (PR #14, commit 09415e2) ».
Commit : `docs: ADR-0012, D-039 et journal 09`.

## Etape 6 — Livraison
`bash scripts/ship-branch.sh "chore: regrouper les mises a jour Dependabot (#2 a #10)"`, puis arrete-toi. **Ne ferme aucune PR Dependabot** : apres la fusion, Dependabot ferme seul celles qui sont devenues inutiles ; les reportees restent ouvertes, c'est a l'humain d'en decider.

Rapport final, court : tableau applique / reporte, resultats de l'etape 4, lien de la PR, ce qui attend une decision humaine.
