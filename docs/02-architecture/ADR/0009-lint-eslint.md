# ADR-0009 — Lint reel : ESLint 9 (ligne de maintenance), eslint-config-next 15.5, typescript-eslint

- **Statut** : accepte ; partie « ESLint / `eslint-config-next` / `FlatCompat` » remplacee par ADR-0013 (tranche 011)
- **Date** : 2026-09-28
- **Phase** : 3 — tranche 001, adoption de l'usine 1.3 (`docs/04-runbooks/consigne-adoption-1.3.md`, etape 3)

## Contexte

L'usine 1.3 exige un script `check` (`pnpm typecheck && pnpm lint`) execute a chaque cloture et en CI.
Le depot n'avait aucun linter : les interdits de CLAUDE.md (pas de `any`, pas de suppression de
verification de type) n'etaient verifies que par relecture. `stack.json` fige Next.js sans fixer de
linter ; ajouter des dependances directes exige cet ADR (`.claude/rules/dependencies.md`).

## Besoin

- Regles Next (`next/core-web-vitals`, `next/typescript`) sur `apps/web`, la ou le framework en a.
- Regles TypeScript **type-aware** sur tout le TypeScript du depot (`apps/web`, `packages/db`,
  `tests`) : `no-explicit-any`, `ban-ts-comment`, `no-unsafe-*`, `no-floating-promises`.

## Dependances ajoutees (racine, `devDependencies`, epinglage exact)

Versions interrogees dans le registre le 2026-09-28 (`pnpm view <paquet> dist-tags`, `time`).

| Paquet | Version | Tag registre | Publiee | Licence |
|---|---|---|---|---|
| `eslint` | 9.39.5 | `maintenance` (`latest` = 10.11.0) | 2026-07-10 | MIT |
| `eslint-config-next` | 15.5.26 | `backport` (= version de `next` du projet) | 2026-09-22 | MIT |
| `typescript-eslint` | 8.70.1 | `latest` | 2026-09-21 | MIT |
| `@eslint/eslintrc` | 3.3.7 | `latest` | 2026-09-01 | MIT |

Les quatre sont maintenus activement (publications de septembre 2026, ou de juillet pour la ligne de
maintenance d'ESLint 9). `@eslint/eslintrc` fournit `FlatCompat`, par lequel la configuration
Next 15, ecrite au format eslintrc, entre dans une configuration plate.

## Options envisagees

### Option A — Ne rien ajouter
S'en tenir a `tsc --noEmit`. Ecartee : `tsc` n'interdit ni `any` explicite ni `@ts-ignore`, et
l'usine 1.3 exige `pnpm lint`.

### Option B — `next lint`
Ecartee : il ne couvre que `apps/web`, alors que `tests/` et `packages/db` portent l'essentiel du SQL
et des connexions a privileges. Il repose de toute facon sur les memes paquets.

### Option C — ESLint 10 (`latest`)
Ecartee sur incompatibilite **constatee et reproduite** le 2026-09-28. `eslint-config-next@15.5.26`
et ses plugins (`eslint-plugin-import`, `-react`, `-react-hooks`, `-jsx-a11y`) declarent tous
`eslint` au plus `^9` (`pnpm peers check` : « unmet peer eslint, Installed: 10.11.0 »). A
l'execution, `pnpm exec eslint .` sous 10.11.0 echoue :

```
Error: Cannot read config file: ...eslint-config-next@15.5.26.../eslint-config-next/index.js
Error: Failed to patch ESLint because the calling module was not recognized.
If you are using a newer ESLint version that may be unsupported, please create a GitHub issue
```

### Option D — ESLint 9.39.5 (tag `maintenance`) — retenue
Derniere version de la ligne 9 : aucun conflit de pairs, lint fonctionnel.

## Decision

Option D. `eslint-config-next` suit la version de `next` du projet (15.5.26), pas le `latest` 16.x
qui vise Next 16. Configuration : `eslint.config.mjs` a la racine. Les regles Next sont limitees a
`apps/web/**` ; `typescript-eslint` `recommendedTypeChecked` s'applique a tout le TypeScript, et les
fichiers de configuration hors tsconfig passent par `allowDefaultProject` au lieu d'etre exclus.
Seuls sont ignores `node_modules`, `.next`, `dist`, les migrations SQL, `.claude/` et
`docs/templates/` (gabarits de l'usine).

**Script d'installation.** `eslint-config-next` tire `unrs-resolver`, dont le `postinstall` ne sert
que de repli pour telecharger le binding natif quand la dependance optionnelle de plateforme
(`@unrs/resolver-binding-*`) manque. Elle est installee : le script est refuse explicitement
(`allowBuilds: unrs-resolver: false` dans `pnpm-workspace.yaml`). Aucun code tiers ne s'execute a
l'installation.

`engines.node` passe a `>=24` (Node 24, ligne LTS active, cf. `.nvmrc`).

## Consequences acceptees

- ESLint reste sur la ligne 9 tant que le projet est sur Next 15. La ligne 9 est en maintenance
  seulement : elle recoit les correctifs de securite, pas les nouveautes.
- `FlatCompat` et `@eslint/eslintrc` n'existent que pour relier la configuration Next 15 au
  format plat : ils disparaissent avec le passage a une configuration Next native au format plat.
- Le lint type-aware allonge `pnpm check` : chaque fichier est analyse avec son programme TypeScript.

## Signal de reexamen

- Montee de `next` en 16.x (fin de vie de la ligne 15 annoncee pour octobre 2026, ADR-0008) :
  reprendre `eslint-config-next` 16, reevaluer ESLint 10 et retirer `@eslint/eslintrc`. Ligne
  ajoutee au backlog.
- Un binding natif `unrs-resolver` absent pour une plateforme de CI : le refus du script
  deviendrait bloquant.
