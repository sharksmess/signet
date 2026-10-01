# Journal du projet Signet

Historique du projet, **une entree par etape franchie**, redigee a la fin de l'etape par l'orchestrateur (Claude, via le pont desktop) et versionnee ici. Lecture en deux minutes : ce qui a ete fait, ce qui a ete decide, les preuves, et ou l'on en est.

Complements : decisions detaillees dans `docs/DECISIONS.md`, incidents dans `docs/04-runbooks/FRICTION.md`, preuves de chaque tranche dans `docs/04-runbooks/evidence/`.

| # | Dates | Etape | Resultat | Preuves |
|---|---|---|---|---|
| 01 | 22/09 | [Cadrage : usine installee, PRD et architecture approuves](journal/01-cadrage.md) | Gates 1 et 2 franchis, socle gele | commits fa76b01, b0e9cd7 |
| 02 | 22/09 → 25/09 | [Tranche 001, premiere implementation](journal/02-tranche-001-implementation.md) | Code ecrit, suite instable, frictions consignees | ADR-0007, ADR-0008 |
| 03 | 27/09 → 28/09 | [Usine 1.3 : rituel git, tests autonomes, GitHub](journal/03-usine-1.3-et-github.md) | Depot public, `main` protegee, CI | 65 scenarios d'usine |
| 04 | 28/09 | [Tranche 001 livree](journal/04-tranche-001-livree.md) | PR #1 fusionnee | commit 55c3773, CI verte |
| 05 | 28/09 → 29/09 | [Usine 1.4.0 : preuves, relecture, documentation](journal/05-usine-1.4.md) | Adoption fusionnee (PR #11) | commit d49fd3f, 97 scenarios |
| 06 | 30/09 | [Tranche 010 en autonomie + point d'arret](journal/06-tranche-010-autonome.md) | PR #12 fusionnee | commit 95d60e6, fiche `evidence/010.md` |
| 07 | 30/09 | [Decisions du point d'arret, journal de projet](journal/07-decisions-et-journal.md) | D-031 a D-037, journal en place | cette PR |
| 08 | 30/09 | [Usine 1.4.1 : journal de projet et orchestration autonome](journal/08-usine-1.4.1.md) | Adoption fusionnee (PR #14, commit 09415e2) | usine v1.4.1, 98 scenarios |
| 09 | 30/09 | [Mises a jour Dependabot regroupees](journal/09-dependances-groupees.md) | PR #16 fusionnee (commit 192dd46) | ADR-0012, D-039, D-040 |
| 10 | 30/09 | [Tranche 011 : montee Next 16 en autonomie](journal/10-tranche-011-montee-next16.md) | Next 16.3.7, ESLint natif (ESLint 10 reporte) ; PR ouverte | fiche `evidence/011.md`, ADR-0013, D-042 a D-045 |
