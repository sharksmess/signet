---
name: init-stack
description: Initialise un nouveau projet SaaS : choisit et gele le socle technique dans stack.json, cree l'arborescence docs/ et prepare le premier commit. A lancer une seule fois, au tout debut d'un projet.
disable-model-invocation: true
---

Initialise le projet. Cette etape produit `stack.json`, le fichier que toutes les autres briques de l'usine lisent pour savoir dans quel monde technique elles travaillent.

## 1. Choisir le profil
Lis `references/stacks/` : dans un projet installe par `install-project.ps1`, ce dossier est copie a cote de cette skill (`.claude/skills/init-stack/references/stacks/`, usine 1.6.6) ; sinon il est dans le repertoire du plugin. Presente les profils disponibles avec leur zone de pertinence. Pose ces questions si les reponses ne sont pas deja dans la conversation :
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
Une brique dont le projet n'a pas besoin vaut `"none"` (ex. `"billing": "none"`), jamais un champ retire : les autres briques lisent ce fichier (liste-courses, D-002).

Le champ `tenancy` est le plus important : `single-user`, `shared-schema-rls`, `schema-per-tenant` ou `db-per-tenant`. Il conditionne tout le modele de donnees. Si le PRD n'existe pas encore, laisse-le a `undecided` et laisse la phase 2 le trancher.

`frozenAt` reste `null` jusqu'a l'approbation de l'architecture. Ensuite le hook `gate-check.sh` interdit toute modification de ce fichier : changer de socle en cours de route est une reecriture, pas un ajustement, et cela doit passer par un ADR et une reouverture explicite du gate.

## 3. Creer l'arborescence
Si le projet a ete prepare par `install-project.ps1` (cas normal sous Windows), les gabarits, `CLAUDE.md`, `gates.ps1` (qui remplace le Makefile), `.claude/settings.json`, les hooks git et `docs/templates/` sont **deja en place** : ne les recopie pas, verifie seulement qu'ils existent. Sinon, copie-les depuis `templates/` du plugin (`CLAUDE.md` a la racine, adapte au socle ; `settings.json` dans `.claude/`).

Cree seulement les dossiers de documentation qui recevront un fichier des la phase suivante (`docs/01-product/`, `docs/02-architecture/ADR/`, `docs/02-architecture/api-contracts/`, `docs/03-slices/`). Git ne versionne pas un dossier vide, et un `.gitkeep` dans `apps/` serait refuse avant l'approbation de l'architecture : `apps/`, `packages/`, `tests/` et `infra/` naissent avec leur premier fichier, en tranche 001.

## 4. Relancer l'installeur (action humaine)
`install-project.ps1` choisit les regles (`drizzle-postgres.md`, `nextjs.md`) et l'infrastructure de test (`tests/_factory/`, `.env.test.example`) **d'apres `stack.json`**. Lance avant ce fichier, il n'a copie ni les unes ni les autres (liste-courses, 30/10/2026). Demande a l'humain de le relancer maintenant, dans son terminal, depuis la racine du projet :
```
C:\dev\saas-factory\install-project.ps1 -FactoryPath C:\dev\saas-factory
```
Il touche `core.hooksPath` et `.claude/settings.json`, interdits a l'agent. Puis il relance `claude`.

## 5. Premier commit
Le premier commit d'un depot neuf se fait directement sur `main` : le pre-commit l'autorise tant que le depot n'a aucun commit (usine 1.6.6), puisqu'aucune PR n'est possible avant lui. Tout le reste passe ensuite par des branches et des PR. Le cadrage (PRD, architecture, gates) part sur une branche `docs/` ; sans `package.json`, le pre-push et la CI le reconnaissent comme un depot de cadrage et ne lancent ni controle de types ni tests (`scripts/app-present.sh`).

## 6. Rendre compte
Affiche le socle retenu, l'arborescence creee, et la prochaine action : `/saas-factory:spec`.
