# Audit sécurité : tranche 009 (consultation des collections et des liens)

**Conclusion : la tranche est conforme. Je n'ai trouvé aucune faille critique ni majeure, seulement 1 constat MINEUR (dette déjà inscrite au backlog) et 2 INFO.**

Périmètre : `git diff main..HEAD` sur la branche `slice/009-consultation`, arbre de travail propre. La tranche ne touche aucun fichier de migration, ni `packages/`, ni `pnpm-lock.yaml` (identique octet pour octet à `main`), ni `db.ts`, ni `errors.ts`. Je n'ai pas lancé `pnpm test` : je me fonde sur les résultats que tu m'as transmis.

## Points vérifiés

**1. Isolation tenant : conforme.**
- **Collections** (`apps/web/src/lib/collections/collections.ts:155-168`) :
  - l'appartenance est vérifiée avec `m.organization_id = $1 AND m.user_id = $2` ;
  - la lecture filtre explicitement sur `c.organization_id = $1` ;
  - les deux requêtes passent par des paramètres liés, sans concaténation.
- **Liens** (`apps/web/src/lib/links/links.ts:187-208`) : trois étapes dans une seule transaction `withTenant` :
  - appartenance ;
  - existence de la collection avec `c.id = $2 AND c.organization_id = $1` ;
  - lecture de `link` avec `organization_id` et `collection_id` explicites.

  Un non-membre est refusé avant toute requête sur la collection. Le code d'erreur ne révèle donc jamais si un `collectionId` existe dans une autre organisation.
- **Identifiants en majuscules** : ils sont ramenés en minuscules par `canonical()` avant `withTenant` et les requêtes. Le risque de comparaison texte sur un UUID en majuscules, relevé à l'audit 002, n'existe pas ici.
- **Les tests prouvent bien l'isolation** (`tests/consultation/isolation.test.ts`) :
  - corps de réponse identiques octet pour octet entre organisation d'autrui et inexistante, et entre collection d'autrui et inexistante ;
  - un utilisateur membre de A et de B ne voit, sous chaque chemin, que l'organisation de ce chemin ;
  - contexte étranger forcé sous `signet_app`, avec un témoin positif.

  À noter : le filtre `c.organization_id` ne se prouve que par la lecture du code, car la RLS masque déjà la collection étrangère. C'est déjà au backlog (review-005), ce n'est pas un défaut.

**2. Origine du contexte tenant : conforme.**
- `organizationId` vient de l'URL. Mais depuis la migration 0009, `signet.current_org()` ne renvoie l'organisation que si `app.user_id` en est membre (`packages/db/migrations/0009_rls_session_user_membership.sql:127-137`).
- Les politiques `collection_isolation` et `link_isolation` (migrations 0016 et 0017) s'appuient sur cette fonction. La RLS reste donc bien une seconde barrière.

**3. Autorisation : conforme.** Le rôle minimal du contrat est `member`, ce qui inclut owner et member. Le contrôle d'appartenance applique exactement cette règle.

**4. Ordre des erreurs 401 &lt; 422 &lt; 404 : conforme.**
- Les deux `GET` vérifient d'abord la session, puis valident le chemin avec `safeParse` (schéma du contrat), puis lisent.
- Les messages 422 sont fixes, sans la valeur soumise ni le message de Zod.
- Quand les deux identifiants sont malformés, c'est le message de l'organisation qui sort (ordre de `FIELD_MESSAGES`).
- La chaîne de requête n'est jamais lue.

**5. Lecture seule : conforme.** Uniquement des `SELECT` et des `set_config(..., true)` locaux à la transaction. Le test AC10 compare l'état complet (collections, liens, compteur) dans l'organisation lue et dans celle de l'appelant étranger.

**6. Fuites : aucune.**
- La réponse est construite champ par champ : `{id, name, createdAt}` et `{id, url, title, addedBy, createdAt}`. Aucun `organizationId`, `collectionId` ni colonne interne.
- En cas d'erreur, seul le code SQL est journalisé, puis une `Error` sans détail est relevée (`collections.ts:139-144`, `links.ts:171-176`). Ni identifiant, ni URL, ni titre, ni `detail` de `pg`.
- Rendre `addedBy` (UUID de l'auteur) est prévu au contrat. Il ne vise qu'un membre de la même organisation : ce n'est pas une fuite.

**7. Privilèges : rien de nouveau.** Aucune migration, aucune politique, aucun `GRANT`, aucune fonction `SECURITY DEFINER`.

**8. Dépendances : rien de nouveau.**
- `pnpm audit --prod` : aucune vulnérabilité connue.
- `pnpm audit` complet : 4 alertes (2 critiques, 2 hautes), toutes en dépendances de développement et préexistantes (`next` via `@inngest/test`, `zod` via `eslint-config-next`). Le fichier de verrouillage n'a pas changé.

## Constats

### MINEUR-1 : lectures sans borne ni limite de débit (risque de déni de service, déjà au backlog)
- **Emplacement** :
  - `apps/web/src/lib/collections/collections.ts:163-168` ;
  - `apps/web/src/lib/links/links.ts:197-203` ;
  - les deux `GET` dans `apps/web/src/app/api/organizations/[organizationId]/collections/route.ts:72-92` et `.../[collectionId]/links/route.ts:89-111`.
- **Scénario d'exploitation** :
  1. Un utilisateur crée une organisation, Pro (`link_quota` vide, donc sans plafond) ou même Free : le nombre de collections n'a aucun plafond, ni en Free ni en Pro (audit-004 MINEUR-1).
  2. Il la remplit de milliers de collections, ou de dizaines de milliers de liens dans une collection, puisque les `POST` n'ont pas de limite de débit.
  3. Il enchaîne les `GET` en parallèle. Chaque appel charge toute la liste en mémoire, la sérialise et garde une connexion du pool `signet_app` occupée pendant le transfert.
  4. Le pool partagé par tous les tenants s'épuise et la mémoire du processus Node gonfle : le service se dégrade pour tout le monde.
- **Pourquoi MINEUR** : le contrat sans pagination est une décision humaine (D-131 point 3). La pagination et un plafond de réponse sont inscrits au backlog « avant la mise en ligne » (`docs/03-slices/000-backlog.md:144`). L'attaquant ne lit que ses propres données : il n'y a aucune fuite.
- **Écart dans le backlog** : l'entrée de la ligne 144 ne cite que « une organisation Pro n'a aucune borne de liens ». Or la liste des collections n'a aucune borne même pour une organisation Free.
- **Remédiation** :
  - au moment du changement de contrat, ajouter une pagination par curseur `(created_at, id)`, qui suit déjà l'index `link_collection_recent_idx`, avec une taille de page plafonnée côté serveur ;
  - ajouter un limiteur à stockage partagé, par utilisateur et par organisation, sur les `GET` comme sur les `POST` (à regrouper avec audit-001 MINEUR-5, audit-002 MINEUR-1, audit-004 MINEUR-1 et audit-005 INFO-5) ;
  - compléter l'entrée du backlog pour qu'elle couvre aussi la liste des collections en Free.

### INFO-1 : aucun `Cache-Control` explicite sur les réponses authentifiées
- **Emplacement** : `.../collections/route.ts:91`, `.../links/route.ts:110` (`NextResponse.json(result.value, { status: 200 })`) ; `apps/web/next.config.ts` ne définit aucun en-tête.
- **Constat** :
  - Next ne met pas ces réponses en cache, puisque le gestionnaire lit les en-têtes pour la session (AC7 vert).
  - Mais la réponse ne dit rien aux caches intermédiaires. Sans durée de validité explicite ni `Last-Modified`, les caches partagés et les CDN courants ne la stockent pas.
  - Je n'ai donc aucun scénario exploitable dans la configuration actuelle. Le risque n'apparaîtrait qu'avec un CDN réglé pour « tout mettre en cache ».
  - Le même comportement existe déjà sur toutes les routes antérieures.
- **Direction** : avant la mise en ligne, poser `Cache-Control: private, no-store` sur toutes les réponses d'API authentifiées. Un réglage global au niveau du projet suffit, sans toucher cette tranche.

### INFO-2 : valeurs brutes rendues dans du JSON (rappel pour la tranche 012)
- **Emplacement** : `apps/web/src/lib/links/links.ts:205-217`, `apps/web/src/lib/collections/collections.ts:170-176`.
- **Constat** :
  - Les réponses partent en `application/json` (`NextResponse.json`), un type que les navigateurs n'interprètent pas comme du HTML : l'API elle-même n'ouvre aucune faille XSS.
  - Rendre les valeurs telles qu'enregistrées (caractères de contrôle bidirectionnel, AC9) est voulu (D-131 point 4).
  - Le risque à l'affichage revient à la tranche 012 : échappement, schémas d'URL autorisés pour `href` (refus de `javascript:` si le contrat de saisie l'accepte), neutralisation de U+202E. Comme demandé, je ne le compte pas comme un défaut de l'API.
  - Aucun en-tête `X-Content-Type-Options: nosniff` global : c'est un durcissement de projet, sans exploit pour du JSON.

Les deux INFO ne demandent aucune correction dans cette tranche.

AUDIT: PASS
