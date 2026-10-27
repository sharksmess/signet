# Relecture de code, tranche 005 (ajout d'un lien avec quota Free)

## Méthode
- J'ai lu le diff complet `git diff main...HEAD` (13 commits, de 6b6a670 à c7a0374).
- Sources lues : le contrat `docs/03-slices/005-ajout-lien.md`, la consigne, le journal `005-progress.md`, les entrées du registre D-118 à D-124, la mise à jour d'ADR-0002, l'ERD (§6.2, §7, matrice d'isolation, migrations appliquées), le backlog, `CLAUDE.md`, `.claude/rules/{documentation,git,drizzle-postgres}.md` et `apps/web/src/lib/db.ts` (`withTenant`, inchangé).
- Code relu en entier : `0017_link.sql`, `packages/db/src/schema/links.ts`, `apps/web/src/lib/links/{contracts,errors,links}.ts`, `apps/web/src/lib/errors.ts`, la route `.../collections/[collectionId]/links/route.ts`, et le contrat `links.ts` pour sa partie D-120.
- Tests relus en entier : les 9 fichiers `tests/links/*` et `tests/helpers/links.ts`. Les lignes D-121 des deux catalogues sont bien le seul changement dans `tests/collections` et `tests/invitation-acceptance` (une ligne chacun).
- **Je n'ai pas lancé `pnpm test`** (base partagée). Je m'appuie sur le résultat de l'orchestrateur à HEAD c7a0374 : 658 réussis, 1 ignoré déjà présent avant la tranche, 0 échec, `pnpm run check` vert. J'ai jugé les tests à la lecture, en me demandant pour chaque mécanisme si un test échouerait si on le cassait.
- Recherche dans les lignes ajoutées de `any`, `TODO`, `FIXME`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `as unknown as` : aucun résultat.

## Ce qui a été vérifié et tient

**Quota atomique (D-119).** Le trigger `signet.link_usage_on_insert()` (`0017_link.sql:82-122`) fait exactement ce que décrit le contrat :
- il pose d'abord le contexte depuis `NEW.organization_id` ;
- il fait un `UPDATE ... RETURNING` sur la ligne de compteur, ce qui la verrouille ;
- il lève `P0001` si aucune ligne n'est mise à jour, et `SG001` si `link_quota IS NOT NULL AND link_count &gt; link_quota` ;
- il n'y a aucune lecture préalable, ni dans l'application ni en base.

`links.ts` ne lit jamais le compteur.

**Pourquoi le refus du 51e lien est fiable.** L'insertion se fait en une seule instruction `INSERT ... SELECT FROM collection WHERE c.id = $2 AND c.organization_id = $1` (`links.ts:93-100`). Une collection absente donne zéro ligne, donc le trigger ne se déclenche pas. Cela explique « 404 avant 409 » à 50 liens (AC6).

**Les tests casseraient bien si l'on cassait le mécanisme.** Pour chaque modification ci-dessous, au moins un test échouerait :

| Modification du code | Test qui échoue |
|---|---|
| `&gt;` remplacé par `&gt;=` | 50e lien refusé : `quota.test.ts:317`, `lock.test.ts:68` |
| Lecture du compte puis écriture d'une valeur calculée, sans verrou | AC7 (c) : T2 réussit au lieu de recevoir `SG001` (`lock.test.ts:80`) |
| Lecture du compte sans aucun verrou | T2 n'est jamais observée en attente de verrou (`lock.test.ts:72`) |
| `set_config` retiré du trigger | AC13 (b) reçoit `P0001` au lieu de compteurs justes (`isolation.test.ts:330-360`) |
| Contrôle `ROW_COUNT` retiré | AC9 (d) n'obtient plus `P0001` (`counter.test.ts:589`) |
| `ERRCODE` changé | La route rend 500 au lieu de 409 (AC6, AC7) |
| Contrôle d'appartenance retiré | 404 `COLLECTION_NOT_FOUND` au lieu de `ORGANIZATION_NOT_FOUND` (AC5 a) |
| `GRANT EXECUTE` accordé à `signet_app` | AC13 (a) reçoit `0A000` au lieu de `42501` |

**Les preuves de concurrence sont solides.**
- AC7 (c) est déterministe : l'attente est observée dans `pg_stat_activity`, on ne dort pas à l'aveugle. Il y a une variante avec annulation de T1, et une variante sur deux collections différentes.
- AC7 (d) utilise 10 connexions `signet_app`.
- AC10 vérifie le niveau `read committed` de `withTenant` lui-même, et montre que deux transactions `REPEATABLE READ` donnent `40001`.

**Le compteur reste juste (AC9).**
- `link_count = count(*)` est vérifié après chaque scénario qui écrit.
- Pour chaque cause de refus, le compteur est relu dans la transaction après retour au point de sauvegarde (`counter.test.ts:413-429`). C'est une vraie preuve que l'incrément est annulé avec l'insertion.

**Les erreurs SQL sont traduites conformément à D-123.** `linkErrorFromSqlState` est bien la fonction appelée par la couche d'accès (`links.ts:103`), pas une copie. Toute autre erreur est journalisée par son seul code (`links.ts:62-66`), puis relevée sans `cause` ni message de la base. AC9 (d) vérifie le 500 sans fuite.

**Les erreurs sont évaluées dans l'ordre du contrat** : 401, puis 422, puis 404 organisation, puis 404 collection, puis 409. AC11 vérifie le cas « non-membre avec corps invalide → 422 ».

**Les deux 404 ont des corps identiques octet pour octet**, et c'est vérifié pour l'organisation comme pour la collection (`isolation.test.ts:52, 107`).

**Le catalogue (AC12) est conforme à l'ERD** : RLS forcée, une politique comparée à l'égalité stricte, privilèges exacts, colonnes, contraintes, index, un seul trigger (`tgtype = 5`), et la fonction en `SECURITY DEFINER` avec le bon propriétaire et un `search_path` figé.

**Documentation déjà présente.** ERD mis à jour dans le même commit que la migration, ADR-0002 (D-122) et backlog 007 renseignés, journal de tranche tenu avec les options écartées.

**Historique.** Les commits suivent les Conventional Commits, une couche par commit. Les tests sont écrits avant l'implémentation. Le choix de mettre schéma et migration dans un même commit est justifié dans le journal.

## BLOQUANT
Aucun.

## A CORRIGER

### 1. Le refus du titre contenant U+0000 est appliqué en dehors du contrat publié
- **Emplacement** : `apps/web/src/app/api/organizations/[organizationId]/collections/[collectionId]/links/route.ts:64-69`, et `docs/02-architecture/api-contracts/links.ts:49` (`title`) et `:71` (déclencheur du 422).
- **Constat** : la route renvoie 422 pour un titre contenant U+0000, alors que `addLink.input.title` l'accepte. La liste des causes du 422 dans le contrat (« title vide / &gt; 200 caractères ») ne mentionne pas ce cas. Le comportement est exigé par AC4 et testé (`validation.test.ts:206`), mais la décision n'existe que dans le journal, marquée « à faire valider ».
- **Conséquences** :
  - Le contrat publié ne dit plus ce que fait l'API.
  - Si l'écran de la tranche 012 réutilise ce schéma pour valider le formulaire, il laissera passer un titre que le serveur refusera.
  - La même règle (« pas de U+0000 ») vit à deux endroits : dans le contrat pour l'URL (D-120), dans la route pour le titre.
- **Direction** : faire trancher l'humain avant la clôture, avec une ligne au registre.
  - Option recommandée, sur le précédent de D-120 : ajouter un `.refine` sur `title` dans `links.ts`, compléter le déclencheur du 422, puis retirer la garde de la route.
  - Sinon : inscrire la divergence comme acceptée au registre et la mentionner dans le déclencheur du 422 de `links.ts`.

### 2. L'ordre « url puis title » du message 422 n'est pas réellement prouvé
- **Emplacement** : `tests/links/validation.test.ts:136-143`.
- **Constat** : le test vérifie seulement que le message pour « url et titre invalides » est égal au message pour « url seule invalide ». Si l'on remplace tous les messages 422 par un texte unique, ou par `INVALID_TITLE` (cela vise `route.ts:61`), la suite reste verte. Aucun test ne distingue non plus le message d'un chemin invalide de celui d'une URL invalide.
- **Conséquence** : la règle de D-124 « url et title invalides → message de l'url » et l'ordre du contrat n'ont aucune preuve automatique. C'est le défaut qui a déjà fait rouvrir la tranche 006 (D-111) et qui a été relevé en review-004.
- **Direction** : sans figer les textes (D-124 l'exclut), ajouter un cas « titre seul invalide » et vérifier :
  - message(titre seul) ≠ message(url seule) ;
  - message(les deux invalides) = message(url seule).

  Faire de même pour un chemin invalide combiné à une URL invalide. Le coût est faible : tests seulement.

### 3. D-120 annonce « caractères de contrôle refusés », mais seuls U+0000 à U+001F et U+007F le sont
- **Emplacement** : `docs/02-architecture/api-contracts/links.ts:25`, D-120, AC3.
- **Constat** : `isSafeHttpUrl` refuse U+0000 à U+001F et U+007F. Il accepte la plage U+0080 à U+009F, qui sont aussi des caractères de contrôle Unicode (U+0085, par exemple). Aucun test ne couvre ce cas et aucun texte ne dit que c'est voulu. Avec la locale glibc de l'image `postgres:16`, `[:space:]` ne contient pas U+0085, donc le `CHECK` accepte ce caractère et il n'y a pas de 500 aujourd'hui. Avec une base en ICU, la classe des espaces pourrait inclure U+0085 : une URL acceptée par Zod serait alors refusée par le `CHECK` (`23514`), d'où un 500.
- **Conséquence** : un auditeur qui lit D-120 croit que tous les caractères de contrôle sont refusés, ce qui n'est pas le cas. La garantie dépend aussi de la locale de la base, qui n'est pas encore écrite dans l'ERD (review-004 SUGGESTION 3, au backlog).
- **Direction** : décision humaine, car cela touche le contrat publié. Soit étendre la plage refusée à U+0080–U+009F avec un cas dans AC3, soit écrire dans D-120 et le journal que cette plage est acceptée et pourquoi. Passer au backlog est acceptable si la décision est écrite.

### 4. La documentation de clôture n'est pas encore dans la branche à HEAD
- **Emplacement** : `docs/DECISIONS.md`, `docs/00-context/journal/21-*` (absent), `docs/00-context/JOURNAL.md` (pas de ligne 21), `docs/04-runbooks/evidence/005.md` (absent).
- **Constat** : les décisions locales de l'implémenteur, décrites dans `005-progress.md` (« Decisions »), ne sont pas encore au registre. Cela concerne : le point de sauvegarde, les paramètres castés, le message « Collection introuvable. », le nom du trigger, les messages de `RAISE` sans identifiant, l'absence de garde `NULL`, `nullsFirst`, les textes des 422 et la garde U+0000. Le journal de projet 21 et la fiche de preuves (vérification ponctuelle d'AC14) manquent aussi. L'orchestrateur a annoncé qu'il les écrirait.
- **Conséquence** : tant que ces fichiers ne sont pas écrits, la PR ne respecte pas `.claude/rules/documentation.md`.
- **Direction** : les écrire avant `close-slice.sh` (qui le vérifie en partie), en reprenant mot pour mot le point 1 et en le marquant « à valider par l'humain ».

## SUGGESTION

### 1. Le point de sauvegarde n'est pas prouvé, et sa justification est surestimée
- **Emplacement** : `apps/web/src/lib/links/links.ts:90-108` ; journal `005-progress.md:33`.
- **Constat** : si l'on retire `SAVEPOINT` / `ROLLBACK TO`, aucun test n'échoue. Postgres répond à un `COMMIT` sur une transaction en échec par un `ROLLBACK`, sans erreur : la route rendrait le même 409. Le journal présente le point de sauvegarde comme nécessaire pour éviter ce `COMMIT`. En réalité c'est une mesure de propreté, utile seulement si du code écrivait après le refus.
- **Direction** : garder le code, mais reformuler la raison dans le journal ou au registre pour qu'un lecteur ne le croie pas couvert par les tests.

### 2. Une valeur de repli qui donnerait un message trompeur
- **Emplacement** : `route.ts:61`, `?? ["", INVALID_TITLE]`.
- **Constat** : ce repli est inatteignable aujourd'hui. Mais si un champ était ajouté au contrat, son erreur serait annoncée comme une erreur de titre.
- **Direction** : le traiter comme un invariant (`throw`) ou utiliser un message générique.

### 3. Le catalogue AC12 ne vérifie pas tous les rôles
- **Emplacement** : `tests/links/catalog.test.ts:71-100`.
- **Constat** : seuls `signet_app` et `PUBLIC` sont vérifiés sur `link`. La migration affirme que `signet_auth`, `signet_billing` et `signet_definer` « n'ont rien », sans test pour le prouver. Le `search_path` n'est vérifié que sur son premier et son dernier élément.
- **Direction** : étendre la boucle `has_table_privilege` à tous les rôles `signet_*`, et comparer le `search_path` exact.

### 4. À reprendre pour les écrans (012), hors périmètre ici
- Un titre peut contenir des caractères de contrôle autres que U+0000, des caractères de contrôle d'affichage bidirectionnel (U+202E), ou n'être fait que de U+200B : `trim()` ne le retire pas, donc il passe `min(1)`.
- Une URL peut contenir U+202E dans son chemin.
- Des demi-paires UTF-16 isolées sont remplacées sans signal par U+FFFD lors de l'envoi à Postgres : la valeur enregistrée diffère alors de celle soumise, sans 500.
- **Direction** : une ligne au backlog pour l'échappement et l'affichage en 012.

### 5. Le filtre `c.organization_id = $1` n'est démontrable que par la lecture
- **Emplacement** : `links.ts:97`.
- **Constat** : si on le retire, la RLS de `collection` masque quand même la collection de l'autre organisation, et AC5 (b) reste vert. C'est voulu (défense en profondeur), et la règle absolue « toute requête filtre sur le tenant » est respectée à la lecture.
- **Direction** : rien à corriger. Je le signale pour qu'aucun lecteur ne croie le filtre prouvé par AC5 (b).

## Bilan
- **Solide** : le quota repose sur la base, sur une ligne verrouillée, sans lecture préalable. Les preuves de concurrence sont déterministes et casseraient si l'on cassait le mécanisme. Le compteur est vérifié partout. L'isolation est testée par l'API et en base. Le catalogue est vérifié à l'égalité stricte. La traduction des erreurs ne laisse rien fuir.
- **Fragile** : l'ordre des messages 422 n'a pas de preuve. Le point de sauvegarde n'est pas prouvé et sa justification est surestimée. La règle « caractères de contrôle » de D-120 est plus étroite que son texte et dépend de la locale de la base.
- **Manquant** : l'arbitrage humain sur la garde U+0000 placée hors contrat, les décisions locales au registre, le journal de projet 21 et la fiche de preuves 005.

REVIEW: PASS

---

## Seconde relecture — 2026-10-27 (HEAD d6bcc51, après D-125 et D-126)

# Relecture de code, tranche 005 (ajout d'un lien avec quota Free) : seconde relecture, HEAD d6bcc51

## Méthode
- **Diff relu.**
  - Toute la tranche avec `git diff main...HEAD` (21 commits, 38 fichiers).
  - En détail, les changements depuis la première relecture avec `git diff 780c1ed..HEAD` : 9 fichiers, dont la route, le contrat `links.ts`, `schema.test.ts`, `error-order.test.ts`, `validation.test.ts`, le contrat de tranche, le journal, le registre et le backlog.
- **Sources lues.**
  - Le premier rapport `docs/04-runbooks/audits/review-005.md`.
  - Les décisions D-119 à D-126.
  - Le contrat de tranche (AC3, AC4 et AC11 dans leur version modifiée), le journal `005-progress.md` (sections État, Couches et Décisions), le backlog (suites de 005), le périmètre `.gates/scope-005.txt` et `CLAUDE.md`.
  - Les fichiers `.claude/rules/` : `documentation.md` et `git.md` en entier ; pour les autres, la liste seulement.
- **Code relu en entier** : la route `.../links/route.ts`, `docs/02-architecture/api-contracts/links.ts` (`addLink`), `apps/web/src/lib/links/contracts.ts`, et la contrainte `link_title_length_chk` de `0017_link.sql`. `lib/links/links.ts`, `lib/links/errors.ts` et la migration n'ont pas changé depuis 780c1ed. Le constat favorable de la première relecture sur le quota, la concurrence, le compteur, le catalogue et l'isolation reste donc valable sans nouvelle lecture.
- **Je n'ai pas lancé `pnpm test`**, parce que la base est partagée. Je m'appuie sur le résultat de l'orchestrateur à d6bcc51 :
  - 53 fichiers, 680 tests réussis, 1 ignoré (déjà présent avant la tranche), 0 échec ;
  - `pnpm run check` vert.

  J'ai jugé chaque nouveau test en me demandant quelle modification du code il ferait échouer.

## Ce que deviennent les constats de la première relecture

| Constat de review-005 | État | Preuve |
|---|---|---|
| A CORRIGER 1 : U+0000 du titre refusé hors du contrat | **Corrigé** | `links.ts:52-58` : `.refine` sur `title`, déclencheur du 422 complété (`:80`). La garde de la route est retirée (`route.ts`, plus aucun `includes("\u0000")`). D-125 est au registre, l'ancienne décision du journal est marquée « Remplacée par D-125 ». |
| A CORRIGER 2 : ordre des messages 422 sans preuve | **Corrigé**, avec un reste (SUGGESTION 1) | `tests/links/error-order.test.ts` : chaque égalité est accompagnée d'une inégalité. Ce qui est prouvé : url avant titre, collection avant url, chemin avant tout le reste. |
| A CORRIGER 3 : plage C1 acceptée malgré le texte de D-120 | **Corrigé** | `links.ts:28` : `[\u0000-\u001f\u007f-\u009f]`, commentaire et déclencheur complétés. D-126 est au registre, et D-120 renvoie vers D-126. Cas ajoutés à AC3 et `validation.test.ts:72-75`. |
| A CORRIGER 4 : documentation de clôture | Exclu de cette relecture (l'orchestrateur s'en charge) | Voir A CORRIGER 1 ci-dessous pour un manque distinct. |
| SUGGESTION 1 : point de sauvegarde non prouvé | **Traité** | Le journal le décrit maintenant comme une « mesure de propreté, non prouvée par un test », et une ligne a été ajoutée au backlog. |
| SUGGESTION 2 : repli trompeur | **Traité** | `route.ts:28-34, 68` : message neutre `INVALID_REQUEST`. Le choix d'un 422 plutôt que d'un `throw` est justifié dans le journal, avec l'option écartée. |
| SUGGESTION 3, 4, 5 | Au backlog | `000-backlog.md`, section « Issus de la tranche 005 ». |

## Les nouveaux tests échoueraient-ils si l'on cassait le code ?

| Modification du code | Test qui échoue |
|---|---|
| `isSafeHttpUrl` revient à `[\u0000-\u001f\u007f]` (D-126 annulée) | `schema.test.ts` : U+0080, U+0085, U+009F, et la boucle sur la plage dans le chemin (`URL.canParse` encode ces caractères en pourcentage, donc ils passent). `validation.test.ts:73-75` : la réponse devient 201, ou 500 selon la locale, au lieu de 422. |
| `.refine` U+0000 retiré du titre, garde remise dans la route (D-125 déplacée) | `schema.test.ts:331-338` (le schéma accepte le titre). Le test d'API ne le voit pas, mais c'est voulu : la règle se prouve sur le contrat. |
| `.refine` retiré, sans garde | `validation.test.ts:172` (erreur `22021`, donc 500) et `schema.test.ts` |
| Un seul message pour tous les 422 | Les inégalités de `error-order.test.ts:38, 47, 54, 63` |
| Ordre url / title inversé dans `FIELD_MESSAGES` | `error-order.test.ts:46-47` |
| `collectionId` placé après `url` | `error-order.test.ts:62-63` |
| `organizationId` placé après `url` ou `title`, ou même texte pour l'organisation et la collection | **Aucun test** (SUGGESTION 1) |

Recherche dans les lignes ajoutées depuis 780c1ed de `any`, `TODO`, `@ts-`, `eslint-disable`, `as unknown` : aucun résultat. Les nouveaux fichiers de test sont bien dans le périmètre (`tests/links/**`).

## BLOQUANT
Aucun.

## A CORRIGER

### 1. Les suites données aux trois relectures n'ont pas de ligne au registre
- **Emplacement** : `docs/DECISIONS.md` (après D-126) ; commit 0a50d94.
- **Constat** : D-125 et D-126 couvrent A CORRIGER 1 et 3. Plusieurs choix pris depuis n'ont en revanche aucune ligne au registre :
  - confier A CORRIGER 2 au test-writer ;
  - modifier les critères AC3, AC4 et AC11 après validation du contrat (AC11 reçoit quatre nouvelles exigences d'ordre) ;
  - envoyer au backlog audit-005 INFO-1, 2, 4, 5 et 6 et review-005 SUGGESTION 1, 3, 4 et 5 ;
  - traiter les SUGGESTION 1 et 2 dans la tranche.

  Ces choix n'existent que dans un message de commit, le journal de tranche et le backlog. Le précédent direct est D-117, la ligne « suites des trois relectures » de la tranche 004, avec son « à valider par l'humain ». Ce n'est pas la même chose que A CORRIGER 4 de la première relecture, qui porte sur les décisions locales de l'implémenteur.
- **Conséquence** : un auditeur qui lit le registre ne voit pas qui a décidé de reporter les constats d'audit-005, ni de changer AC11 après validation. D-119 a validé le contrat de tranche, mais pas sa version modifiée.
- **Direction** : ajouter une ligne D-127 sur le modèle de D-117 (suites, critères modifiés, reports au backlog, options écartées, statut de validation humaine). L'orchestrateur peut l'écrire en même temps que A CORRIGER 4. Le coût est faible.

## SUGGESTION

### 1. L'ordre « organisation avant collection » et sa place avant l'URL ne sont prouvés par aucun test
- **Emplacement** : `tests/links/error-order.test.ts:28` (`BAD_PATH` ne sert qu'à `collectionId`) ; `route.ts:37-42`.
- **Constat** : `organizationId` est toujours valide dans `error-order.test.ts`. Deux modifications passeraient donc inaperçues, `creation.test.ts:236` ne vérifiant que le statut :
  - déplacer `["organizationId", ...]` en fin de liste ;
  - donner à l'organisation le même texte qu'à la collection.

  La route et le journal annoncent pourtant l'ordre « chemin (organisation, collection) ». Le texte d'AC11 (« chemin invalide ») est respecté à la lettre avec la seule collection.
- **Direction** : ajouter deux cas, « organisation malformée + url invalide → message(organisation seule) » et « organisation et collection malformées → message(organisation seule) ≠ message(collection seule) ». Sinon, écrire dans le journal que l'ordre entre les deux identifiants n'est pas garanti.

### 2. Le nom d'un test témoin annonce un cas qu'il ne vérifie pas
- **Emplacement** : `tests/links/schema.test.ts:325-327`.
- **Constat** :
  - Le test s'appelle « U+00A0 et U+00E9 ne sont pas des caractères de contrôle », mais il ne soumet que `café` (U+00E9).
  - Si l'on soumettait U+00A0, il serait **refusé** par la regex `\S` (en JavaScript, `\s` contient U+00A0) : le nom du test laisse croire le contraire.
  - Dans la boucle de `:315-323`, la partie « hôte » ne prouve probablement rien : l'analyseur WHATWG refuse déjà ces caractères dans un nom d'hôte. La partie « chemin » suffit à prouver D-126.
- **Direction** : renommer le test pour ne citer que U+00E9, ou ajouter un cas U+00A0 avec le résultat attendu réel (refusé, par la règle des espaces). Indiquer en commentaire que la partie « hôte » est une défense en profondeur.

### 3. Le test d'ordre url / titre existe maintenant en double
- **Emplacement** : `tests/links/validation.test.ts:102-109`.
- **Constat** : ce test (égalité seule) est entièrement couvert par `error-order.test.ts:41-48`, qui ajoute l'inégalité. Il est inoffensif, mais un lecteur peut croire que c'est lui qui prouve D-124.
- **Direction** : le retirer, ou ajouter en commentaire un renvoi vers `error-order.test.ts`.

### 4. La modification de la ligne D-120 est écrite dans la colonne « décideur »
- **Emplacement** : `docs/DECISIONS.md`, ligne D-120.
- **Constat** : le renvoi « (plage des caractères de contrôle précisée par D-126) » a été ajouté dans la colonne « décideur » d'une décision humaine. Le format du registre (`documentation.md`) prévoit une mention de remplacement ou de précision, pas une modification du champ « décideur ».
- **Direction** : déplacer ce renvoi dans la colonne des liens, ou dans la description sous la forme « précisée par D-126 ».

### 5. Coupure de ligne dans un commentaire du contrat
- **Emplacement** : `docs/02-architecture/api-contracts/links.ts:22-25`.
- **Constat** : « L'autorité est lue sur le » se termine en fin de ligne, puis la phrase reprend : c'est une trace de l'insertion du texte de D-126. Il n'y a aucun effet sur le comportement, mais le fichier est le contrat publié.
- **Direction** : refaire la mise en ligne du paragraphe à la prochaine modification du contrat.

## Bilan
- **Solide** : les trois A CORRIGER de fond sont corrigés au bon endroit. Les règles U+0000 et C1 sont dans le contrat publié, il n'y a plus de garde parallèle dans la route, et le registre et les critères sont à jour. Les nouveaux tests échouent si l'on casse ce qu'ils prétendent prouver (inégalités, test du schéma du contrat). Le code de quota, de concurrence et d'isolation n'a pas changé depuis la première relecture et reste solide.
- **Fragile** : l'ordre organisation / collection des messages 422 reste prouvé seulement par la lecture du code. Un test témoin porte un nom trompeur (U+00A0).
- **Manquant** : une ligne au registre pour les suites des relectures (reports au backlog, critères modifiés après validation, sur le modèle de D-117). S'y ajoute la documentation de clôture déjà confiée à l'orchestrateur (A CORRIGER 4 de la première relecture).

REVIEW: PASS
