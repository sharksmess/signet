# Relecture code-reviewer : tranche 013, consultations pour les ecrans

Branche `slice/013-consultations-ecrans`, `main..HEAD`, 8 commits.

**Methode.** J'ai lu le diff complet (code, tests, documentation), le contrat de tranche, le journal de tranche, la consigne, le journal du passage autonome, les lignes D-135 a D-139 du registre et le patron de 009 (route `collections`, `lib/collections/collections.ts`). J'ai aussi relu les migrations concernees : `organizations_for_user` (0003 et 0009, l.252-290), les declencheurs de creation (0005, l.66-82), les politiques `signet_definer` (0009, l.37-42 et 87-92) et les index de `member` (0003, l.50-52). Je n'ai lance ni `pnpm test` ni aucune commande sur la base. Les resultats de la suite sont ceux de l'orchestrateur.

## Constats

### BLOQUANT
Aucun.

### A CORRIGER

**1. Les decisions locales de l'implementeur ne sont pas au registre.**
- **Emplacement :** `docs/DECISIONS.md` (s'arrete a D-139) et `docs/03-slices/013-progress.md:30-34`.
- **Constat :** le journal de tranche consigne quatre decisions de `slice-implementer`, avec les options ecartees :
  - un `try/catch` qui ne journalise que le code SQL ;
  - une garde `roleOf` qui `throw` hors du domaine owner/member ;
  - des reponses d'erreur du `GET` construites en ligne, comme le `POST` ;
  - une route `/members` copiee de 009.
  
  Aucune ligne du registre ne les reprend. D-139 ne couvre que les lectures de l'orchestrateur. La regle `documentation.md` dit pourtant « toute decision, quelle qu'elle soit : une ligne dans `docs/DECISIONS.md` ».
- **Consequence :** c'est exactement le manque de review-009 (A CORRIGER 1, rattrape par D-133). Un auditeur qui part du registre ne voit pas ces choix et l'humain ne peut pas les valider.
- **Direction :** ajouter une ligne D-140 « decisions locales de l'implementeur, a valider par l'humain », sur le modele de D-133, avant `close-slice.sh`.

**2. Le helper d'AC3 suspend les declencheurs, et la raison ecrite est inexacte.**
- **Emplacement :**
  - `tests/helpers/screen-reads.ts:171-174` ;
  - justification dans `docs/03-slices/013-progress.md:27` et `docs/04-runbooks/autonomous-run-2026-10-28.md:15`.
- **Constat :** le journal affirme que les declencheurs de creation « exigent un contexte de membre verifie impossible avant l'existence de la ligne ». Les migrations disent autre chose :
  - les politiques que ces declencheurs rencontrent sous `signet_definer` reposent sur `signet.context_org()`, c'est-a-dire la valeur brute de `app.organization_id`, sans controle d'appartenance (`organization_link_usage_definer_write`, `subscription_definer_insert`, 0009 l.87-92) ;
  - 0009 (l.37-42) dit explicitement qu'elles n'exigent pas l'appartenance, pour que `create_organization` fonctionne avant que le member owner existe.
  
  Le 42501 constate est donc tres probablement un refus `WITH CHECK` du a un `app.organization_id` absent. Un `set_config('app.organization_id', <id>, true)` avant chaque `INSERT`, dans la meme transaction, devrait laisser les declencheurs tourner normalement. Je ne l'ai pas verifie a l'execution (base partagee).
- **Est-ce acceptable ?** Sur le principe, oui :
  - la suspension est limitee a une transaction (`is_local = true`), sur la connexion d'administration de test ;
  - elle n'a aucun effet sur le code de production ;
  - la lecture testee ne depend que de `organization` et `member`.
  
  Mais la suspension coupe plus que les deux declencheurs vises. Elle coupe aussi l'application des cles etrangeres (implementees par des declencheurs internes) et le declencheur de contrainte `member_keep_last_owner`. Elle laisse quatre organisations sans `subscription` ni `organization_link_usage`, un etat que la production ne peut pas produire. Elle rend enfin le test dependant d'un role superutilisateur, puisque seul un superutilisateur peut modifier `session_replication_role` (audit-005 l.75).
- **Consequence :** la trace ecrite donne une raison fausse et presente comme inevitable un contournement qui ne l'est probablement pas. C'est aussi la premiere utilisation de cette technique dans le depot, et la suivante la copiera sur la foi de cette justification.
- **Direction :**
  - option minimale : corriger la justification dans le journal de tranche et dans le journal du passage, avec la vraie cause, les effets de bord (cles etrangeres, invariant d'abonnement, superutilisateur requis) et l'alternative ecartee ;
  - option preferable, si son cout est faible : remplacer la suspension par le contexte `app.organization_id` pose a chaque insertion, puis verifier qu'AC3 a egalite reste discriminant (precondition « un seul `created_at` »).

### SUGGESTION

**3. Le journal d'une erreur d'invariant est trompeur.**
- **Emplacement :** `apps/web/src/lib/members/members.ts:39-43` et `:49-55`.
- **Constat :** l'erreur levee par `roleOf` remonte dans le `catch` de `listMembers`. Elle y est journalisee comme « erreur inattendue de la base (code absent) ».
- **Consequence :** pour un exploitant, une derive de schema ressemble a une panne SQL sans code, ce qui oriente mal le diagnostic.
- **Direction :** distinguer l'invariant applicatif de l'erreur `pg` dans le message journalise, sans y ajouter de valeur.

**4. Une branche d'erreur ne peut pas etre atteinte.**
- **Emplacement :** `apps/web/src/lib/organizations.ts:84` et `apps/web/src/app/api/organizations/route.ts:50-55`.
- **Constat :** `listMyOrganizations` rend `Result<...>` mais ne produit jamais `fail`. La branche `if (!result.ok)` de la route ne peut donc pas s'executer.
- **Consequence :** c'est sans effet aujourd'hui, mais un lecteur peut croire qu'il existe une erreur metier possible.
- **Direction :** le garder pour l'homogeneite avec `Result`, avec un commentaire d'une ligne disant qu'aucune erreur metier n'existe aujourd'hui.

**5. Le filtre explicite `organization_id` de la lecture des membres n'est prouve par aucun test.**
- **Emplacement :** `apps/web/src/lib/members/members.ts:76`.
- **Constat :** si l'on retire `WHERE m.organization_id = $1` de la seconde requete, tous les tests restent verts, parce que la politique `member_isolation` borne deja au contexte (AC8 b passe par la RLS).
- **Note :** le controle d'appartenance, lui, est bien prouve. Sans lui, un non-membre recevrait `200 []` au lieu de `404`, et AC8 (a) echouerait.
- **Direction :** etendre l'entree de backlog review-009 SUGGESTION 1 a `listMembers`. Ne pas tenir la regle « filtre tenant explicite » pour prouvee par AC8.

**6. Un troisieme fichier de route duplique les memes helpers.**
- **Emplacement :** `apps/web/src/app/api/organizations/[organizationId]/members/route.ts:22-34`, et le `GET` de `apps/web/src/app/api/organizations/route.ts:44-55`.
- **Constat :** `errorResponse`, `canonical` et `INVALID_ORGANIZATION_ID` sont recopies une troisieme fois. Le `GET` de `/api/organizations` construit lui aussi ses corps en ligne. Le choix est documente (journal l.33-34, D-133 point 6) et coherent avec le perimetre.
- **Consequence :** un changement de forme d'erreur devra etre repete a la main dans chaque route.
- **Direction :** inscrire au backlog un module d'aide aux reponses d'erreur, a extraire hors tranche d'API (de preference avant 012).

**7. L'etat du journal de tranche a un commit de retard.**
- **Emplacement :** `docs/03-slices/013-progress.md:6-9`.
- **Constat :** le journal indique « Dernier commit : c3ae367 » et « AC12 : verification ponctuelle de l'orchestrateur ». Or d57dcfa a coche AC12 dans le contrat depuis.
- **Direction :** le mettre a jour a la cloture.

**8. Le commentaire du contrat contredit `_contract.ts`.**
- **Emplacement :** `docs/02-architecture/api-contracts/organizations.ts:75`.
- **Constat :** le commentaire `minRole: "public", // toute session valide` contredit la definition de `_contract.ts:18-19`, ou `"public"` veut dire « aucune authentification ». L'ecart est signale (D-139 point 6) et porte au backlog comme decision humaine, donc ce n'est pas un constat de conformite. Je le releve parce que le commentaire du code affirme une semantique fausse.
- **Direction :** a traiter avec la decision humaine du backlog.

## Points verifies sans constat
- **Exactitude :**
  - l'utilisateur lu vient toujours de la session (`withUserOnly`, `$1` = `session.user.id`), avec la garde `SG002` en base ;
  - ordres SQL conformes a D-138 et D-139 (`created_at DESC, id DESC` ; `m.created_at ASC, m.user_id ASC`) ;
  - erreurs dans l'ordre `401 < 422 < 404`, et `404` identique pour une organisation inexistante ou un non-membre ;
  - reponses construites champ par champ, `createdAt` par `toISOString()` ;
  - aucune ecriture ;
  - les index `member_user_idx` et `member_org_user_idx` couvrent les deux chemins.
- **Tests discriminants :**
  - egalites forcees avec un ordre d'insertion permute `[2,0,3,1]` ;
  - AC3 separe `organization.created_at` de la date d'arrivee ;
  - AC6 separe la date d'arrivee de `user_id` (les identifiants UUIDv7 sont ordonnes dans le temps, et la precondition est verifiee) ;
  - AC8 (c) a un controle positif qui empeche un test vide ;
  - AC10 compare les lignes completes par `to_jsonb` ;
  - message fige limite a celui que cite le contrat (D-124).
- **Regles et perimetre :** aucun `any` ni `TODO`, aucune dependance, aucune migration. `db.ts`, `errors.ts`, `auth.ts` et `tests/organizations/**` sont inchanges. Le `POST` n'a change que par sa ligne d'import.
- **Historique :** Conventional Commits, tests commites avant l'implementation, un commit de journal apres chaque couche.

## Bilan
- **Solide :** implementation conforme a D-138 et D-139 et au patron de 009 ; isolation et ordres prouves par des tests discriminants ; lecture seule prouvee sur les lignes completes.
- **Fragile :** le helper d'AC3 suspend les declencheurs (et les cles etrangeres) sur une justification inexacte, alors qu'un contexte `app.organization_id` suffirait probablement ; le filtre `organization_id` explicite de `listMembers` n'est prouve que par la lecture du code.
- **Manquant :** une ligne du registre pour les decisions locales de l'implementeur (meme manque qu'en review-009) ; la mise a jour de l'etat du journal de tranche.

REVIEW: PASS
