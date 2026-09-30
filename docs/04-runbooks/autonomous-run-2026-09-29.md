# Run autonome du 2026-09-29

Mode `/run-queue`, lance par l'humain. Budget : **1 tranche, la 010** (ordre d'execution du backlog). Arret demande apres `scripts/ship-slice.sh`. Decision de cadrage : D-023, D-024.

## Prerequis
- `.gates/02-architecture.approved` : present.
- Arbre de travail : propre sur `main` (d49fd3f).
- Dependances de 010 : 001, close (PR #1 fusionnee). PR ouvertes : uniquement Dependabot (#2 a #10), sans lien avec 010.

## File
| Ordre | Tranche | Dependances | Etat |
|---|---|---|---|
| 1 | 010 — durcissement de l'isolation tenant | 001 (close) | en cours |

## Tranche 010
- Debut : 2026-09-29
- Branche : `slice/010-durcissement-isolation`

### Journal
1. Ouverture : branche creee depuis `main` a jour. Contrat redige ; conception confiee a `db-architect` (ADR-0011) **avant** de figer le perimetre de fichiers, puisque la conception decide si un index ou le schema Drizzle doivent changer.
2. Conception : `db-architect` a ecrit ADR-0011, amende ADR-0004 point 4, mis a jour l'ERD. Aucune decision metier manquante. Trois points contestables retenus par l'orchestrateur (D-027, **a valider**). Perimetre fige : migrations 0009/0010, commentaires de `db.ts`, `tests/isolation-hardening/*`, `tests/helpers/db.ts`. Ouverture committee (4077b1e).
3. Tests (2026-09-30) : `test-writer` a ecrit les quatre fichiers puis s'est arrete (flux bloque plus de 600 s, sans rapport ni commit). L'orchestrateur a relance lui-meme `pnpm test` : aucun blocage de la suite ; 28 echecs, tous pour la bonne raison (fonctionnalite absente), 54 verts dont toute la suite de 001, le catalogue de l'usine, AC5 par l'API (deja tenu par le controle applicatif) et les attributs actuels des roles. Lint : 12 erreurs `no-unsafe-return` corrigees par typage des resultats de requete (aucune assertion modifiee). Commit e3b4dff.
4. Implementation : `slice-implementer` a livre 0009 (19042a2), 0010 (1588c66), commentaires de `db.ts` (42e5f83) ; `pnpm db:generate` sans difference. Il s'est arrete sur deux tests AC4 defectueux (lecture de controle dans la transaction deja annulee par `SG002` -> `25P02`, et sous la RLS donc aveugle), sans les modifier.
5. Correction de test par l'orchestrateur (077bb1a) : les deux tests « create_organization ... ne cree aucune organisation » verifient l'absence d'organisation apres la transaction, sous la connexion d'administration ; assertion `SG002` inchangee. Option ecartee : `SAVEPOINT` (lecture toujours filtree par la RLS). Suite complete : 10/10 fichiers, 82/82 tests ; `pnpm run check` vert. AC4 cochee (7320169).
6. Relecteurs lances en parallele (consigne : ne pas relancer `pnpm test`, base et port partages). `contract-guardian` : CONTRACTS: PASS. `security-auditor` : AUDIT: PASS (0 CRITIQUE, 0 MAJEUR, 2 MINEUR, 4 INFO, reportes au backlog ; MINEUR-2 a traiter avant ou dans 002). `code-reviewer` : REVIEW: CHANGES (1er passage) — BLOQUANT : AC2 cochee sans test d'`INSERT` sur `organization` ; A CORRIGER : test de concurrence qui ne retire pas de membre, tests AC4 avec des utilisateurs inexistants (controle « boite blanche » toujours a 0), journaux en retard.
7. Correctifs de relecture renvoyes a `slice-implementer` (autorise a ajouter ou renforcer des tests, jamais a en affaiblir). Un second REVIEW: CHANGES arretera le run (condition d'arret).

### Points a l'attention
- Deux serveurs `next dev` (ports 3199 et 3200) tournent depuis les 24 et 25 septembre, lances depuis l'ancien worktree `.claude/worktrees/agent-a219314fe88bd941b`. Non touches (pas lances par ce run) ; a arreter par l'humain s'ils sont orphelins.
