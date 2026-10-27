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
