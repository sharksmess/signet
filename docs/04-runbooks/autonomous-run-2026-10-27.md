# Passage autonome du 2026-10-27 (/run-queue)

Budget fixe par l'humain : **1 tranche, la 009** (consultation des collections et des liens), selon `docs/04-runbooks/consigne-run-queue-009.md`, y compris D-129, D-130 et D-131 (decisions humaines). Arret apres `ship-slice.sh` ou a la premiere condition d'arret. Jamais de fusion.

## Prerequis
- `.gates/02-architecture.approved` present ; aucune tranche active.
- `main` a jour sur d2c1462 (PR #36, tranche 005, fusionnee). Arbre : seulement la consigne, non committee, incluse dans le commit d'ouverture.
- File : 009 (depend de 004 et 005, closes et fusionnees). 007 et 008 ont aussi leurs dependances closes : **hors file** (D-130). PR ouverte : #35 (Dependabot), sans lien avec 009.

## Tranche 009 — Consultation des collections et des liens
- Debut : 2026-10-27, 16:46. Branche `slice/009-consultation`.
- Sources relues : PRD US-07, US-09 ; contrats `listCollections` et `listLinks` ; ERD §6.1, §6.2 ; patron des routes et modules de 004 et 005 ; D-114, D-119.
- Verifications avant contrat : (1) les contrats de lecture ne listent pas de `422`, mais leur entree valide les identifiants comme `Uuid` : identifiant malforme -> `422` par le precedent D-114 point 2 (pas un trou de specification) ; (2) `z.string().url()` de Zod 4.6.7 accepte une URL contenant U+202E ou U+200B : D-131 point 4 compatible avec le schema de sortie de `listLinks` ; (3) l'ERD §6.1 dit que l'index des collections « sert aussi la liste triee par nom », contraire a D-131 point 1 (decision humaine, ordre alphabetique ecarte) : phrase alignee dans la tranche, inscrite au registre.
- Ouverture : contrat `docs/03-slices/009-consultation.md` (AC1 a AC12), perimetre `.gates/scope-009.txt`, journal de tranche ; registre D-129 a D-131 (humain), D-132 (a valider) ; index du journal (ligne 21), backlog (ordre, objectif A, reports de D-131), ERD §6.1. Committee : 6720faf.
- `test-writer` lance (16:58) : 38 tests (`tests/consultation/{nominal,order,errors,isolation,read-only}.test.ts`, helper `tests/helpers/consultation.ts`), 36 echecs attendus (`405`, GET non exporte), 2 verts (AC6 d, RLS existante, non-regression) ; `pnpm run check` vert ; commits aec6dd4, f450698. Verifie par l'orchestrateur : rien hors perimetre, aucune comparaison a `main`. Correction de l'orchestrateur : sa transcription de D-131 point 4 au registre ajoutait « et nom » ; retire, l'extension (test du nom de collection par `test-writer`) devient D-132 point 6, a valider. Commit de6eb83.
- `slice-implementer` : eb72c7d (lecture : `listCollections`, `listLinks`, exports de contrat), 08de798 (routes `GET`), journaux f38f3be, 35c8365, cbbba16. `tests/consultation` 38/38 ; `pnpm run check` vert ; suite complete 718 passes, 1 ignore (preexistant, branche `slice/003-`), 0 echec, 153 s. Decisions locales au journal de tranche (deux requetes pour les liens, enveloppe d'erreur qui ne journalise que le code SQL, types de sortie dedies, repli « Requete invalide. »).
- AC12 verifie par l'orchestrateur (`git diff --name-only main..HEAD`) : aucun manifeste, verrou, migration, fichier d'environnement ni `packages/` ; dans les `route.ts`, seules des lignes d'import sont retirees (code des `POST` intact).
- Relecteurs lances en parallele : `contract-guardian` **CONTRACTS: PASS** (`422` sur identifiant malforme : lecture compatible, absent des `errors` des contrats GET ; ordre de `listCollections` non contractualise) ; `security-auditor` **AUDIT: PASS** (0 critique, 0 majeur ; MINEUR-1 lectures sans borne ni limite de debit, deja au backlog, entree completee ; INFO-1 `Cache-Control` ; INFO-2 rappel 012) ; `code-reviewer` **REVIEW: PASS** (A CORRIGER 1 : decisions de l'implementeur au registre et entree 22 du journal ; 4 SUGGESTION). Rapports archives tels quels dans `audits/{contracts,audit,review}-009.md`.
- Suites (orchestrateur, documentation seulement) : D-133 (decisions de l'implementeur), D-134 (suites des relectures), backlog (audit, contrats, suggestions), journal de projet 22 et son index. Pas de nouvelle relecture (aucun code ni test modifie). Commit 7e04afc.
- Cloture : `close-slice.sh` **CLOTURE REUSSIE** (16d474d, ~17:20), 718 passes / 1 ignore, check, audit `--prod`, build CI, gitleaks : PASS ; fiche `evidence/009.md`.
- Livraison : `ship-slice.sh` lance juste apres ce commit de journal (resultat dans le rapport de fin de session : le journal n'est pas repousse apres la livraison, pour ne pas dependre d'un second push).

## Rapport final

### A decider par l'humain
1. **Fusion de la PR de la tranche 009** sur preuves (fiche `evidence/009.md`, trois verdicts PASS, CI).
2. **Decisions prises en autonomie, a valider** : D-132 (lectures de forme, dont le point 6 : nom de collection rendu tel quel et teste, extension de D-131 point 4), D-133 (decisions locales de l'implementeur), D-134 (suites des relectures).
3. **Avant la mise en ligne** (backlog) : pagination et plafond des deux lectures (changement de contrat, decision humaine ; la liste des collections est sans borne meme en Free), limite de debit, `Cache-Control: private, no-store` global.

### Tranches
- 009 : close, PR ouverte. Aucune tranche arretee. 007 et 008 hors file (D-130).

### Points d'attention
- Transcription de D-131 au registre corrigee par l'orchestrateur (de6eb83).
- Les filtres `organization_id` explicites des lectures ne sont prouves que par la lecture du code (la RLS masque leur retrait) : backlog.

### Etat des branches
- `slice/009-consultation` poussee par `ship-slice.sh`, PR ouverte. `main` inchangee.
