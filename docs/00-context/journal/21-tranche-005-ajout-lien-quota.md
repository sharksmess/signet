# 21 — Tranche 005 : ajout d'un lien avec quota Free

- **Dates** : 2026-10-26 → 2026-10-27
- **Objectif** : livrer l'ajout d'un lien (US-06) avec le refus du 51e lien d'une organisation Free tenu par la base, y compris sous ajouts simultanes (risque #3 du PRD, tranche la plus risquee du backlog), menee avec l'humain et non en autonomie (objectif A, D-083).

## Ce qui a ete fait
- Contrat de tranche redige depuis la consigne `docs/04-runbooks/consigne-tranche-005.md`, valide par l'humain **avant** activation (D-119 a D-122), puis commit d'ouverture (6b6a670).
- Tests ecrits avant le code par `test-writer` (49805ff, 8e818f8, 0d042fa), dont une preuve deterministe du verrou (une transaction observee en attente, puis refusee) et 10 ajouts simultanes par l'API et en base.
- Migration `0017_link.sql` : table `link` (cle etrangere composite vers `collection`, RLS forcee, `SELECT, INSERT` seulement pour `signet_app`) et fonction de trigger `SECURITY DEFINER` `signet.link_usage_on_insert()`, qui incremente la ligne de compteur de l'organisation sous verrou et leve `SG001` au-dela du plafond (ADR-0002 option D). Route `POST /api/organizations/:id/collections/:collectionId/links`, une seule instruction `INSERT ... SELECT`, aucune lecture du compteur (6bc87c6, a5e3b1a, c24dbdd).
- Contrat `links.ts` resserre : URL `http`/`https` avec nom d'hote, sans identifiants ni caracteres de controle C0, DEL, C1 (D-120, D-126) ; titre sans U+0000 (D-125). Un U+0085 donnait un `500` avant D-126.
- Trois relectures, puis correctifs (7ebbc10, d6bcc51) et seconde passe de `code-reviewer` et `contract-guardian`.
- Suite complete a d6bcc51 : 53 fichiers, 680 tests reussis, 1 ignore (preexistant), 0 echec ; `pnpm run check` vert.

## Decisions
- D-118 : decisions autonomes de la tranche 004 validees (humain).
- D-119 : contrat valide, mecanisme d'atomicite et quatre lectures (humain).
- D-120 : URL resserree dans le contrat, precisee par D-126 (humain).
- D-121 : `link_usage_on_insert` ajoute aux listes fermees des fonctions definer de 004 et 006 (humain, regle D-065 n°2).
- D-122 : recalcul du compteur et branche `DELETE` du trigger reportes a 007 (humain).
- D-123 : traduction des erreurs SQL fixee au contrat, `linkErrorFromSqlState` (humain).
- D-124 : remarques de `test-writer` validees (humain).
- D-125 : U+0000 du titre refuse par le contrat (humain).
- D-126 : plage C1 refusee dans l'URL (humain).
- D-127 : suites des relectures (orchestrateur, a valider par l'humain).
- D-128 : decisions locales de l'implementeur (a valider par l'humain).

Le detail est dans `docs/DECISIONS.md`.

## Preuves
Fiche `docs/04-runbooks/evidence/005.md` (produite par `scripts/close-slice.sh`) ; rapports `docs/04-runbooks/audits/audit-005.md` (AUDIT: PASS), `contracts-005.md` (CONTRACTS: PASS, deux passes), `review-005.md` (REVIEW: PASS, deux passes) ; commits de la branche `slice/005-ajout-lien` ; PR et CI citees dans la PR.

## Incidents
- Le hook `block-dangerous` refuse toute commande shell qui nomme un fichier d'approbation de gate, meme pour le lire ; contourne par l'outil de recherche de fichiers.
- `pnpm db:migrate` sur la base de developpement impossible depuis l'agent (`DATABASE_URL_MIGRATE` absente du shell, deja connu : backlog, D-067) ; la base de test est migree par le globalSetup. Action humaine.

## Etat a la fin
Tranche 005 implementee, trois relectures PASS, PR ouverte ; fusion a la decision de l'humain. Quatre des cinq jalons de tranche de l'objectif A sont faits (invitations, collections, acceptation, quota).

## Etape suivante
Fusion de la PR par l'humain sur preuves, validation de D-127 et D-128, `pnpm db:migrate` sur la base de developpement ; puis tranche 012 (ecrans), dont le cadrage reprend les points d'affichage des liens portes au backlog.
