---
name: init-stack
description: Initialise un nouveau projet SaaS : choisit et gele le socle technique dans stack.json, cree l'arborescence docs/, les gates et le Makefile. A lancer une seule fois, au tout debut d'un projet.
disable-model-invocation: true
---

Initialise le projet. Cette etape produit `stack.json`, le fichier que toutes les autres briques de l'usine lisent pour savoir dans quel monde technique elles travaillent.

## 1. Choisir le profil
Lis `references/stacks/` (dans le repertoire du plugin) et presente les profils disponibles avec leur zone de pertinence. Pose ces questions si les reponses ne sont pas deja dans la conversation :
- Fullstack unifie ou frontend et backend separes ?
- Langage impose par l'equipe ou libre ?
- Charge attendue et contraintes de latence.
- Contraintes reglementaires (hebergement, residence des donnees).

Recommande un profil et explique en deux phrases ce que le choix coute et rapporte. Puis attends la decision.

## 2. Ecrire stack.json
```json
{
  "profile": "nextjs-drizzle-postgres",
  "language": "typescript",
  "runtime": "node",
  "framework": "next",
  "orm": "drizzle",
  "database": "postgres",
  "auth": "better-auth",
  "billing": "stripe",
  "queue": "inngest",
  "test": { "unit": "vitest", "e2e": "playwright" },
  "packageManager": "pnpm",
  "tenancy": "shared-schema-rls",
  "frozenAt": null
}
```
Le champ `tenancy` est le plus important : `single-user`, `shared-schema-rls`, `schema-per-tenant` ou `db-per-tenant`. Il conditionne tout le modele de donnees. Si le PRD n'existe pas encore, laisse-le a `undecided` et laisse la phase 2 le trancher.

`frozenAt` reste `null` jusqu'a l'approbation de l'architecture. Ensuite le hook `gate-check.sh` interdit toute modification de ce fichier : changer de socle en cours de route est une reecriture, pas un ajustement, et cela doit passer par un ADR et une reouverture explicite du gate.

## 3. Creer l'arborescence
```
docs/00-context/  docs/01-product/  docs/02-architecture/ADR/
docs/02-architecture/api-contracts/  docs/03-slices/  docs/04-runbooks/
.gates/  apps/  packages/  tests/  infra/
```
Copie les gabarits depuis `templates/` du plugin. Copie `templates/CLAUDE.md` a la racine et adapte les commandes au socle choisi. Copie `templates/Makefile` (il porte les cibles `approve-*` reservees a l'humain) et `templates/settings.json` dans `.claude/`.

## 4. Rendre compte
Affiche le socle retenu, l'arborescence creee, et la prochaine action : `/saas-factory:spec`.
