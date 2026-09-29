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
- Deroule : voir sections ci-dessous, mises a jour au fil de l'eau.

### Journal
- Ouverture : branche creee depuis `main` a jour. Contrat redige, conception confiee a `db-architect` (ADR-0011) avant de figer le perimetre de fichiers, puisque la conception decide si une colonne ou un index doit etre ajoute.
