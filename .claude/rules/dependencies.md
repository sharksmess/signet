---
paths: ["**/package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".nvmrc", ".github/workflows/**"]
---

# Dependances et versions

Ta connaissance des versions s'arrete a une date que tu ne connais pas. Le registre, lui, est a jour. Une version qui te parait « trop recente » est presque toujours simplement posterieure a ta formation : la retrograder a deja introduit une faille connue dans ce projet (Next 15.1.4).

## Choisir une version
1. Source unique : le registre, interroge a l'instant. `pnpm view <paquet> dist-tags` puis `pnpm view <paquet>@<version> time --json` pour la date. Jamais de numero de memoire, y compris pour les actions GitHub.
2. Par defaut : derniere version stable (`latest`) de la ligne majeure maintenue. Pour les cadres a cycle LTS (Node, Next.js), la ligne **active** LTS ; une ligne en fin de maintenance dans les 3 mois exige un ADR.
3. Jamais de pre-version (`alpha`, `beta`, `rc`, `canary`, `next`) sans ADR.
4. Epinglage exact (`save-exact=true` dans `.npmrc`), lockfile committe, `pnpm install --frozen-lockfile` en CI.

## Retrograder
Autorise uniquement sur une incompatibilite **constatee et reproduite** : commande lancee, erreur obtenue. Dans ce cas : derniere version compatible, ADR avec l'erreur exacte, et une ligne dans le backlog pour reevaluer. « Version que je ne connais pas » n'est jamais un motif.

## Ajouter une dependance directe
ADR obligatoire, avec : besoin, alternatives (dont « ne rien ajouter »), licence (MIT, Apache-2.0, BSD, ISC acceptees ; autre = decision humaine), derniere publication < 12 mois, mainteneurs actifs. Un paquet qui execute un script d'installation est autorise ou refuse explicitement dans `pnpm-workspace.yaml`, avec sa raison en commentaire : `allowBuilds: { <paquet>: true|false }` sous pnpm 12 (`onlyBuiltDependencies` sous les versions anterieures). Sous pnpm 12, `pnpm add` echoue alors (`ERR_PNPM_IGNORED_BUILDS`) et ecrit lui-meme une valeur a trancher (`set this to true or false`) : on la tranche, puis `pnpm install` (liste-courses 001, usine 1.6.6). Pour le profil Next, les deux cas usuels : `esbuild: true` (binaire natif) et `unrs-resolver: false` (repli de telechargement inutile quand la dependance de plateforme est installee).

## Securite
- `pnpm audit --prod --audit-level=moderate` propre a chaque cloture de tranche et en CI (seuil abaisse en usine 1.6.7 : sept avis moderes sur Next.js passaient sous le seuil `high`, jusqu'a ce que Next refuse de construire, liste-courses D-073). Un avis **modere** juge sans effet sur le produit, apres analyse ecrite au registre (comme liste-courses D-051), s'ecarte dans `pnpm-workspace.yaml` : `auditConfig: { ignoreGhsas: [GHSA-...] }`, avec le numero de la decision en commentaire. Jamais un avis `high` ou `critical`. Une faille transitive se corrige par `overrides` dans `pnpm-workspace.yaml`, en citant l'avis dans un commentaire.
- Correctif de securite publie : il prime sur toute autre regle de cette page, dans les 48 h.
- **Correctif de securite hors tranche** (usine 1.6.4) : branche `fix/<paquet>-<version>` depuis `main` ; transitif par `overrides` (racine), direct en modifiant `apps/*/package.json` ou `packages/*/package.json` (seuls fichiers d'application ecrits hors tranche, et seulement sur une branche `fix/` ou `chore/`) ; quarantaine pnpm sans exception ; `pnpm audit --prod --audit-level=moderate` propre, `pnpm test` et `pnpm run check` ; une decision au registre (avis, chemin, options ecartees) et une ligne dans l'ADR des dependances ; livraison par `scripts/ship-branch.sh`. Si un test bloque, c'est une tranche (ou la reouverture de celle qui l'a ecrit), pas ce chemin.
- Les mises a jour courantes arrivent par Dependabot (PR hebdomadaires, meme CI). Tu ne fais pas de montee de version opportuniste dans une tranche qui n'en a pas besoin.
