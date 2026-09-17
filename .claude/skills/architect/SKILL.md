---
name: architect
description: Phase 2. Produit le modele de donnees, la strategie multi-tenant, les contrats d'API et les ADR. A lancer une fois le PRD approuve, avant toute ligne de code.
disable-model-invocation: true
---

Phase 2. Aucune ecriture dans `apps/`, `packages/` ou `infra/` n'est possible avant l'approbation de ce gate : le hook `gate-check.sh` la refuse.

## 0. Verifier le prerequis
Si `.gates/01-prd.approved` n'existe pas, arrete-toi et demande l'approbation du PRD.

## 1. Trancher le multi-tenant, d'abord
Avant tout le reste. Presente les options au regard du PRD et recommande :
- `single-user` — pas d'organisation. Le plus simple, mais migrer vers les organisations plus tard est une reecriture du data layer.
- `shared-schema-rls` — une base, une colonne tenant, isolation par politiques RLS. Le defaut raisonnable pour la quasi-totalite des SaaS B2B.
- `schema-per-tenant` — isolation forte, migrations multipliees par le nombre de clients.
- `db-per-tenant` — exige par certains grands comptes, cout operationnel eleve.

Ecris un ADR pour ce choix. Mets a jour `stack.json`.

## 2. Deleguer le modele de donnees
Delegue au sous-agent `db-architect`. Il produit `docs/02-architecture/ERD.md`. Ne modelise pas toi-meme : il a la memoire projet des decisions de schema et de leurs raisons.

## 3. Contrats d'API
Pour chaque user story du PRD, ecris le contrat dans `docs/02-architecture/api-contracts/`. Le format depend du socle (lis `references/stacks/<profile>.md`), mais le contenu ne change pas :
- Route, methode, schema d'entree, schema de sortie.
- Tous les codes d'erreur avec leur declencheur exact.
- Le role minimal requis.
- Idempotence : la route est-elle rejouable sans effet de bord, et sur quelle cle.

Les contrats sont du code, pas de la prose : ecris-les comme des schemas de validation executables, pas comme un tableau markdown. Ils deviennent la source de verite que `contract-guardian` compare a chaque tranche.

## 4. Decoupage en tranches
Produis la liste ordonnee des tranches dans `docs/03-slices/000-backlog.md`. Regles :
- Chaque tranche traverse toutes les couches pour une capacite utilisateur complete.
- Ordonne par dependance technique, puis par risque decroissant : la tranche la plus risquee en premier, quand il reste du temps pour se tromper.
- Une tranche qui ne tient pas en une session est trop grosse : coupe-la.

## 5. ADR obligatoires
Un ADR par decision non triviale : isolation, authentification, strategie de facturation, files d'attente, decoupage des services. Format : contexte, options envisagees, decision, consequences acceptees. La section consequences est celle qui a de la valeur dans un an.

## 6. Cloture
Resume les decisions et arrete-toi. L'approbation est humaine : `make approve-architecture`.
