# ADR-0001 — Isolation multi-tenant : shared-schema-rls

- **Statut** : accepte
- **Date** : 2026-09-22
- **Phase** : 2 — architecture

## Contexte

Le PRD (`docs/01-product/PRD.md`) definit une unite de compte "organisation" avec plusieurs membres (owner, member). US-09 exige une isolation stricte : aucune requete ne doit pouvoir exposer les donnees d'une organisation a un utilisateur qui n'en fait pas partie, y compris via un identifiant devine ou forge (404, jamais les donnees). C'est le risque #2 explicitement nomme dans le PRD.

Dans le meme temps, le PRD qualifie ce produit de "banc d'essai jetable" : charge negligeable, quelques organisations au maximum, aucune exigence de conformite (pas de client grand compte exigeant une base dediee), pas de SLA.

Il faut choisir la strategie d'isolation avant de modeliser la moindre table, car elle determine la forme du schema entier.

## Options envisagees

### Option A — `single-user`
Pas de notion d'organisation : chaque compte est son propre tenant.
Ecarte immediatement : le PRD definit explicitement des organisations multi-membres avec des roles distincts (owner/member) et une facturation par organisation. Ce n'est pas une extension future, c'est le modele du jour 1.

### Option B — `shared-schema-rls`
Une base, une colonne `organization_id` sur chaque table portant de la donnee client, isolation appliquee par des politiques RLS Postgres en plus du filtre applicatif. La connexion applicative est non privilegiee ; le tenant courant est pose par `SET LOCAL` au debut de chaque transaction.
Cout : une politique RLS par table, une migration SQL ecrite a la main (Drizzle ne les genere pas). Benefice : l'isolation survit a un oubli de filtre applicatif — exactement le risque #2 du PRD. C'est le defaut du profil `nextjs-drizzle-postgres`.

### Option C — `schema-per-tenant`
Un schema Postgres par organisation. Isolation forte, mais les migrations se multiplient par le nombre de clients et le provisioning d'une organisation devient une operation DDL. Sans objet pour "quelques organisations au maximum" avec une charge negligeable — le cout operationnel n'a aucune contrepartie ici.

### Option D — `db-per-tenant`
Une base par organisation. Exige par des grands comptes avec des contraintes de conformite fortes (residence des donnees par client, contrats specifiques). Aucune de ces contraintes n'existe dans le PRD. Cout operationnel disproportionne pour un banc d'essai.

## Decision

`shared-schema-rls`. Le critere qui tranche : US-09 exige une defense qui survit a l'erreur humaine ("pas d'exception interne, pas d'exception 'c'est un job'" — regle absolue de `CLAUDE.md`), ce que seul du RLS applique au niveau base apporte par rapport a un filtre uniquement applicatif. Les options C et D ajoutent un cout operationnel que rien dans le PRD ne justifie (charge negligeable, pas de contrainte reglementaire, pas de grand compte).

Cette decision est deja refletee dans `stack.json` (`"tenancy": "shared-schema-rls"`), fixee au moment du socle (phase 1). Cet ADR la formalise et l'engage pour la phase 2.

## Consequences acceptees

- Chaque table portant de la donnee client (organisations, collections, liens, invitations, abonnements) doit reference `organization_id` directement, jamais via une jointure transitive — sinon la politique RLS correspondante serait injustifiable et probablement desactivee "pour debugger" un jour.
- Les politiques RLS vivent dans des migrations SQL ecrites a la main, versionnees, et ne sont jamais generees par `drizzle-kit generate`. Toute nouvelle table portant de la donnee client doit s'accompagner de sa politique RLS dans la meme tranche.
- La connexion applicative doit rester non privilegiee (pas de role `BYPASSRLS`). Un contexte tenant doit etre pose par `SET LOCAL` a chaque transaction — un oubli fait echouer les requetes (RLS ferme par defaut) plutot que fuiter des donnees.
- Migrer vers `schema-per-tenant` ou `db-per-tenant` plus tard resterait possible sans reecriture complete du modele de donnees (la colonne `organization_id` existe deja partout), mais impliquerait de reecrire la couche d'acces aux donnees et le provisioning.
- Les Server Actions Next.js sont des endpoints publics au meme titre que les routes : elles doivent poser le meme contexte tenant, pas seulement les Route Handlers.

## Signal de reexamen

Un client exige une base dediee pour des raisons contractuelles ou reglementaires ; ou la charge d'une organisation menace l'isolation de performance des autres (bruit multi-tenant sur une base partagee). Aucun des deux n'est attendu au vu des contraintes non fonctionnelles du PRD.
