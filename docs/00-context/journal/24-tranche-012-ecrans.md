# 24 — Tranche 012 : ecrans (connexion et pages principales), menee avec l'humain

- **Dates** : 2026-10-28 → 2026-10-29
- **Objectif** : donner a Signet ses premiers ecrans — inscription avec organisation, connexion, mes organisations, page d'une organisation (vue owner et vue member), page d'une collection, acceptation d'une invitation — sans aucun travail serveur, dernier jalon de tranche de l'objectif A (D-083).

## Ce qui a ete fait
- Ouverture avec l'humain : contrat `docs/03-slices/012-ecrans.md` (AC1 a AC17), lectures L-1 a L-11, precisions humaines D-144 (inscription enchainee, protection des ecritures par `SameSite=Lax`, liste fermee des marqueurs) et D-145 (`/organisations?creation=echec`).
- Tests ecrits avant le code par `test-writer` (198 tests, `tests/screens/`), dont deux questions remontees : controle d'`Origin` de better-auth inactif sur le serveur de test (clause retiree d'AC13, correction d'usine 1.6.5 au backlog, D-146) et echo de l'adresse par Next dans la charge RSC (regle donnee d'avance, D-146 point 4).
- Implementation par `slice-implementer` : etiquette `minRole` de D-143 (c3deb74), fonctions pures `apps/web/src/ui/` (2f3ba49), pages et formulaires (7d5893b). Aucun fichier de `app/api/`, `lib/` ou `packages/`, aucune migration, aucune dependance.
- 76 tests rouges apres l'implementation, tous de cause test (requete RSC sans `_rsc`, statut RSC d'une page introuvable, echo de l'adresse, corps du `307`) : arbitrages humains D-148, corrections de `test-writer` (a64f1e8), suite complete verte.
- Trois relectures, coupees une premiere fois par la limite d'usage puis relancees en contexte neuf : AUDIT, CONTRACTS, REVIEW : PASS. Suites (D-150) : AC5 redevenu une egalite, texte de D-147 teste mot pour mot, `as unknown as` retires des helpers ; le masque des cles d'en-tete s'est revele plus large qu'annonce et a ete restreint (D-151, remplace D-149) (e3bfbd7).
- Cloture refusee le 2026-10-29 par une alerte de production publiee entre-temps (`systeminformation`, GHSA-3f7j-7jwc-fxfj) : ordre decide par l'humain (D-152) — visite guidee d'abord, puis correctif hors tranche `fix/systeminformation-5.33.16` par `overrides` (D-154, ADR-0013, PR #39 fusionnee), puis rebase et cloture.
- Visite guidee faite par l'humain (Microsoft Edge), verdict conforme, ecarts cosmetiques (accents, accords) au backlog (D-153) ; prerequis de `recette-012.md` corriges (fichiers d'environnement lus par l'application et par les migrations ; fichier de developpement nomme pour n'etre charge que par `pnpm dev`, D-155).

## Decisions
- D-143 : `minRole: "authenticated"` pour `createOrganization` et `listMyOrganizations` (humain).
- D-144 : contrat de 012 et precisions Q-1, Q-2, marqueurs (humain).
- D-145 : `/organisations?creation=echec` (orchestrateur ; validee par D-155).
- D-146 : reponses aux questions de `test-writer`, AC8 et AC13 corriges, usine 1.6.5 au backlog (humain).
- D-147 : texte « URL ou titre invalide. », suites apres erreur prouvees par la visite (orchestrateur, valide par l'humain).
- D-148 : arbitrages AC1, AC3, AC6/AC7, AC11 (humain).
- D-149 : masque des cles d'en-tete (orchestrateur) ; remplacee par D-151.
- D-150 : suites des trois relectures (orchestrateur ; validee par D-155).
- D-151 : masque restreint a la position de cle (orchestrateur ; validee par D-155).
- D-152 : ordre visite, correctif d'audit, cloture (humain).
- D-153 : visite guidee conforme, AC1 a AC17 coches (humain).
- D-154 : `systeminformation` par `overrides` (orchestrateur, sur l'ordre D-152).
- D-155 : validations de D-145, D-150, D-151 ; rebase ; fichier de developpement (humain).
Le detail est dans `docs/DECISIONS.md`.

## Preuves
Fiche `docs/04-runbooks/evidence/012.md` (produite par `close-slice.sh`, section « Visite guidee » ajoutee apres) ; rapports `docs/04-runbooks/audits/{audit,contracts,review}-012.md` ; `docs/04-runbooks/recette-012.md` (resultat de l'humain) ; PR #39 pour le correctif de dependance.

## Incidents
- Limite d'usage atteinte deux fois : relectures relancees, un agent bloque deux fois sans sortie (controles relances au premier plan par l'orchestrateur).
- FRICTION 2026-10-28 et 2026-10-29 : controle d'`Origin` de better-auth inactif sous Vitest ; build hors environnement de test sur une route anterieure a 012 ; alerte d'audit a la cloture ; motif `XXX` du controle des marqueurs ; tests de demarrage non hermetiques face a un fichier de developpement local ; `ship-branch.sh` refuse pendant une tranche ouverte (marqueur deplace par l'humain).
- Une affirmation inexacte de l'orchestrateur (etroitesse du masque de D-149), corrigee par D-151.

## Etat a la fin
Tranche 012 implementee, relue, visitee et close ; PR ouverte, fusion a la decision de l'humain. Avec elle, les jalons de tranche de l'objectif A sont atteints ; il reste l'usine 1.6.5 et le second projet.

## Etape suivante
Decision humaine : fusion de la PR de 012 sur preuves ; puis branche `chore/` pour la note de `code-reviewer` ; puis usine 1.6.5 (serveur de test sans `TEST`/`VITEST`, outil d'environnement de developpement, fiche de preuves conservant la visite) et adoption dans Signet.
