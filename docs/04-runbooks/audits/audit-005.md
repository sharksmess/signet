# Audit de securite, tranche 005 (ajout d'un lien avec quota Free)

**Perimetre** : `git diff main...HEAD` sur `slice/005-ajout-lien`, HEAD `c7a0374`. L'arbre de travail est propre, donc aucun correctif non committe n'est en attente. Je n'ai lance ni `pnpm test` ni aucune commande touchant la base.

**Ce que j'ai lu** : la migration `0017_link.sql`, `schema/links.ts`, `lib/links/{contracts,errors,links}.ts`, le diff de `lib/errors.ts`, la route `links/route.ts`, le contrat `api-contracts/links.ts`, les decisions D-118 a D-124, la section Decisions du journal 005 et la consigne. J'ai aussi relu ce dont la tranche depend : `withTenant` (`lib/db.ts`), `current_org()` et `context_org()` (migration 0009), les politiques et privileges de `organization_link_usage` (0003 et 0009), les privileges par defaut (0006 et 0008), les privileges sur `collection` (0016) et la contrainte de role de `member`. Enfin, j'ai lu les noms des tests `tests/links/{isolation,catalog,lock,counter}.test.ts`.

## Constats CRITIQUE
Aucun.

## Constats MAJEUR
Aucun.

## Constats MINEUR
Aucun.

## INFO (sans effet sur le verdict)

**INFO-1. Le contexte pose par le trigger reste actif jusqu'a la fin de la transaction.**
- **Emplacement** : `packages/db/migrations/0017_link.sql:92`.
- **Constat** : `set_config(..., true)` n'est pas annule a la sortie de la fonction. La clause `SET` d'une fonction ne restaure que `search_path` ; `app.organization_id` garde sa nouvelle valeur jusqu'a la fin de la transaction.
- **Pourquoi ce n'est pas exploitable** :
  - Seul `signet_app` peut inserer : le proprietaire est soumis a la RLS forcee sans politique pour lui, et `signet_definer` n'a aucun droit sur `link`.
  - Pour `signet_app`, la ligne a deja passe le `WITH CHECK` de `link_isolation`. Donc `NEW.organization_id = current_org() = context_org()`, et la reecriture pose la valeur deja en place.
  - Seule une connexion d'administration pourrait voir son contexte change, et le test AC13 (b) en montre la consequence.
- **Pour 007** : la branche `AFTER DELETE` devra reprendre le meme raisonnement avec `OLD.organization_id`, qui est garanti par le `USING`, et ne jamais poser le contexte depuis une valeur qui n'a pas traverse une politique `signet_app`.

**INFO-2. L'URL enregistree n'est pas normalisee, ce qui demande de la prudence a l'affichage (tranche 012).**
- **Emplacement** : `docs/02-architecture/api-contracts/links.ts:24-36,42-48`, et D-119 lecture 3.
- **Ce qui est bien verrouille** :
  - le schema est en minuscules uniquement, ce qui ferme `javascript:`, `data:` et `JAVASCRIPT:` ;
  - l'autorite est lue sur le texte soumis et tout `@` y est refuse, y compris `a\@b`, ou la barre oblique inverse termine l'autorite ;
  - les caracteres de controle C0 et DEL sont refuses ;
  - le meme refus est porte par le `CHECK` en base.
- **Ce qui reste accepte** :
  - des caracteres bidirectionnels ou de largeur nulle dans le chemin, par exemple U+202E, car ils ne sont ni dans `\s` ni dans C0 ;
  - les homographes IDN dans l'hote, par exemple des caracteres pleine chasse que l'analyseur ramene a de l'ASCII.
- **Scenario** : un membre qui ajoute un lien dans sa propre organisation peut rendre son texte affiche trompeur pour ses collegues. Le `href` reste du http(s), donc il n'y a ni XSS ni changement de schema, et rien ne traverse les tenants.
- **Direction pour 012** : afficher le texte via le rendu echappe de React, jamais `dangerouslySetInnerHTML`. Afficher a part le nom d'hote tire de `new URL(url).hostname`, sous sa forme punycode. Ajouter `rel="noopener noreferrer"` sur les liens externes.
- Le texte etant enregistre tel quel (D-119), la neutralisation a l'affichage est le bon niveau. Je ne demande pas de changer le contrat ici.

**INFO-3. Le garde U+0000 sur le titre est dans la route, pas dans le contrat (decision locale 1 du journal).**
- **Emplacement** : `apps/web/.../links/route.ts:64-69`.
- **Sur le plan securite, c'est correct** :
  - le controle porte sur la valeur deja reduite par Zod (apres `trim`) ;
  - il s'execute avant tout acces a la base, donc un non-membre recoit 422 et non 404, sans oracle d'existence ;
  - le message est fixe et ne reprend pas la valeur soumise.
- Les autres caracteres de controle du titre sont stockables, et sans danger si 012 echappe a l'affichage (voir INFO-2).
- **Reste a decider** : le contrat publie accepte U+0000 alors que la route le refuse. Ce point de coherence releve de `contract-guardian` et de l'humain, pas de la securite.

**INFO-4. `40001` est traduit en 409 « quota atteint ».**
- **Emplacement** : `apps/web/src/lib/links/errors.ts:27`.
- Ce code est inatteignable en READ COMMITTED : le test `lock.test.ts:168` verrouille le niveau d'isolation de `withTenant`.
- La limite est ecrite (D-119 lecture 4) : en isolation stricte, une organisation Pro recevrait a tort un refus de quota. C'est un risque de disponibilite, sans fuite.

**INFO-5. Pas de limitation de debit sur `POST .../links`.**
- Seule l'authentification est limitee (`lib/auth-rate-limit.ts`).
- Une organisation Free est bornee a 50 liens par la base. Une organisation Pro (`link_quota` NULL) peut inserer sans limite, jusqu'a environ 2,2 Ko par ligne.
- La route est peu couteuse et la croissance reste dans le tenant de l'appelant. C'est de la dette produit a arbitrer avant la production, pas une faille de tranche.

**INFO-6. Dependances.**
- `pnpm audit --prod --audit-level=high` : aucune vulnerabilite connue.
- `pnpm audit` complet : 2 critiques et 2 hautes. Ce sont les memes avis, en dependances de developpement seulement, qu'a l'audit 004 : la seconde copie de `next` tiree par `@inngest/test`, et `zod` via `eslint-config-next`.
- La tranche n'ajoute aucune dependance : `package.json` et le lockfile sont inchanges dans le diff.

## Points examines et juges sains

**Atomicite du quota**
- Il n'y a aucune lecture du compte cote application : une seule instruction `INSERT ... SELECT` (`links.ts:125-132`) dont le trigger `AFTER INSERT FOR EACH ROW` fait `UPDATE ... SET link_count = link_count + 1 ... RETURNING`.
- Ce verrou de ligne ne depend pas de la collection. En READ COMMITTED, la transaction en attente relit la version validee et calcule 51, puis `SG001` annule l'instruction entiere, increment compris.
- Les tests `lock.test.ts` le prouvent avec un verrou observe et 10 connexions simultanees.

**Chemins qui contourneraient le trigger**
- Ils sont fermes : `signet_app` n'a que `SELECT, INSERT` sur `link` (`0017:45`), sans UPDATE, DELETE, TRUNCATE ni TRIGGER, et cela est verifie par le catalogue.
- `COPY FROM` exige INSERT et declenche les triggers de ligne.
- Seul le proprietaire peut faire `ALTER TABLE ... DISABLE TRIGGER`, et seul un superutilisateur peut modifier `session_replication_role`.
- Il n'existe aucun droit DELETE sur `collection` (0016:36) ni sur `organization`. Aucune cascade applicative ne peut donc desaligner le compteur avant 007.
- Le compteur lui-meme n'est pas modifiable par `signet_app` : `REVOKE INSERT, UPDATE, DELETE` (0003:193), verifie par un test de garde.

**Isolation tenant**
- La RLS est activee et forcee, avec une politique unique `TO signet_app` sur `current_org()`. Depuis 0009, `current_org()` verifie l'appartenance de `app.user_id`, et c'est une comparaison de type `uuid` : la casse est sans effet, et la route normalise de toute facon (`route.ts:42-44`).
- La cle etrangere composite `(collection_id, organization_id)` rend impossible un lien rattache a l'organisation d'une autre collection.
- Il y a un filtre explicite sur `organization_id` et `user_id` (`links.ts:114-120`) et sur `c.organization_id` (`links.ts:129`).
- Les 404 sont identiques pour « inexistant » et « autre organisation », pour l'organisation comme pour la collection, et c'est teste.
- Les valeurs `organizationId` et `collectionId` du corps sont ecrasees par le chemin : pas de mass assignment, Zod retire les cles inconnues, et l'auteur vient de la session.

**Origine du contexte tenant**
- L'organisation vient de l'URL, mais la politique la verifie par l'appartenance (ADR-0011), donc la RLS reste une seconde barriere reelle.

**Autorisation**
- Les seuls roles sont `owner` et `member` (`member_role_chk`), et `minRole: member` du contrat les accepte tous les deux. Aucun role plus faible n'est laisse passer par erreur.

**Fonction `SECURITY DEFINER`**
- Elle appartient a `signet_definer` (NOLOGIN, NOBYPASSRLS) et son `search_path` est fige avec `pg_temp` en dernier.
- Le contexte est pose en premiere instruction et la fonction se borne a `NEW.organization_id`. La politique d'ecriture du compteur porte sur `context_org()`.
- `ROW_COUNT` est verifie : zero ligne leve `P0001`, jamais absorbe, et c'est teste en base et par l'API.
- EXECUTE est retire a PUBLIC et a tous les roles, et teste en 42501.
- Le mode d'echec « aucune ligne vue, conclusion silencieuse » est explicitement ferme.

**Erreurs et journaux**
- Seul le SQLSTATE est journalise (`links.ts:96`), sans URL, titre ni identifiant.
- L'erreur relevee ne contient aucun detail, et les messages `RAISE` ne contiennent aucun identifiant.
- Les messages 422 sont fixes, sans la valeur soumise ni le texte de Zod.
- Le message 409 ne divulgue rien d'un autre tenant.

**Validation**
- Toutes les entrees (chemin, corps) passent par le schema du contrat. Les bornes Zod (UTF-16) sont plus strictes que les `CHECK` en base (points de code). Le `trim` JS est plus large que `btrim` : la valeur stockee satisfait toujours le `CHECK` du titre.

**Note de methode** : la consigne interdit toute modification de fichier, donc je n'ai mis a jour aucune note de memoire d'audit. Un point merite d'etre retenu pour l'audit 007 : la branche DELETE du trigger devra respecter la meme regle d'origine du contexte (voir INFO-1).

AUDIT: PASS
