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
ADR obligatoire, avec : besoin, alternatives (dont « ne rien ajouter »), licence (MIT, Apache-2.0, BSD, ISC acceptees ; autre = decision humaine), derniere publication < 12 mois, mainteneurs actifs. Un paquet qui execute un script d'installation doit etre ajoute explicitement a `onlyBuiltDependencies` dans `pnpm-workspace.yaml`.

## Securite
- `pnpm audit --prod --audit-level=high` propre a chaque cloture de tranche. Une faille transitive se corrige par `overrides` dans `pnpm-workspace.yaml`, en citant l'avis dans un commentaire.
- Correctif de securite publie : il prime sur toute autre regle de cette page, dans les 48 h.
- Les mises a jour courantes arrivent par Dependabot (PR hebdomadaires, meme CI). Tu ne fais pas de montee de version opportuniste dans une tranche qui n'en a pas besoin.
