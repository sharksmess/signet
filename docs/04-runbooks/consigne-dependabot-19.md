# Consigne — PR Dependabot #19 (mineures et correctifs), dont better-auth 1.7.7

Redigee par l'orchestrateur (cowork) le 2026-10-07, accord humain du meme jour (« 2 oui »). Lis `.claude/rules/dependencies.md`, `git.md` et `documentation.md`. Un commit par etape, messages de 72 caracteres au plus, `git --no-pager`, tests au premier plan.

## Etape 0 — Branche
Depuis `main` a jour : `git switch -c chore/dependances-2026-10-07`. Ce fichier, non suivi, te suit.

## Etape 1 — Inventaire
`gh pr view 19 --json title,body,files`. Tableau : paquet, version dans `main` -> proposee, nature, avis de securite eventuel. `next` et `eslint-config-next` sont deja en 16.3.8 dans `main` (PR #21) : rien a faire pour eux. Le registre fait foi (`pnpm view <paquet> version`, `time`).

## Etape 2 — Securite d'abord : better-auth 1.7.7
Identifie l'avis corrige (GHSA). Verifie si Signet utilise le greffon Magic Link : l'orchestrateur n'a trouve aucune occurrence de `magicLink` dans `apps/web/src`, confirme-le. Ecris l'exposition reelle (aucune, ou laquelle) : elle ira dans l'ADR et le registre. La mise a jour se fait quoi qu'il en soit.

## Etape 3 — Application
Toutes les mises a jour de la #19 encore utiles, par les commandes pnpm (epinglage exact, `--filter` selon le paquet), **sans aucune exception a la quarantaine de pnpm**. Si `better-auth` 1.7.7 est encore en quarantaine : arrete-toi et rapporte (decision humaine). Commit : `build: mises a jour mineures (Dependabot #19)`.

## Etape 4 — Preuve
`pnpm install --frozen-lockfile`, `pnpm run check`, `pnpm test`, `pnpm audit --prod --audit-level=high`. Tout doit passer. Un test qui echoue n'est jamais modifie ici : arret et rapport.

## Etape 5 — Documentation (meme PR)
- `docs/02-architecture/ADR/0014-mises-a-jour-2026-10-07.md` (gabarit ADR) : tableau des paquets, avis de better-auth et exposition reelle, chaque paquet **nomme**.
- `docs/DECISIONS.md` : D-051 (claude-code) pour ces mises a jour ; et les decisions humaines que te transmet le message de lancement.
- Journal : `docs/00-context/journal/12-dependances-2026-10-07.md` et sa ligne d'index ; dans l'index, resultat de la ligne 11 : « PR #21 fusionnee (commit 24be181) ».
Commit : `docs: ADR-0014, registre et journal 12`.

## Etape 6 — Livraison
`bash scripts/ship-branch.sh "chore: mises a jour mineures, better-auth 1.7.7 (Dependabot #19)"`, puis arrete-toi. Ne ferme pas la #19 : Dependabot la fermera apres la fusion.

Rapport final court : tableau, exposition better-auth, resultats de l'etape 4, lien de la PR.
