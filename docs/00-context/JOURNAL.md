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
| 10 | 30/09 | [Tranche 011 : montee Next 16 en autonomie](journal/10-tranche-011-montee-next16.md) | Next 16.3.7, ESLint natif (ESLint 10 reporte) ; PR #17 fusionnee (commit f43d55b) | fiche `evidence/011.md`, ADR-0013, D-042 a D-045 |
| 11 | 02/10 → 07/10 | [Next 16.3.8 : correctifs de securite](journal/11-next-16.3.8.md) | Next 16.3.8, overrides sharp et source-map-js, Dependabot ignore les majeures d'eslint et typescript ; PR #21 fusionnee (commit 24be181) | ADR-0013, D-046 a D-050 |
| 12 | 07/10 | [Mises a jour Dependabot #19, dont better-auth 1.7.7](journal/12-dependances-2026-10-07.md) | better-auth 1.7.7 (avis de securite, exposition nulle) et cinq correctifs ou mineures ; PR #22 fusionnee (commit e8d1060) | ADR-0014, D-051 a D-053 |
| 13 | 07/10 | [Usine 1.5 : WSL2 evalue, blocage de Smart App Control nomme par les tests](journal/13-usine-1.5-wsl2.md) | WSL2 ecarte comme environnement principal, garde en secours ; adoption de l'usine 1.5.0 (et 1.4.2) ; PR ouverte | usine v1.5.0 (104 scenarios), D-054 a D-056 |
