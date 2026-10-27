## Relecture de la tranche 009 : consultation des collections et des liens

**Méthode.** J'ai lu tout le diff `main..HEAD` (22 fichiers, 10 commits) et je l'ai confronté au contrat de tranche (AC1 à AC12), à la consigne, au journal de tranche, au journal du passage, au registre (D-114, D-119, D-124, D-128 à D-132), à l'ERD §6.1 et §6.2, aux contrats `listCollections`/`listLinks` et à la politique `collection_isolation` (0016). Je compare aussi au patron de `createCollection` et `addLink`. Je n'ai lancé ni `pnpm test` ni `pnpm run check` : je m'appuie sur les résultats que tu m'as transmis (38/38, check vert, 718 tests passés, 0 échec). J'ai jugé la force des tests en simulant de tête des mutations du code.

### BLOQUANT
Aucun.

### A CORRIGER

**1. Les décisions locales de l'implémenteur ne sont pas encore au registre.**
- **Où :** `docs/DECISIONS.md` (s'arrête à D-132) ; les décisions sont dans `docs/03-slices/009-progress.md:27-32`.
- **Constat :** D-132 ne couvre que ce que l'orchestrateur a interprété. Les choix de l'implémenteur restent uniquement dans le journal de tranche :
  - deux requêtes au lieu d'une jointure pour les liens ;
  - une enveloppe d'erreur qui ne journalise que le code SQL ;
  - des types de sortie dédiés `CollectionListItem`/`LinkListItem` ;
  - un nouveau message renvoyé au client, « Requete invalide. », sur `GET .../collections` (`route.ts:34`).
- **Conséquence :** `.claude/rules/documentation.md` exige une ligne au registre pour toute décision. Le précédent est D-128 pour 005, et ces choix étaient validés par l'humain (D-129). Sans cette ligne, l'humain ne peut ni valider ni écarter ces choix en lisant le registre.
- **Direction :** à l'étape « registre », ajouter une entrée D-133 « slice-implementer, à valider par l'humain » qui reprend ces quatre points et les options écartées.
- **Même étape, avant `close-slice.sh` :** l'entrée de journal de projet `docs/00-context/journal/22-*` n'existe pas encore. Le périmètre la prévoit et le script la contrôle.

### SUGGESTION

**1. Le filtre explicite par organisation n'est prouvé que par la lecture du code.**
- **Où :** `apps/web/src/lib/collections/collections.ts` (le `WHERE c.organization_id = $1` de `readCollections`) et `apps/web/src/lib/links/links.ts` (`c.organization_id = $1` et `l.organization_id = $1` dans `readLinks`).
- **Constat :** la politique RLS `USING (organization_id = signet.current_org())` est posée sur le contexte du chemin. Elle masque donc déjà, à elle seule, les lignes d'une autre organisation. Si l'on retirait l'un de ces trois filtres, AC6 (b) et (c) resteraient verts.
- **Ce qui est bien prouvé :** l'ensemble « vérification d'appartenance + RLS ». Si l'on supprime la requête d'appartenance, on obtient `200 []` au lieu de `404`, et AC5/AC6 (a) échouent.
- **Direction :** même constat que review-005 SUGGESTION 5, déjà au backlog. Il suffit de l'étendre aux deux lectures pour que personne ne croie la règle « filtre tenant explicite » prouvée par AC6.

**2. Le chemin d'erreur `500` (journal sans valeur) n'est pas testé.**
- **Où :** `collections.ts`, `listCollections`, bloc `catch` ; `links.ts`, `listLinks`, bloc `catch`.
- **Constat :** aucun test ne provoque d'erreur de la base sur une lecture. La justification du journal (« le `detail` de pg peut contenir des valeurs ») reste une mesure d'hygiène non démontrée.
- **Direction :** soit écrire au journal « mesure de propreté, non prouvée par un test » (formulation de D-128), soit ajouter un test qui force une erreur et vérifie le journal.

**3. Style des paramètres SQL incohérent dans un même fichier.**
- **Où :** `apps/web/src/lib/links/links.ts`, les requêtes de `readLinks`.
- **Constat :** `addLink` caste explicitement ses paramètres (`$1::uuid`, D-128). Les deux nouvelles requêtes du même fichier ne le font pas. Ce n'est pas un défaut : les colonnes sont typées `uuid`, donc le type est inféré.
- **Direction :** aligner sur l'une ou l'autre forme à la prochaine modification.

**4. La photographie d'AC10 ne compte que des lignes.**
- **Où :** `tests/helpers/consultation.ts`, `snapshotOrganization`.
- **Constat :** une lecture qui modifierait une collection sans changer le nombre de lignes ne serait pas détectée. Le risque est faible : `signet_app` n'a que `SELECT, INSERT` sur `collection` et `link`, et AC8 compare déjà les lignes de `link` complètes.
- **Direction :** comparer les lignes complètes de `collection`, comme AC8 le fait pour `link`. Cela ne coûte presque rien.

### Ce qui a été vérifié et tient
- **Exactitude.**
  - L'ordre d'évaluation (session, validation par le contrat, forme minuscule, `withTenant`, appartenance, collection, `SELECT ... ORDER BY created_at DESC, id DESC`) est conforme au contrat de tranche et au patron de 004/005.
  - Les réponses sont construites champ par champ, avec les clés exactes du contrat.
  - Aucune écriture, aucune migration, aucune dépendance ajoutée.
  - Les `POST` sont inchangés : seules des lignes d'import ont bougé.
- **AC2 à horodatage égal.**
  - Les six lignes sont insérées dans une seule transaction, avec des identifiants à ordre connu et une permutation d'insertion.
  - Les préconditions sont vérifiées : un seul `created_at`, ordre d'insertion différent de l'ordre croissant et de l'ordre décroissant.
  - Le test échoue si l'on retire `id DESC` ou si on le remplace par `id ASC`.
- **AC6 (c).** Un vrai membre de deux organisations : le test échoue si le code s'appuie sur une organisation « courante » plutôt que sur le chemin.
- **AC7.** Une lecture vide, puis deux lectures autour de deux ajouts différents : une réponse mise en cache serait détectée.
- **AC5.** Ordre des messages prouvé par des classes d'égalité, avec une inégalité organisation ≠ collection, conformément à D-124. Le test échoue si l'on renvoie un message constant pour tous les `422`.
- **AC8.** Les 75 liens sont lus, la base est inchangée, le compteur reste à 75.
- **AC9.** Égalité stricte entre la base, le `POST` et le `GET`. L'extension au nom de collection est bien signalée « à valider » (D-132 point 6).
- **Aucune comparaison à `main` dans les tests.**
- **Documentation.**
  - ERD §6.1 aligné sur D-131 point 1.
  - Backlog mis à jour : pagination avant la mise en ligne, index `(organization_id, created_at)`.
  - Journal de tranche tenu après chaque commit.
- **Historique.** Conventional Commits, tests committés avant l'implémentation, un commit par couche (lecture, puis routes), trailer `Slice: 009` présent.

### Bilan
- **Solide :** isolation et ordre des erreurs ; ordre à horodatage égal prouvé de façon déterministe ; fraîcheur, lecture seule et organisation rétrogradée testées contre la vraie base et de vrais tenants.
- **Fragile :** le filtre tenant explicite et l'enveloppe du `500` ne sont prouvés que par la lecture du code (la RLS masque leur retrait).
- **Manquant :** l'entrée du registre pour les décisions de l'implémenteur et l'entrée 22 du journal de projet, à écrire avant `close-slice.sh`.

REVIEW: PASS
