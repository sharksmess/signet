> Note de l'orchestrateur (2026-10-20) : rapport rendu par `code-reviewer` (sans outil d'ecriture dans cette execution) sur `git diff main..HEAD` (HEAD b9e75a2), recopie tel quel. Resultat de la suite transmis au relecteur : `pnpm test` 30/30 fichiers, 354/354 tests, 0 echec (execute par l'orchestrateur au premier plan).

## Revue de code : tranche 003, invitation d'un membre

**Méthode.** J'ai lu le diff `main..HEAD` (14 commits, de a249ffe à b9e75a2), le contrat, le journal, la consigne, les décisions D-086 à D-094, ADR-0017, ADR-0003, ADR-0011, l'ERD §5 avec la table des migrations, le backlog, FRICTION, ainsi que les quatre fichiers de test, leurs helpers et la fausse messagerie. Je n'ai pas relancé la suite, par consigne. Je m'appuie sur le résultat de l'orchestrateur sur b9e75a2 (30/30 fichiers, 354/354 tests). J'ai vérifié par lecture que chaque test échouerait si le comportement était faux. Faute d'outil Write, ce rapport n'est pas écrit dans `docs/04-runbooks/audits/review-003.md` : il est rendu ici.

### BLOQUANT
Aucun.

### A CORRIGER

**1. Le commit c3e1c3e ne compile pas seul.**
- **Emplacement** : `apps/web/src/lib/invitations/invitations.ts:40` dans c3e1c3e.
- **Constat** : ce fichier importe `INVITATION_CREATED_EVENT`, `sendEventWithDeadline` et `InvitationCreatedEventData` depuis `../inngest/client`. Or ces symboles n'arrivent qu'au commit suivant, cd18daf, créé une seconde plus tard. Vérifié : `git show c3e1c3e:apps/web/src/lib/inngest/client.ts` ne contient aucun des deux noms.
- **Conséquence** : la règle de `rules/git.md` (« chaque commit compile et passe les tests de sa couche ») est violée, et le journal présente cette couche comme verte. `git bisect` ne fonctionne pas sur la branche. Le squash limite le dommage sur `main`.
- **Direction** : le signaler dans la PR et le journal, ou réordonner les deux commits (`client.ts` d'abord). Au minimum, consigner l'écart dans FRICTION.

**2. Le contrat de tranche contredit D-090 sur l'empreinte du jeton.**
- **Emplacement** : `docs/03-slices/003-invitation-membre.md:63` (« empreinte » = `sha256(jeton)`, « jeton » = le secret du lien) et `:66` (AC2 : « `sha256(jeton)` est égal à `token_hash` »). Voir aussi `docs/02-architecture/ERD.md:456` (« SHA-256 du secret d'URL ») et `ERD.md:544`, qui décrit encore la RLS `organization_id = current_org()` seule comme « toujours valable ».
- **Constat** : D-090 fixe `sha256(32 octets décodés)`, et le test d'AC2 affirme maintenant que le haché du texte base64url ne correspond **pas**. Le contrat, lu à la lettre, dit l'inverse. L'ERD reste ambigu sur l'empreinte et périmé sur la RLS : P-3 a remplacé ce texte.
- **Conséquence** : la tranche 006 calculera l'empreinte à l'acceptation. Un lecteur qui part du contrat ou de l'ERD (les sources citées par `/slice`) fabriquera la mauvaise, et tous les liens seront refusés.
- **Direction** : amender AC2 et les conventions du contrat (renvoi à D-090). Préciser la ligne `token_hash` de l'ERD : « sha256 des 32 octets, avant encodage ». Corriger la phrase RLS de l'ERD §5.

**3. Aucun test ne couvre le refus de `INVITATION_TOKEN_KEY` côté route (AC16).**
- **Emplacement** : `apps/web/src/lib/invitations/invitations.ts:73` ; `tests/invitations/sending.test.ts`, describe « AC16 ».
- **Constat** : AC16 dit que la clé est validée « au premier usage » et que la route la lit pour sceller (contrat, table des variables). Les tests ne couvrent que la fonction d'envoi. À l'émission, une clé absente ou mal formée lève avant toute écriture, ce qui donne un 500 sans corps métier. Aucun test ne prouve qu'aucune ligne n'est créée, aucun événement émis, et qu'aucune valeur ne fuit dans la réponse.
- **Conséquence** : un déplacement de l'appel après `create_invitation`, ou dans le `try`, ne serait détecté par rien.
- **Direction** : appeler `createInvitation` dans le processus de test avec la clé retirée par `vi.stubEnv`. La base de test y est accessible, inutile de redémarrer le serveur. Vérifier : rejet nommant la variable, zéro ligne, zéro événement.

**4. D-091 (`SET TimeZone = 'UTC'`) n'a pas de test de non-régression durable.**
- **Emplacement** : `packages/db/migrations/0014_invitation.sql:127` ; `tests/invitations/database.test.ts`, test AC15 sur `proconfig`, qui ne vérifie que `search_path`.
- **Constat** : le défaut n'a été visible qu'en local (Europe/Paris), parce que `now() + 7 jours` franchit le 25/10. Après cette semaine, et toujours en CI (UTC), retirer le `SET TimeZone` laisserait passer AC1 et le test AC6 en base (`lifetime = 604800`).
- **Conséquence** : une décision humaine validée (D-094) et reportée sur 006 n'est protégée par rien.
- **Direction** : affirmer `TimeZone=UTC` dans `proconfig`, coût d'une ligne. Éventuellement, appeler `create_invitation` sous `SET LOCAL TimeZone = 'Europe/Paris'` et vérifier 168 h.

**5. Ni `onFailure` ni la rejouabilité du refus de clé (D-093) ne sont testés.**
- **Emplacement** : `apps/web/src/lib/inngest/send-invitation-email.ts:55-58`, et `:80-84` pour le refus de clé ; tests AC14 et AC16 de `sending.test.ts`.
- **Constat** : le commentaire dit que `reportAbandonedInvitation` est « exportée pour être testée directement », mais aucun test ne l'appelle. Or le contrat impose que ce journal ne contienne ni l'e-mail, ni le jeton, ni le `sealedToken`, ni la clé. De même, D-093 fait du refus de clé une erreur **rejouable**, mais le test AC16 vérifie seulement que `output.error` est défini.
  - Sur la question posée pour AC14 : chercher `EMAIL_PROVIDER_NOT_CONFIGURED` dans la concaténation nom + message + journaux suffit à prouver que l'erreur est « nommée ». L'implémentation la place d'ailleurs dans le message **et** le journal (`:111-114`).
  - Mais « journalisée en erreur » n'est pas prouvé : `captureLogs` fusionne `log`, `info`, `warn` et `error`. Un passage à `console.log` resterait vert.
- **Conséquence** : deux décisions écrites (D-093, et le patron `reportAbandonedEvent` d'ADR-0016) et une propriété de non-fuite ne reposent sur aucun test.
- **Direction** :
  - un test direct de `reportAbandonedInvitation` : `console.error`, identifiant présent, e-mail et `sealedToken` absents ;
  - `expect(errorName).not.toBe("NonRetriableError")` sur le refus de clé ;
  - pour AC14, un espion sur `console.error` seul.

### SUGGESTION

**1. La tolérance sur le texte clair scellé est suffisante, mais devenue inutile.**
- **Emplacement** : `tests/helpers/invitations.ts:186` et `tests/invitations/emission.test.ts:108`.
- **Constat** : accepter deux formes de texte clair (32 octets ou 43 caractères) et `>= 60` octets respecte le contrat, qui ne fixait pas ce détail. ADR-0017 §1 le fixe désormais (`AES-256-GCM(secret)`, secret = `randomBytes(32)`).
- **Direction** : figer 32 octets de texte clair et exactement 60 octets scellés.

**2. AC10 peut passer même si les deux appels ne se chevauchent pas.**
- **Emplacement** : `tests/invitations/concurrency.test.ts:39-52`.
- **Constat** : si les deux requêtes sont traitées l'une après l'autre, le test reste vert (201 puis 409). Le risque est faible, car l'index unique protège dans tous les cas.
- **Direction** : forcer le chevauchement, par exemple en retardant la réponse du faux Inngest d'environ 500 ms, pour prouver la sérialisation sur l'index et sur le `DELETE`.

**3. La fausse messagerie est trop tolérante sur les noms de champs.**
- **Emplacement** : `tests/invitations/fakes/fake-mailbox.ts:13-16`.
- **Constat** : elle accepte `to`, `recipient` ou `email`, et la clé d'idempotence en en-tête ou dans le corps. Le protocole est maintenant arrêté par `sender.ts` et ADR-0017 §3, et un renommage côté production ne serait pas détecté.
- **Direction** : n'accepter que le protocole écrit.

**4. Le délai de mise en file existe en double.**
- **Emplacement** : `apps/web/src/lib/inngest/client.ts:93-111` et `apps/web/src/app/api/webhooks/stripe/route.ts:44-50`.
- **Constat** : `sendEventWithDeadline` reprend la logique du webhook Stripe, qui ne l'utilise pas : deux copies du même délai (D-065, règle 3).
- **Direction** : une ligne de backlog pour faire utiliser l'aide au webhook. Ce fichier est hors périmètre de la tranche.

**5. Le journal du 503 ne dit pas pourquoi la mise en file a échoué.**
- **Emplacement** : `apps/web/src/lib/invitations/invitations.ts:126`.
- **Constat** : `sendEventWithDeadline` avale la cause, et le journal ne distingue ni délai dépassé ni refus de la file, ce qui gêne le diagnostic en exploitation.
- **Direction** : renvoyer une issue typée (`timeout`, `rejected`, avec le nom de l'erreur, sans données).

**6. Le message d'abandon est trompeur pour un refus non rejouable.**
- **Emplacement** : `send-invitation-email.ts:57`.
- **Constat** : il dit « ABANDONNE apres les tentatives d'Inngest » même quand aucune nouvelle tentative n'a eu lieu (jeton inouvrable, fournisseur absent).
- **Direction** : formulation neutre.

**7. ADR-0017 ne cite pas toutes les décisions qu'il décrit.**
- **Emplacement** : `docs/02-architecture/ADR/0017-envoi-invitation-jeton-scelle.md:3,7`.
- **Constat** : l'en-tête liste D-086 à D-091, alors que le §4 (point de sauvegarde) relève de D-092 et que le §1 (clé rejouable) et les délais relèvent de D-093.
- **Direction** : ajouter D-092 à D-094 à l'en-tête.

**8. Il manque encore l'entrée du journal de projet.**
- **Constat** : l'entrée `docs/00-context/journal/16-tranche-003-*.md` et sa ligne dans `JOURNAL.md` n'existent pas encore. C'est la tâche de l'orchestrateur en fin d'étape, vérifiée par `close-slice.sh` : simple rappel.

### Points vérifiés sans constat
- **Tests modifiés (D-090, D-094)** : aucun affaiblissement.
  - `sending.test.ts` est renforcé : il ajoute l'assertion négative sur le haché du texte.
  - `database.test.ts` (`rolname::text`) rend `toEqual(["signet_app"])` réellement significatif. L'ancien `.includes` du patron 002 passait sur une chaîne.
  - `tests/billing/environment.test.ts` retire une variable de test au même titre que `STRIPE_API_BASE_URL` : la vérification est identique.
- **Cas limites de la consigne** : tous testés avec code exact et témoin positif (403 member, 404 identique pour tenant B et UUID inconnu, 422 sur 11 entrées, 409 doublon toutes casses, normalisation, `ALREADY_MEMBER` member et owner lui-même, expirée puis réinvitée, acceptée non bloquante, concurrence avec et sans ligne expirée, 503 avec et sans réponse, sans 409 fantôme ensuite).
- **Isolation en base** : la RLS et les privilèges sont testés sous `signet_app`, en contexte étranger forcé, avec garde contre les « mauvaises raisons » de refus.
- **Règles absolues** : filtre tenant explicite partout (y compris `WHERE organization_id` sur le résultat de `create_invitation`), erreurs métier typées et `throw` réservé aux invariants, aucun `any`, aucun `TODO`, aucune dépendance (testé contre `main`), migration nouvelle uniquement.
- **Robustesse** : jeton absent des journaux, de la réponse et des pas mémorisés ; étiquette GCM de 16 octets imposée ; sujet fixe ; caractères de contrôle neutralisés.
- **Documentation** : les décisions D-086, Q-1 à Q-4, P-1 et P-3 sont respectées, et le cas résiduel du lien inerte est écrit dans ADR-0017 §5. ADR-0017 donne les options écartées et leurs raisons. ERD §5 et sa table des migrations, ADR-0003 et ADR-0011 sont à jour. Le backlog liste les six suites prévues (fournisseur réel, limite d'envois préalable, renvoi et révocation, purge, rotation de clé, fuseau en 006).
- **Hors code** : `pnpm db:migrate` n'a pas été joué sur la base de développement. C'est une action humaine.

### Bilan
- **Solide** : la mécanique de l'invitation (jeton scellé, RLS owner, point de sauvegarde, 503 avant le COMMIT) est correcte, et la suite d'acceptation est dense, avec codes exacts et témoins.
- **Fragile** : des décisions validées par l'humain n'ont pas de test qui tienne dans le temps (fuseau UTC D-091, rejouabilité D-093, journal d'abandon), et le commit c3e1c3e ne compile pas seul.
- **Manquant** : la mise en cohérence du contrat et de l'ERD avec D-090 (risque direct pour 006) et un test du refus de clé côté route.

REVIEW: PASS
