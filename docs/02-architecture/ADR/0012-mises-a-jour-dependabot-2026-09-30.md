# ADR-0012 — Mises a jour Dependabot du 2026-09-30 : regroupees, majeures du socle reportees

- **Statut** : accepte (2026-09-30, claude-code en application de la decision humaine D-035 ; aucune version du socle n'est changee de ligne majeure — contestable par l'humain a la revue de la PR) ; ligne `@types/node` amendee par la decision humaine D-040
- **Date** : 2026-09-30
- **Phase** : entretien hors tranche (branche `chore/dependances-2026-09-30`)
- **Realise** : D-035 (regroupement des PR Dependabot #2 a #10 dans une seule branche `chore/`, avec un ADR). Consigne : `docs/04-runbooks/consigne-dependances-2026-09-30.md`.

## Contexte

Neuf PR Dependabot (#2 a #10) attendaient depuis l'ouverture du depot. L'humain a choisi de les regrouper dans une seule branche plutot que de les fusionner une a une ou de les fermer (D-035). Entre la decision et son execution, l'adoption de l'usine 1.4.1 (PR #14) a passe Dependabot en mode groupe :

- #3, #4 et #5 (actions `checkout`, `setup-node`, `pnpm/action-setup`) ont ete fermees par Dependabot et remplacees par la PR groupee **#15** ;
- #2 (`gitleaks/gitleaks-action` 2 -> 3) a ete fermee par Dependabot le 2026-09-29 : la CI etait deja en `@v3`.

Le perimetre reel est donc : #15 (successeur de #3 a #5), #6, #7, #8, #9, #10.

Trois regles encadrent le tri (`.claude/rules/dependencies.md`) : le registre fait foi, pas la PR ; une majeure du socle (`stack.json`) ne se change pas dans une branche d'entretien ; aucune retrogradation sans incompatibilite reproduite.

Une contrainte est apparue a l'execution : **pnpm 12 applique par defaut un delai de quarantaine** (`minimumReleaseAge`) aux versions tout juste publiees. Pour `pg@8.23.1`, `vitest@5.0.3`, `dotenv@18.0.5` et `eslint-config-next@16.3.8`, publiees le jour meme, `pnpm add` a ajoute de lui-meme des exclusions `minimumReleaseAgeExclude` dans `pnpm-workspace.yaml`.

## Options envisagees

### Option A — Tout appliquer, y compris les majeures du socle
Fermerait toutes les PR d'un coup. Mais Next 16 est un changement de ligne majeure du socle gele (ADR-0008 : migration a rouvrir par un ADR dedie et `/architect`) ; il n'a rien a faire dans une branche d'entretien.

### Option B — Appliquer correctifs, mineures et majeures hors socle qui passent sans toucher au code ; reporter le reste
Ce que prescrit la consigne. Chaque majeure est essayee, et reportee seulement sur echec reproduit.

### Option C — Prendre la derniere version du registre, en contournant la quarantaine pnpm
Suivrait la lettre « derniere version `latest` », mais desactiverait, paquet par paquet et sans decision, un garde-fou de chaine d'approvisionnement (une version compromise est generalement retiree dans les heures qui suivent sa publication).

## Decision

Option B, avec une precision sur la quarantaine : **on prend la derniere version du registre qui a passe le delai de quarantaine de pnpm**, et on n'ajoute aucune exclusion. Pour les paquets concernes, cela revient a la version proposee par Dependabot (`pg@8.23.0`, `vitest@5.0.2`, `dotenv@18.0.4`), toutes publiees depuis plus d'un jour. `pnpm-workspace.yaml` n'est pas modifie.

| PR | Paquet ou action | Nature | Actuel -> propose (PR) | Registre du jour (`latest`) | Resultat | Raison |
|---|---|---|---|---|---|---|
| #15 (remplace #3) | `actions/checkout` | action GitHub | v5 -> v7 | v7.0.1 | **applique** `@v7` | Rupture v7 limitee a `pull_request_target`/`workflow_run`, triggers absents de `ci.yml` |
| #15 (remplace #5) | `pnpm/action-setup` | action GitHub | v5 -> v6 | v6.1.0 | **applique** `@v6` | Version de pnpm toujours lue dans `packageManager` |
| #15 (remplace #4) | `actions/setup-node` | action GitHub | v5 -> v7 | v7.0.0 | **applique** `@v7` | Passage ESM interne, entrees inchangees |
| #2 | `gitleaks/gitleaks-action` | action GitHub | v2 -> v3 | v3.0.0 | deja en place | CI deja en `@v3` ; PR fermee par Dependabot |
| #6 | `pg` (racine, `web`, `db`) | npm mineure | 8.13.1 -> 8.23.0 | 8.23.1 (quarantaine) | **applique** 8.23.0 | 8.23.1 publiee le jour meme |
| #6 | `@types/pg` (racine, `web`, `db`) | npm mineure | 8.11.10 -> 8.23.1 | 8.23.1 | **applique** 8.23.1 | |
| #6 | `vitest` | npm correctif | 5.0.1 -> 5.0.2 | 5.0.3 (quarantaine) | **applique** 5.0.2 | 5.0.3 publiee le jour meme |
| #6 | `better-auth` | npm correctif | 1.7.5 -> 1.7.6 | 1.7.6 | **applique** 1.7.6 | |
| #6 | `react`, `react-dom` | npm mineure | 19.0.0 -> 19.3.0 | 19.3.0 | **applique** 19.3.0 | Pair `^19.0.0` de `next@15.5.26` respecte |
| #6 | `@types/react`, `@types/react-dom` | npm mineure | 19.0.2 -> 19.3.0 | 19.3.0 | **applique** 19.3.0 | |
| #10 | `@types/node` (racine, `web`, `db`) | npm majeure hors socle | 22.19.21 -> 26.6.2 | 26.6.3 | **applique** 24.19.0 (D-040) | Aligne sur le runtime Node 24 (`.nvmrc`), derniere version de la ligne 24. La 26.6.3, appliquee d'abord, passait `check`, tests et build mais typait une API absente du runtime |
| #8 | `dotenv` (racine, `db`) | npm majeure hors socle | 16.4.7 -> 18.0.4 | 18.0.5 (quarantaine) | **applique** 18.0.4 | Seul usage : `import "dotenv/config"` (drizzle, migration) ; 18.0.5 publiee le jour meme |
| #7 | `eslint-config-next` | npm majeure | 15.5.26 -> 16.3.6 | 16.3.8 (quarantaine) | **reporte** | Essai en 16.3.7 : `pnpm lint` echoue, erreur ci-dessous |
| #9 | `next` | npm majeure **du socle** | 15.5.26 -> 16.3.6 | 16.3.8 | **reporte** | Majeure du socle : hors d'une branche d'entretien (ADR-0008) |

Erreur reproduite pour `eslint-config-next@16.3.7` avec ESLint 9.39.5 et la configuration actuelle (`FlatCompat` de `@eslint/eslintrc`, ADR-0009) :

```
TypeError: Converting circular structure to JSON
    --> starting at object with constructor 'Object'
    |     property 'configs' -> object with constructor 'Object'
    |     property 'flat' -> object with constructor 'Object'
    |     ...
    |     property 'plugins' -> object with constructor 'Object'
    --- property 'react' closes the circle
    at ConfigValidator.formatErrors (@eslint/eslintrc/lib/shared/config-validator.js:299:23)
```

La 16 publie une configuration plate native que `FlatCompat` ne sait plus charger : l'adopter impose de reecrire `eslint.config.mjs` et de retirer `@eslint/eslintrc`, exactement le chantier que le signal de reexamen d'ADR-0009 rattache a la montee de Next 16. Elle a ete annulee (retour a 15.5.26, lockfile regenere depuis celui de `main` pour ne garder aucun residu).

`next` 16 n'apporte pas de correctif de securite manquant a la ligne 15 : `next@15.5.26` a ete publiee le 2026-09-22, le meme jour que la 16.3.6 et ses correctifs, et `pnpm audit --prod --audit-level=high` ne signale rien. La regle « un correctif de securite prime dans les 48 h » ne s'applique donc pas.

### Preuves (etape 4 de la consigne)

| Commande | Resultat |
|---|---|
| `pnpm install --frozen-lockfile` | OK |
| `pnpm run check` | OK (typecheck des trois projets, lint) |
| `pnpm test` | 10 fichiers, 92 tests, tous verts |
| `pnpm run build` | OK avec les variables factices de `ci.yml` ; sans elles, echoue sur `DATABASE_URL_AUTH n'est pas definie` : `auth.ts` lit ces variables au chargement, comme le documente `ci.yml`, sans lien avec les versions |
| `pnpm audit --prod --audit-level=high` | Aucune vulnerabilite connue |

## Consequences acceptees

- **Les PR #7 et #9 restent ouvertes** : elles attendent une decision humaine sur la migration Next 16. La ligne Next 15 arrive en fin de maintenance en **octobre 2026** (ADR-0008), c'est-a-dire maintenant. Au-dela, un correctif de securite pourrait ne plus etre publie en 15.5.x.
- **`@types/node` suit la ligne majeure du Node reellement utilise, pas `latest`** (decision humaine D-040). La 26.6.3, appliquee d'abord selon la regle « majeure hors socle qui passe », typait des API de Node 25 et 26 absentes a l'execution sous Node 24 (`.nvmrc`), sans que `check` puisse le detecter. Options presentees a l'humain : garder 26.6.3 (regle generale) ou passer a 24.19.0 (derniere version de la ligne du runtime). Retenue : 24.19.0, pour que le typage decrive ce qui s'execute. `check` et tests (92/92) verts en 24.19.0. Consequence : Dependabot proposera encore `@types/node` 25 et 26 ; ces PR sont a refuser tant que le runtime reste en Node 24.
- Les versions retenues pour `pg`, `vitest` et `dotenv` sont d'un correctif en retard sur `latest` : Dependabot les proposera a nouveau au prochain passage, une fois la quarantaine ecoulee.
- Aucun paquet n'a ete ajoute ni retire ; `pnpm-workspace.yaml` (overrides, `allowBuilds`) est inchange.

## Signal de reexamen

- Decision humaine sur la migration Next 16 (ADR dedie, `/architect`) : y reprendre `eslint-config-next` 16, la reecriture de `eslint.config.mjs` et ESLint 10 (ADR-0009, backlog).
- Un avis de securite sur `next` 15.5.x sans correctif publie sur la ligne 15 : la migration devient urgente (regle des 48 h).
- Changement de version de Node dans `.nvmrc` : `@types/node` passe a la meme ligne majeure (D-040).
- Un paquet ou une action dont la version `latest` reste en quarantaine au moment d'une mise a jour : meme regle, pas d'exclusion sans decision.
