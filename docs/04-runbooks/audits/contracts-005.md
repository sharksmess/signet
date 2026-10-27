# Rapport de contrôle des contrats, tranche 005 (`slice/005-ajout-lien`, `main...HEAD` jusqu'à c7a0374)

Je n'ai lancé ni `pnpm test` ni aucune commande touchant la base. Tout vient de la lecture du diff et du code. Je n'ai exécuté que `node -e` pour comparer deux instantanés JSON.

## Ruptures

Aucune.

## Points vérifiés

**(1) Changements dans `docs/02-architecture/api-contracts/`**
- Le seul fichier modifié est `links.ts`. `_contract.ts` est inchangé.
- Dans `links.ts`, trois changements, tous portés par D-120 :
  - l'ajout de `isSafeHttpUrl` ;
  - l'ajout d'un `.refine` sur `addLink.input.url` ;
  - la reformulation du déclencheur du 422 de `addLink`.
- C'est un resserrement d'entrée seulement. Le 422 existe déjà, son code de statut ne change pas, et aucun champ n'est ajouté ou retiré.
- `addLinkOutput`, `listLinks` (entrée, sortie, erreurs, route) et les autres déclencheurs de `addLink` sont inchangés.
- Qui est touché : une URL sans hôte, avec identifiants ou avec caractère de contrôle, qui passait l'ancienne regex, reçoit désormais 422. Aucun client existant n'envoie cela, puisque la route n'existait pas avant cette tranche.
- Aucune compatibilité à prévoir, la route étant nouvelle.

**(2) `addLink` implémenté tel que contractualisé**
- Route `POST /api/organizations/[organizationId]/collections/[collectionId]/links` et méthode POST : conformes.
- Rôle minimal `member` : conforme. Le contrôle d'appartenance ne regarde pas le rôle, donc owner et member passent et aucun 403 n'est produit.
- Entrée : `organizationId` et `collectionId` viennent du chemin et l'emportent sur le corps. Les autres champs du corps sont ignorés (auteur et date posés par le serveur). L'entrée est validée par le schéma du contrat lui-même, importé via `lib/links/contracts.ts`, pas par une copie.
- Sortie `201` : `LinkView` donne exactement `{id, collectionId, url, title, addedBy, createdAt}`, soit les six champs de `addLinkOutput`. `createdAt` est un `toISOString()`, qui satisfait `datetime()`. Aucun champ en plus, aucun en moins.
- Erreurs :
  - 401 `UNAUTHENTICATED` : session absente, vérifiée avant tout le reste.
  - 404 `ORGANIZATION_NOT_FOUND` : non-membre ou organisation inexistante (même corps).
  - 404 `COLLECTION_NOT_FOUND` : collection inexistante ou d'une autre organisation. Le `INSERT ... SELECT ... WHERE organization_id` ne ramène aucune ligne, donc le corps est identique dans les deux cas.
  - 422 `VALIDATION_FAILED` : conforme au déclencheur resserré par D-120.
  - 409 `FREE_TIER_QUOTA_EXCEEDED` : le trigger lève `SG001` quand `link_quota IS NOT NULL AND link_count &gt; link_quota`. `40001` est aussi traduit en 409, comme l'exige le contrat. La limite correspondante est écrite dans `lib/links/errors.ts` (D-119 lecture 4).
- Idempotence : aucune déduplication d'URL, chaque appel réussi crée un lien. Conforme à « non-idempotente ».
- `listLinks` n'est pas implémenté : la route n'exporte que `POST`, et `contracts.ts` ne ré-exporte que `addLink`.
- Observation : la validation (422) passe avant le contrôle d'appartenance (404). Le contrat ne fixe pas d'ordre et le 422 ne dépend que du texte soumis, donc il n'y a pas de fuite d'existence.

**(3) Garde U+0000 sur le titre : divergence de contrat, non rupture**
- La route refuse en 422 un titre contenant U+0000, alors que `addLink.input.title` (`trim().min(1).max(200)`) l'accepte.
- Cela fait diverger la route du contrat publié : un client qui se fie au schéma du contrat peut produire un titre que le serveur refuse.
- Ce n'est pas une rupture, parce que :
  - le statut et le code (422 `VALIDATION_FAILED`) existent déjà au contrat pour « title invalide » ;
  - c'est un resserrement d'entrée ;
  - le comportement sans garde serait un 500, pire que ce 422.
- Le déclencheur écrit pour le 422 mentionne « title vide / &gt; 200 caractères », pas le caractère nul. La documentation est donc incomplète.
- Ce qu'il faudrait : **inscrire au contrat**, ce qui est la voie cohérente.
  - Ajouter un `.refine` « sans U+0000 » sur `addLink.input.title` et étendre le déclencheur du 422 de `addLink`, comme D-120 l'a fait pour l'URL.
  - C'est un resserrement d'entrée de même nature que D-120. Il reste à l'humain de le décider, car D-120 ne portait que sur l'URL.
- Laisser le garde hors contrat est tolérable à court terme, mais laisse le contrat publié inexact. C'est le même argument que celui de D-120 contre « validation plus stricte dans la route sans toucher au contrat ».
- Le message de 422 de la route nomme déjà « sans caractère nul », donc le comportement est documenté côté serveur.
- Il faut un enregistrement au registre : l'humain doit valider cette décision, et le journal de tranche la marque « à faire valider ».

**(4) Schéma de base**
- `0017_link.sql` est un fichier nouveau. `git diff main...HEAD --name-status -- packages/db/migrations` donne seulement A (0017, `meta/0007_snapshot.json`) et M (`_journal.json`). Les migrations 0001 à 0016 sont inchangées.
- Le contenu n'altère aucun objet existant :
  - il crée la table `link` ;
  - il crée ses contraintes, ses index et la politique `link_isolation` ;
  - il crée la fonction `signet.link_usage_on_insert()` et son trigger ;
  - il accorde `GRANT SELECT, INSERT` sur `link` à `signet_app`.
- Les `ALTER` visent uniquement `link` (propriétaire, RLS) et la fonction nouvelle.
- Il n'y a aucun `GRANT` ni `ALTER` sur `organization_link_usage`, donc ses privilèges et ses politiques sont inchangés. Le trigger y écrit via `signet_definer`, avec les politiques de 0005 déjà en place.
- `_journal.json` : une entrée ajoutée (`idx` 7, `tag` `0017_link`), les entrées existantes sont inchangées.
- `meta/0007_snapshot.json` : son `prevId` est l'`id` de `0006_snapshot.json`. Par rapport à 0006, la seule table ajoutée est `public.link`, aucune table existante n'a changé, et les schémas, énumérations et politiques du snapshot sont identiques.
- Ni `.drizzle` ni `packages/db/src/schema` autre que `links.ts` et l'export dans `index.ts` ne sont touchés.
- Écarts avec l'ERD : le diff de l'ERD (§6.2, §7, matrice, « Migrations appliquées ») est cohérent avec la migration. Il documente aussi le report de la branche DELETE et de `recompute_link_usage` à la tranche 007 (D-122).

**(5) Types partagés**
- `apps/web/src/lib/errors.ts` : seuls `COLLECTION_NOT_FOUND` et `FREE_TIER_QUOTA_EXCEEDED` s'ajoutent à l'union `ApiErrorCode`, avec deux constructeurs (`collectionNotFound`, `freeTierQuotaExceeded`) et un commentaire. Aucun code ni constructeur existant n'est modifié. L'union `status` de `ApiError` (dont 409 et 404) est inchangée.
- `packages/db/src/schema/index.ts` : une ligne `export * from "./links"` ajoutée.

**(6) Tests d'autres tranches**
- `tests/collections/catalog.test.ts` et `tests/invitation-acceptance/catalog.test.ts` : une seule ligne ajoutée dans chacun, `"link_usage_on_insert"`. Aucune suppression, aucun autre changement. C'est conforme à D-121 : la liste reste fermée et exacte.

## Risques (non bloquants)

- Le garde U+0000 hors contrat (point 3) laisse le contrat publié incomplet jusqu'à décision humaine.
- Le journal note que `40001` sur une organisation Pro serait annoncé à tort comme un dépassement de quota, si `withTenant` passait un jour en isolation stricte. C'est une limite déjà écrite (D-119 lecture 4), à rouvrir à ce moment-là.
- `pnpm db:migrate` n'a pas été exécuté sur la base de développement. C'est une action humaine déjà consignée et sans lien avec les contrats.

## Verdict

Aucun champ de requête ou de réponse retiré, renommé ou élargi, aucun statut modifié, aucune colonne ou politique existante altérée, aucune énumération réduite. La divergence du point 3 est un resserrement à faire valider ou inscrire, pas une rupture. Aucun ADR de migration n'est requis.

CONTRACTS: PASS

---

## Seconde passe — 2026-10-27 (HEAD d6bcc51, apres D-125 et D-126)

**Rapport contract-guardian, tranche 005, seconde passe** (branche `slice/005-ajout-lien`, HEAD d6bcc51, `git diff main...HEAD`). Je n'ai lancé aucun test. Les résultats de la suite sont ceux transmis par l'orchestrateur.

## 1. Contrats déclarés (`docs/02-architecture/api-contracts/links.ts`)
Le diff contre `main` ne touche que trois éléments, tous des resserrements d'entrée décidés par l'humain. Aucun autre fichier de `api-contracts/` n'est modifié.
- **`addLink.input.url`** (D-120, D-126) : on ajoute un `refine` `isSafeHttpUrl`. Il exige un nom d'hôte, aucun identifiant (`user:secret@`, `https://site@piege`) et aucun caractère de contrôle C0, DEL ou C1 (U+0000-U+001F, U+007F-U+009F). Le `trim`, le `min(8)`, le `max(2048)` et la regex `^https?://\S+$` d'origine sont conservés.
- **`addLink.input.title`** (D-125) : on ajoute un `refine` qui refuse U+0000. Le `trim`, le `min(1)` et le `max(200)` d'origine sont conservés.
- **Déclencheur du `422 VALIDATION_FAILED`** : seul le texte `trigger` s'élargit, pour couvrir ces refus. Le statut et le code ne changent pas.
- **Inchangés** : `addLinkOutput` (`id`, `collectionId`, `url`, `title`, `addedBy`, `createdAt`), la route, la méthode, `minRole`, les codes 401, 404 (×2) et 409, l'idempotence, et tout `listLinks`.
- **Conséquence** : le `422` s'applique désormais à des entrées qui passaient avant, par exemple `http:///x`, `user@` dans l'URL, ou U+0085. Ce sont des resserrements d'entrée, ni une rupture ni un champ devenu obligatoire. Ils sont décidés (D-120, D-125, D-126), documentés au contrat, et aucun client ne les consomme encore (la tranche 012 ne l'a pas fait).

## 2. La route implémente exactement le contrat
Fichier : `apps/web/src/app/api/organizations/[organizationId]/collections/[collectionId]/links/route.ts`.
- **Source de validation** : la route importe le schéma via `lib/links/contracts.ts`, qui réexporte `addLink` depuis `docs/.../links.ts`. Il n'y a pas de copie.
- **Garde U+0000 retirée** : la validation de la route passe uniquement par `addLinkContract.input.safeParse`, sans garde propre. `organizationId` et `collectionId` du chemin priment sur le corps.
- **Messages 422** : l'ordre est organisation, collection, `url`, `title`. Le repli `INVALID_REQUEST = "Requete invalide."` est utilisé si aucun de ces champs n'est fautif. Les messages sont fixes, sans valeur soumise ni message de Zod.
- **`201`** : `LinkView` renvoie exactement `id`, `collectionId`, `url`, `title`, `addedBy` et `createdAt` (ISO UTC). Cela correspond à `addLinkOutput`, sans champ ajouté ni retiré.
- **Codes** :
  - 401 : `UNAUTHENTICATED`.
  - 404 : `ORGANIZATION_NOT_FOUND` quand l'appelant n'est pas membre ou que l'organisation n'existe pas, et `COLLECTION_NOT_FOUND` quand la collection n'existe pas ou appartient à une autre organisation, avec un corps identique.
  - 409 : `FREE_TIER_QUOTA_EXCEEDED`, produit à partir de `SG001` ou `40001`.
  - 422 : `VALIDATION_FAILED`.
  - Les erreurs SQL inattendues donnent un `500` sans détail.
- **Écart de forme** : `422` pour un corps non JSON ou un tableau, avec le message « Corps JSON attendu. ». Le contrat ne le détaille pas mais le `VALIDATION_FAILED` le couvre. Ce n'est pas une rupture.

## 3. Schéma de base
- **Migrations** : `git diff --name-status` n'ajoute que `0017_link.sql`, `meta/0007_snapshot.json` et une entrée dans `meta/_journal.json`. Les migrations 0001 à 0016 sont inchangées.
- **Journal** : l'entrée ajoutée est `idx 7`, tag `0017_link`, et rien d'autre n'est retouché. Le snapshot garde la numérotation propre à drizzle-kit, comme l'ERD le décrit.
- **Table `link`** : c'est une création, donc aucune colonne existante n'est supprimée, renommée ou passée à NOT NULL. Le SQL correspond à l'ERD §6.2 : `CHECK` sur le schéma, `CHECK` sur la longueur de l'URL (8 à 2048), `CHECK` sur la longueur du titre trimé (1 à 200), clé étrangère composite `link_collection_fk`, RLS activée et forcée, `GRANT SELECT, INSERT` seulement pour `signet_app`.
- **ERD** : `ERD.md` est mis à jour dans la même PR (migration, trigger, RLS, privilèges). L'ERD annonce correctement que la branche `DELETE` du trigger et `recompute_link_usage` sont reportées en 007 (D-122).

## 4. Types partagés
- `apps/web/src/lib/errors.ts` : ajouts seulement. Deux valeurs d'union `ApiErrorCode` en fin de liste (`COLLECTION_NOT_FOUND`, `FREE_TIER_QUOTA_EXCEEDED`) et deux fabriques (`collectionNotFound`, `freeTierQuotaExceeded`). Les statuts 404 et 409 existaient déjà dans `ApiError.status`.
- `packages/db/src/schema/index.ts` : une seule ligne ajoutée, `export * from "./links"`.

## 5. Tests d'autres tranches
- Seules deux lignes `"link_usage_on_insert",` sont ajoutées, dans `tests/collections/catalog.test.ts` et `tests/invitation-acceptance/catalog.test.ts`. C'est exactement D-121 : la liste des fonctions `SECURITY DEFINER` reste fermée et exacte, et aucune assertion n'est affaiblie.

## Ruptures
Aucune.

## Risques résiduels (non bloquants)
1. Le resserrement d'entrée de l'URL et du titre est une décision d'humain (D-120, D-125, D-126). Si un client tiers existait avec des URL à identifiants ou à contrôles C1, il recevrait un `422` nouveau. Il n'y en a pas, la tranche 012 est à venir.
2. `isSafeHttpUrl` dépend de `URL.canParse` (Node). La locale requise pour le `CHECK [[:space:]]` n'est pas encore écrite dans l'ERD (renvoyé au backlog par review-004 et D-126). Le refus des C1 réduit déjà le risque de `500` sur ce point.
3. Le `40001` traduit en `409` serait faux sur une organisation Pro si la route passait un jour en isolation stricte. La limite est écrite dans le code et dans D-119, et n'est pas atteignable en `READ COMMITTED`.

## Verdict
CONTRACTS: PASS
