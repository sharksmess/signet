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
