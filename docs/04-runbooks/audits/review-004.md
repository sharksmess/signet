# Relecture de code — tranche 004 (creation d'une collection)

- Relecteur : `code-reviewer` (contexte neuf, lecture seule pour le code)
- Date : 2026-10-26
- Branche : `slice/004-creation-collection`, commits 255fd28 a f9744db (`git diff main...HEAD`)

## Methode
- Lus : `CLAUDE.md`, `.claude/rules/documentation.md` et `git.md`, contrat `docs/03-slices/004-creation-collection.md`, journal `004-progress.md`, consigne `consigne-run-queue-004.md`, registre (D-113, D-114, D-115), ERD (§6.1, matrice d'isolation, « Migrations appliquees », numerotation), backlog, FRICTION, `autonomous-run-2026-10-26.md`, contrat d'API `collections.ts` et `_contract.ts`, `withTenant` (`apps/web/src/lib/db.ts`).
- Code relu en entier : migration `0016_collection.sql`, `meta/_journal.json`, schema `collections.ts`, `lib/collections/{collections,contracts}.ts`, `errors.ts`, route `POST`, les quatre fichiers `tests/collections/*`, `tests/helpers/collections.ts`, diff de `tests/stack-upgrade/lint-scope.test.ts`.
- Recherches : aucun `any`, `TODO`, `eslint-disable`, `ts-ignore`/`ts-expect-error` dans les fichiers de la tranche ; aucun manifeste (`package.json`, `pnpm-lock.yaml`) modifie.
- **Tests non relances** (base partagee) : je m'appuie sur le resultat transmis par l'orchestrateur (suite complete 487 passes, 1 ignore ; `tests/collections` 57/57 ; `pnpm run check` vert). La force des tests est jugee par lecture et par raisonnement de mutation (la regle retiree ferait-elle echouer un test ?).
- Hors perimetre, non comptes comme manquants : journal de projet 20 et fiche `evidence/004.md` (AC9), a ecrire par l'orchestrateur.

## Ce qui a ete verifie et tient
- **AC1 a AC8 par mutation** : retirer le controle d'appartenance -> la RLS refuse l'`INSERT` (`42501`), erreur inattendue, 500 au lieu de 404 : AC5 (a) echoue. Inverser l'ordre `{ ...body, organizationId }` -> AC5 (b) echoue. Prendre l'auteur dans le corps -> AC5 (b) echoue (`created_by_user_id` verifie). Mettre le nom dans le message du 409 -> AC3 « message fixe » echoue. Retirer le 409 ou mal reconnaitre la contrainte -> AC3 et AC6 echouent (500). Une lecture prealable sans traitement de `23505` -> AC6 echoue sous concurrence. Ordre 401 < 422 < 404 teste dans les deux sens.
- **Migration** conforme a l'ERD §6.1 et au contrat de donnees : colonnes, deux `CHECK`, `UNIQUE (id, organization_id)`, index fonctionnel, RLS activee et forcee, une politique `TO signet_app`, `GRANT SELECT, INSERT` seulement, proprietaire `signet_owner`, aucune fonction. Le catalogue est verifie par des tests qui lisent la base reelle, pas des mocks.
- **D-113** : le diff de `lint-scope.test.ts` n'ajoute qu'une constante commentee et le troisieme argument des quatre `it` ; assertions et delai global intacts.
- **D-115** : l'ancienne assertion etait bien inatteignable (`normalized()` retire les parentheses, `btrim(name)` devient `btrimname`). La nouvelle regex ancree `^CHECK [(]+name = btrim[(]name[)]+$` garde la meme intention et la meme severite : elle echoue si la contrainte disparait ou change d'expression.
- **Commit 1d2b39f** : seuls deux parametres de type `<{ id: string }>` sont ajoutes a des `client.query` ; aucune assertion n'est touchee.
- **ERD** a jour dans le commit de la migration (§6.1, matrice, ligne 0016, numerotation, instantane `0006_snapshot.json`).
- **Erreurs** : `Result` type pour 404 et 409 ; `throw` reserve a l'inattendu, journalise par le seul code SQL ; aucun detail SQL ni nom soumis renvoye au client.

## BLOQUANT
Aucun.

## A CORRIGER

### A CORRIGER 1 — D-114 point 4 (« ni le message de Zod ») n'est prouve par aucun test
- **Emplacement** : `apps/web/src/app/api/organizations/[organizationId]/collections/route.ts` l. 45-49 ; `tests/collections/creation.test.ts` l. 199-209 (boucle des valeurs interdites l. 206-208).
- **Constat** : les tests AC4 verifient seulement que le corps du 422 ne contient pas certains fragments de la valeur soumise (`ZZZZZ`, `424242`, `qqq{`…). Or les messages de Zod 4 (`parsed.error.message`) ne reprennent pas la valeur soumise par defaut (« Invalid input: expected string, received number », « Too big: … <=100 … »). La mutation `validationFailed(parsed.error.message)`, qui est precisement l'option ecartee dans le journal (decision « Messages de 422 fixes… Ecarte : `parsed.error.message` comme en 003 »), **passerait toute la suite**. Les trois textes (« Corps JSON attendu. », « Identifiant d'organisation invalide. », « Nom de collection invalide… ») et le choix entre les deux derniers selon le champ en faute ne sont figes par aucun test.
- **Consequence** : une decision inscrite au registre (D-114, a valider par l'humain) n'a pas de preuve automatique. C'est exactement le defaut que review-006 avait releve pour D-107, et que l'humain a fait corriger par la reouverture D-111 (« chaque test doit echouer si l'on retire la decision qu'il protege »).
- **Direction** : comparer `message` a la liste exacte des textes fixes (un cas par branche : corps non JSON ou non objet, `organizationId` du chemin malforme, nom invalide), affirmer que le 422 ne contient aucun fragment propre a Zod (`expected`, `Too big`, `"path"`), et consigner la mutation qui le prouve.

### A CORRIGER 2 — L'etat du journal de tranche contredit l'etat reel
- **Emplacement** : `docs/03-slices/004-progress.md` l. 6-10 (section Etat) et l. 22 (Blocages).
- **Constat** : apres 714ace9 et 057392d, le journal annonce encore « 1 test en echec, … decision humaine attendue », une prochaine etape « arbitrage humain sur l'assertion `name = btrim name` », des resultats « 56 passes / 1 en echec » et « 486 passes, 1 en echec ». Le blocage reste ouvert avec « Retenu : (b), laisser l'echec signale ». Seule la derniere puce des Decisions mentionne la correction D-115. Le resultat final (487 passes, 57/57) n'y figure pas.
- **Consequence** : CLAUDE.md fait de ce fichier la source de reprise apres une interruption. Un auditeur ou un agent qui le lit en premier conclut a un test rouge et a un arbitrage humain en attente, ce qui est faux.
- **Direction** : mettre a jour l'Etat (dernier commit, resultats finaux, prochaine etape), marquer le blocage comme resolu par D-115 avec le commit 714ace9, et tracer la mise a jour par un commit `docs`.

### A CORRIGER 3 — Les decisions locales de l'implementeur ne sont pas au registre
- **Emplacement** : `docs/DECISIONS.md` (D-113 a D-115) ; `docs/03-slices/004-progress.md`, section Decisions.
- **Constat** : le journal consigne des choix pris sans l'humain, avec leurs options ecartees : politique unique `FOR ALL` plutot qu'une politique par commande, point de sauvegarde sur `23505` plutot qu'une traduction apres le `ROLLBACK`, proprietaire `signet_owner`, noms des contraintes, decoupage des messages 422 en deux textes selon le champ, reponse construite depuis `RETURNING`. Aucun n'a de ligne au registre ; D-114 ne couvre que les lectures de l'orchestrateur. Le journal lui-meme liste « registre (decisions de ce journal) » comme etape restante.
- **Consequence** : `.claude/rules/documentation.md` exige « une ligne dans `docs/DECISIONS.md` » pour toute decision. Le precedent de 006 (D-105 a D-108) les inscrivait. Sans cette ligne, l'humain qui valide D-114 ne voit pas ces choix, en particulier la politique `FOR ALL`, qui engage la tranche 007 (voir SUGGESTION 2).
- **Direction** : avant `close-slice.sh`, ajouter une ligne qui reprend ces decisions (marquees « a valider par l'humain », comme D-114) et renvoie au journal de tranche.

## SUGGESTION

### SUGGESTION 1 — Le test de la politique RLS accepte une politique elargie
- **Emplacement** : `tests/collections/catalog.test.ts` l. 67-68.
- **Constat** : `toContain("organization_id = current_org")` reste vrai pour `organization_id = current_org() OR true`, ou pour une conjonction quelconque. La commande de la politique (`polcmd`) n'est pas verifiee non plus.
- **Consequence** : une RLS rendue permissive par une migration ulterieure laisserait ce test vert. Les tests AC5 (c) rattrapent le cas `OR true` en `SELECT` sous contexte etranger, mais pas toutes les formes.
- **Direction** : comparer l'expression normalisee par egalite (`toBe`) et verifier `polcmd`.

### SUGGESTION 2 — La politique `FOR ALL` couvrira `DELETE` des que 007 l'accordera
- **Emplacement** : `packages/db/migrations/0016_collection.sql` (politique `collection_isolation`).
- **Constat** : aujourd'hui, les privileges seuls limitent `signet_app` a `SELECT, INSERT`. Quand 007 accordera `DELETE`, cette politique l'autorisera a tout membre, alors que le contrat `deleteCollection` exige `minRole: owner` (US-10.2) ; la table `invitation`, elle, porte le role owner dans la RLS. La matrice de l'ERD ne prevoit pas de role pour `collection` : c'est donc coherent aujourd'hui, mais 007 n'aura qu'une barriere applicative pour la regle « owner seulement ».
- **Direction** : ajouter une note au backlog de 007 (ou a la ligne de registre demandee en A CORRIGER 3) pour que l'architecte tranche, avant cette tranche, entre une barriere applicative seule et une politique `FOR DELETE` restreinte a l'owner.

### SUGGESTION 3 — L'insensibilite a la casse hors ASCII depend de la locale de la base et n'est pas testee
- **Emplacement** : index `collection_org_name_ci_idx` (`lower(btrim(name))`) ; tests AC3 et AC6 (ASCII seulement).
- **Constat** : `lower()` suit le `LC_CTYPE` de la base. Sous une base en locale `C`, `Équipe` et `équipe` sont deux noms distincts. L'image de CI (`postgres:16`) est par defaut en `en_US.utf8`, mais la locale de production n'est ecrite nulle part (ERD, `stack.json`). Pour un produit francophone, US-05.3 en depend directement.
- **Direction** : ajouter un cas AC3 avec un nom accentue en capitale initiale, et demander a `db-architect` (backlog) d'inscrire dans l'ERD la locale requise pour la base de production.

### SUGGESTION 4 — D-113 pourrait ne pas suffire
- **Emplacement** : `docs/04-runbooks/FRICTION.md` (ligne du 2026-10-26 « apres D-113 »).
- **Constat** : le premier passage du fichier seul a echoue avec le delai de 60 s (119 s au total, message d'erreur non capture) ; la suite complete est ensuite passee. La cause, delai ou autre chose, reste inconnue.
- **Direction** : le dire dans la fiche de preuves pour que l'humain le voie au moment de fusionner, et capturer le message complet a la prochaine occurrence avant toute nouvelle hausse du delai.

### SUGGESTION 5 — Messages de commit sans le pourquoi quand il n'est pas evident
- **Emplacement** : 714ace9, 1d2b39f.
- **Constat** : ces commits modifient des tests ecrits dans la tranche, ce qui est sensible quand les assertions sont censees etre figees. Leur corps ne cite ni D-115 ni la raison (`no-unsafe-return`). Le format Conventional Commits est respecte.
- **Direction** : a l'avenir, citer la decision dans le corps du commit (le squash reprend la description de la PR, qui doit en tout cas citer D-115).

## Bilan
- **Solide** : migration fidele a l'ERD, avec RLS forcee et privileges minimaux ; logique simple, avec unicite decidee par l'index et point de sauvegarde ; erreurs typees sans fuite ; tests en base reelle, qui echouent par mutation pour l'appartenance, l'autorite du chemin, l'auteur, le 409 et la concurrence ; D-113 et D-115 appliquees a la lettre.
- **Fragile** : test de la politique RLS par simple inclusion ; casse hors ASCII dependante d'une locale non documentee ; politique `FOR ALL` qui couvrira `DELETE` en 007 ; delai de `lint-scope` non garanti.
- **Manquant** : preuve automatique des textes fixes du 422 (D-114 point 4) ; etat du journal de tranche a jour ; decisions locales de l'implementeur au registre.

REVIEW: PASS
