# Backlog des tranches — Signet

Ordre de dependance technique d'abord, risque decroissant en departage a profondeur egale (la tranche la plus risquee en premier, tant qu'il reste du temps pour se tromper). Chaque tranche couvre une capacite utilisateur complete du PRD (base + API + UI) ; l'isolation tenant (US-09) n'est pas une tranche a part — c'est le critere d'acceptation AC5, obligatoire dans chaque tranche ci-dessous qui touche une donnee d'organisation.

| # | Tranche | User story(ies) | Depend de | Pourquoi cet ordre |
|---|---|---|---|---|
| 001 | Creation d'organisation et compte owner | US-01 | aucune | Fondation : toute autre tranche suppose une organisation et un utilisateur authentifie. |
| 002 | Abonnement et changement de palier | US-08 | 001 | Depend seulement de l'organisation. Placee tot malgre son risque (integration Stripe, argent, source de verite auditable — ADR-0005) car la tranche 005 (quota) a besoin de connaitre le palier courant de l'organisation pour decider d'un refus a 50 liens : c'est une dependance technique reelle, pas seulement un choix de risque. **AC obligatoire : audit-010 MINEUR-2 (D-033), voir Notes.** |
| 003 | Invitation d'un membre | US-02 | 001 | Depend seulement de l'organisation et du role owner. Risque moderat (securite du token d'invitation, fiabilite de l'envoi d'e-mail — ADR-0006), inferieur a celui de la facturation. |
| 004 | Creation d'une collection | US-05 | 001 | Depend seulement de l'organisation. CRUD simple, risque le plus bas de sa couche de dependance : placee en dernier parmi les tranches ne dependant que de 001. |
| 005 | Ajout d'un lien avec quota Free | US-06 | 002, 004 | Depend d'une collection existante (004) et du palier courant (002). **Risque le plus eleve du backlog** : le PRD nomme explicitement (risque #3) la verification de quota non atomique comme le piege le plus probable de cette tranche — a traiter avec le plus de marge possible. |
| 006 | Acceptation d'une invitation | US-03 | 003 | Depend d'une invitation existante (003). Risque securite (validation de token, expiration, rejeu) reel mais suit un patron plus standard que la tranche 005. |
| 007 | Suppression d'une collection (cascade) | US-10 | 004, 005 | Depend d'une collection et de liens a supprimer en cascade dans la meme operation, pour verifier reellement la cascade. Operation irreversible (pas de soft delete) : risque de perte de donnee si la cascade est mal bornee. |
| 008 | Retrait d'un membre | US-04 | 006 | Depend d'un membre reel obtenu par acceptation d'invitation (006), pour tester le retrait sur un membre effectif plutot que sur une donnee de fixture. Contient l'invariant "dernier owner protege" (US-04.3). |
| 009 | Consultation des collections et des liens | US-07 | 004, 005 | Depend de collections et de liens existants pour verifier le tri et l'isolation en lecture sur des donnees reelles. Risque le plus bas du backlog : lecture seule, patron d'isolation deja eprouve par les tranches precedentes. |
| 010 | Durcissement de l'isolation tenant (tranche technique) | US-09 (transverse) | 001 | Decision humaine D-022 (audit-001 MINEUR-1, option A) + MINEUR-10. **Executee avant 002** (D-024) : toutes les tranches suivantes copient le patron `withTenant` et les politiques RLS ; il doit etre juste avant d'etre reproduit. |
| 011 | Montee Next 16 et ESLint 10 (tranche technique) (ESLint 10 reporte, ADR-0013) | transverse | 010 | Decision humaine D-041 : Next 15 arrive en fin de maintenance en octobre 2026 (ADR-0008) ; la migration ne coutera jamais moins cher qu'avec 3 routes. **Executee avant 002.** |

## Ordre d'execution

Les identifiants ne sont jamais renumerotes (D-025) : une tranche inseree prend le prochain numero libre, et l'ordre d'execution est ecrit ici.

001 (close) -> 010 (close) -> 011 (close) -> 002 (close) -> **003** -> 006 -> 004 (en mode autonome) -> 005 -> 012 (ecrans)

Objectif A (D-083, D-084) : la sequence ci-dessus termine l'usine. 007, 008 et 009 sont hors objectif (backlog), avec la mise en ligne et les vrais paiements.

Tranche **012 — Ecrans** (nouvelle, prochain numero libre selon D-025) : page de connexion et d'inscription, page de l'organisation (palier, membres, collections), page d'une collection et de ses liens. Depend de 001 a 006. Cadrage a ecrire a son ouverture.

## Tranche 010 — cadrage (decision D-022)

**Objectif.** Faire de RLS une seconde barriere reelle. Aujourd'hui les politiques des tables a `organization_id` comparent la ligne au contexte `app.organization_id`, que le serveur pose a partir d'une valeur que l'appelant peut choisir (parametre d'URL) : elles valident ce que l'appelant demande. Apres 010, une ligne n'est visible ou modifiable sous `signet_app` que si **l'utilisateur de session** (`app.user_id`, pose par le serveur depuis la session authentifiee, jamais depuis la requete) est **membre** de l'organisation du contexte.

**Conception.** Laissee a `db-architect`, dans un ADR-0011 qui : compare les options (fonction de contexte qui verifie l'appartenance, predicat d'appartenance dans chaque politique, etc.), traite explicitement le risque de recursion des politiques sur `member` (une politique de `member` qui interroge `member`), le cout (index `member(user_id, organization_id)`), et amende le point 4 d'ADR-0004. ERD mis a jour. Nouvelle migration uniquement (0001 a 0008 sont dans `main`, donc immuables).

**MINEUR-10 inclus.** Une migration reimpose les attributs des quatre roles `signet_*` (`ALTER ROLE ... NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, `LOGIN`/`NOLOGIN` selon ADR-0007). Le test de catalogue de l'usine 1.4 (`tests/_factory/db-catalog.test.ts`) verifie qu'aucun role applicatif n'est `SUPERUSER` ou `BYPASSRLS`, directement ou par heritage.

**Criteres d'acceptation attendus** (a reprendre dans `docs/03-slices/010-*.md`) :
- AC1 — non-regression : un membre accede a son organisation exactement comme avant ; toute la suite de la tranche 001 reste verte **sans modifier ses assertions**.
- AC2 — contexte force : sous `signet_app`, avec `app.organization_id` = organisation B et `app.user_id` = un membre de A seulement, toute lecture de `organization`, `member`, `organization_link_usage` et de toute autre table a `organization_id` renvoie 0 ligne, et toute ecriture est refusee. Teste directement en base, **sans** passer par le controle d'appartenance applicatif.
- AC3 — echec ferme : sans `app.user_id` (ou avec un utilisateur inconnu), aucune ligne visible et aucune ecriture, meme avec un `app.organization_id` valide.
- AC4 — fonctions a privileges : les fonctions `SECURITY DEFINER` gardent leurs garanties (tests d'invariants de 001 verts) et echouent bruyamment la ou elles dependent d'un utilisateur de session absent.
- AC5 — isolation tenant par l'API : `PATCH /api/organizations/:idB` par un membre de A seulement donne la meme reponse qu'une organisation inexistante, et rien ne change en base.
- AC6 — roles : attributs des quatre roles reimposes par migration ; test de catalogue vert, en local et en CI.

**NE touche PAS.** Aucune capacite utilisateur nouvelle, aucune route nouvelle, aucune forme de requete ou de reponse modifiee (`contract-guardian` doit rendre PASS), rien de Stripe, des invitations ni des liens.

## Tranche 011 — cadrage (decision D-041)

**Objectif.** Passer le socle web sur la ligne maintenue : `next` 16 (derniere stable du registre, pas de pre-version), `eslint-config-next` de la meme ligne, ESLint 10 si compatible (sinon la derniere 9.x, avec l'erreur reproduite dans l'ADR), `eslint.config.mjs` reecrit dans le format natif de la ligne 16. Les PR Dependabot #7 et #9 deviennent sans objet.

**Documentation.** ADR-0013 : versions retenues (registre a l'instant, date de publication), liste des changements cassants du guide officiel de migration de Next 16 et traitement de chacun, compatibilite verifiee de `better-auth`, de React et de `drizzle`. Il remplace la partie « ligne Next 15 » d'ADR-0008 et la partie ESLint d'ADR-0009.

**Criteres d'acceptation attendus** (a reprendre dans `docs/03-slices/011-*.md`) :
- AC1 — versions : `next` et `eslint-config-next` 16.x stables, epinglage exact, ADR-0013 ; aucune exception a la regle de pnpm sur les versions de moins d'un jour.
- AC2 — non-regression : suite complete verte **sans modifier aucune assertion**, `pnpm run check` et `pnpm run build` verts, CI verte.
- AC3 — contrats : reponses de `/api/auth/*` et `/api/organizations*` inchangees (`contract-guardian` PASS).
- AC4 — securite : `pnpm audit --prod` propre ; les regles de securite existantes (limiteur ADR-0010, en-tetes, validation) intactes.
- AC5 — isolation tenant : les tests d'isolation des tranches 001 et 010 restent verts, inchanges.
- AC6 — Dependabot : `.github/dependabot.yml` ignore les montees majeures de `@types/node` tant que `.nvmrc` reste sur 24 (D-040).

**NE touche PAS.** Aucune capacite nouvelle, aucune migration de base, aucun changement de contrat d'API. Pas de montee majeure de React sauf si Next 16 l'exige (alors ADR).

## Notes

- **Objectif A (D-083, 2026-10-20, remplace D-074)** : l'usine est terminee quand sont faits : usine 1.6.1 adoptee ; tranche invitations (fausse messagerie en test, aucun fournisseur reel) ; tranche collections realisee en mode autonome ; tranche quota de 50 liens ; tranche ecrans (connexion et pages principales) ; un second projet demarre avec l'usine sans la modifier. Puis une presentation et un etat des lieux complet. **Hors objectif, au backlog** : mise en ligne, vrais paiements, autres tranches de Signet. Ecarte : (B) Signet complet et en ligne.
- ~~Plan de la semaine du 2026-10-19 (D-074)~~, remplace par D-083 : toutes les fonctionnalites de Signet d'ici vendredi, mise en ligne visee le week-end, sans supprimer aucun controle (tests, trois relecteurs, accord humain). **Paiements (D-075)** : l'abonnement payant est conserve ; les vrais paiements seront actives apres la validation du compte Stripe, le lancement pouvant se faire en formule gratuite.

- Aucune tranche ne couvre l'edition de lien/collection ni la suppression d'un lien isole : hors-perimetre explicite du PRD (US-10 ne couvre que la suppression d'une collection entiere).
- Toute tranche qui ferait apparaitre une fonctionnalite listee en hors-perimetre (recherche, tags, import Slack, etc.) est un signal du risque #1 du PRD (derive de perimetre) et doit etre refusee ou renvoyee en backlog explicite, pas glissee dans une tranche existante.
- Avant tout choix d'hebergement (audit-001 MINEUR-11) : fixer l'en-tete IP de confiance et les proxys de confiance de better-auth (`advanced.ipAddress.ipAddressHeaders`/`trustedProxies`) et le consigner dans ADR-0010. Sans cela, le limiteur de debit est contournable ou bloque tous les utilisateurs selon le proxy.
- ~~Migration 0009 (audit-001 MINEUR-10)~~ : integree a la tranche 010 (D-024).
- **Critere d'acceptation obligatoire de la tranche 002 (audit-010 MINEUR-2, decision humaine D-033)** : les fonctions `SECURITY DEFINER` voient le contexte brut `context_org()`, choisi par l'appelant. Ecrire dans ADR-0011 la regle « toute fonction definer executable par `signet_app` pose son contexte depuis une valeur de confiance ou filtre sur `current_user_id()` en premiere instruction », avec un test par fonction sous contexte etranger force (modele d'AC2 de 010). 002 ajoutera les premieres fonctions definer depuis 010.
- audit-010 MINEUR-1 (reconduit d'audit-001 MINEUR-2) : `REVOKE INSERT ON organization FROM signet_app` par migration, avec assertion de catalogue sur les privileges de table de `signet_app`. Effet attendu : la precondition « `signet_app` a le droit INSERT » des tests AC2/AC3 d'`INSERT` de `tests/isolation-hardening/rls-membership.test.ts` echouera ; ces tests deviennent alors des tests de privilege (refus par GRANT) a reecrire dans la meme tranche.
- ~~audit-010 INFO-1~~ : traite dans la tranche 002 (migration `0011_billing_role.sql`, D-064). Etendre l'assertion de roles de 0010 au sens inverse (`pg_auth_members.roleid` parmi les `signet_*`) et a `pg_db_role_setting`, a la prochaine migration de roles.
- Poste de developpement (constat humain du 2026-10-15, D-067) : `.env` ne porte que `DATABASE_URL` sous le superutilisateur, aucune URL de role. A aligner sur `.env.example` (une URL par role `signet_*`, `DATABASE_URL_MIGRATE` a part) **avant tout essai manuel de Stripe** ou de `pnpm dev` ; procedure : `docs/04-runbooks/stripe-facturation-locale.md` § 1, etape 4. Action humaine (fichier local, jamais lu par un agent).
- audit-002 MINEUR-1 (D-071) : aucune limite de debit sur `POST /api/organizations/:id/subscription` ; chaque `{ tier: "pro" }` sur un Free cree une session Checkout dans le compte Stripe commun a tous les tenants (limite de debit du compte, ~20 s de requete au pire). Limiteur par utilisateur et par organisation a stockage partage, ou reutilisation d'une session Checkout encore ouverte. A traiter avec audit-001 MINEUR-5 (organisations sans plafond).
- review-002 suggestion 5 (D-072) : `metadata.canceled_by` n'est jamais efface. Le jour ou la reactivation d'une annulation programmee sera livree (Q-4, hors tranche 002), elle devra effacer `canceled_by` chez Stripe ; sinon une resiliation ulterieure par Stripe seul (impaye) serait attribuee a l'owner qui avait annule puis reactive.
- audit-002 INFO-3 (D-071, prolonge Q-7) : un double Checkout paye laisse un second abonnement actif et facture chez Stripe, refuse en SG006 sans compensation. Alerte d'exploitation, ou annulation automatique de l'abonnement orphelin (decision humaine).
- review-002 cinquieme relecture, suggestion 1 (D-078) : `onFailure` ecrit une ligne d'erreur « a reprendre a la main » aussi apres un refus definitif (`NonRetriableError` : SG003 a SG006, abonnement introuvable), ce qui brouille la gradation de D-071. Dans `reportAbandonedEvent`, distinguer le refus definitif (deja journalise par `logRejection`) de l'epuisement des relances, apres avoir verifie que le nom de l'erreur survit a la serialisation d'Inngest ; ADR-0016 a mettre a jour.
- review-002 cinquieme relecture, suggestion 2 (D-078) : le cablage de `onFailure` n'est garde que par le typage. Appeler `getProcessStripeEvent().opts.onFailure` avec une charge `inngest/function.failed` construite a la main et verifier que la ligne porte les identifiants de l'evenement d'origine (`tests/billing/review-corrections.test.ts`).
- review-002 cinquieme relecture, suggestion 3 (D-078) : ADR-0016 « Limites restantes » ne nomme pas le recul de l'horloge de la base (etats juges `stale` pendant le recul, signal : lignes `stale` au journal) ; ligne 63, « milliseconde » devient « microseconde ».
- review-002 cinquieme relecture, suggestion 4 (D-078) : deux formulations perimees dans `docs/00-context/journal/14-tranche-002-abonnement-palier.md` (lignes 24 et 42 : « deux series de relectures », « Decision humaine » deja prise).
- review-002 cinquieme relecture, suggestion 5 (D-078) : commits de la Phase 7 crees en lot, test apres le code. Rien a reecrire ; pour les tranches suivantes, test d'abord et commit au fil de l'eau (`rules/git.md`).
- ~~audit-010 INFO-2~~ : traite dans la tranche 010 (37c213f). Inclure les politiques `TO PUBLIC` (`0 = ANY(pol.polroles)`) dans les invariants de catalogue `current_org(`/`context_org(` de `tests/isolation-hardening/definer-functions.test.ts`.
- ~~audit-010 INFO-3~~ : traite dans la tranche 010 (37c213f). Le test AC4 « owner different » devrait utiliser l'owner reel d'une autre fixture plutot qu'un UUID sans `app_user`.
- review-010 SUGGESTION-1 : les tests AC3 de 010 sur `organization_link_usage`, `subscription` et `app_user` n'assertent pas l'existence prealable des lignes (vraie aujourd'hui) ; ajouter cette precondition si une tranche change leur creation.
- audit-010 INFO-4 / ADR-0011 : la RLS verifie l'appartenance, pas le role ; durcir `UPDATE organization` au role owner en RLS reste une option (hors D-022).
- ~~Corriger `.claude/rules/drizzle-postgres.md:22`~~ : fait dans l'usine 1.4.0 (revocation sans `FOR ROLE` ni `IN SCHEMA`, visant le role qui cree les fonctions).
- Reevaluer ESLint 10 : **reporte par la tranche 011** (ADR-0013). Next 16.3.7 est en place, mais ESLint reste en 9.39.5 : sous ESLint 10.11.0, `eslint-plugin-react@7.37.5` (derniere version, charge par `eslint-config-next@16.3.7`) echoue (`contextOrFilename.getFilename is not a function`) et `eslint-plugin-import`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react` bornent leur pair `eslint` a 9. Declencheur : une version de ces greffons acceptant `eslint` 10, reprise par `eslint-config-next`. Effet sur Dependabot : voir la ligne « politique Dependabot pour `eslint` 10 » ci-dessous.
- Monter `next` + `eslint-config-next` en 16.3.8 (version de securite, 7 avis, ADR-0013) **dans les 48 h** : des la fin de la quarantaine pnpm (2026-10-01 vers 16:07Z), echeance 2026-10-02 vers 16:13Z, sans exclusion `minimumReleaseAgeExclude` (audit-011 MINEUR 1).
- Politique Dependabot pour `eslint` 10 : le groupe `majeures` le contiendra chaque semaine et bloque ainsi les autres majeures du groupe ; options : `ignore` `semver-major` d'`eslint` (modele `@types/node`, D-040) ou refus manuel ecrit au registre (review-011 A CORRIGER 1, decision humaine).
- Egalite `next` = `eslint-config-next` (AC1 de 011) face aux PR de securite Dependabot, qui ne montent que `next` : procedure manuelle ecrite dans ADR-0013 ; alternatives : groupe Dependabot dedie couvrant la securite, ou test relache a majeure.mineure (audit-011 MINEUR 2, review-011 A CORRIGER 2, decision humaine).
- Tester le filtre des ignores globaux d'`eslint-config-next` dans `eslint.config.mjs` (liste filtree attendue, ou au minimum `isPathIgnored("out/x.ts")` faux) (review-011 SUGGESTION 3).
- Tester les options de `ban-ts-comment` (`ts-expect-error`, `ts-ignore`, `ts-nocheck` a `true`), pas seulement sa severite, dans `tests/stack-upgrade/lint-scope.test.ts` (review-011 SUGGESTION 4).
- Rendre le test Dependabot structurel (parseur YAML, si une dependance est actee) ou au minimum controler l'indentation d'`ignore:` par rapport a `groups:` (review-011 SUGGESTION 5).
- Tester la reponse 405 sur une methode non exportee des Route Handlers : comportement de Next non fixe par un test (contracts-011, point non couvert).
- **Issus de la tranche 003 (D-086, ADR-0017)**, hors objectif A sauf mention :
  - fournisseur d'e-mails reel (domaine d'envoi, SPF/DKIM, e-mail HTML eventuel) ; verifier qu'il respecte `Idempotency-Key` (double envoi residuel, ADR-0017 §5) ;
  - **limite d'envois par organisation et par owner, prealable au fournisseur reel** (D-086 Q-4), a traiter avec audit-001 MINEUR-5 et audit-002 MINEUR-1 ;
  - **audit-003 MINEUR-1, prealable au fournisseur reel (D-095)** : le nom d'organisation, texte libre de l'owner (URL acceptees), est repris dans le corps de l'e-mail d'invitation (`lib/invitations/email.ts`) ; le delimiter clairement comme contenu fourni par un utilisateur, ou filtrer URL et domaines dans le nom. Inoffensif sans fournisseur ; **devient MAJEUR avec le fournisseur reel** (hameconnage depuis le domaine d'envoi de Signet) ;
  - **audit-003 MINEUR-2, prealable au fournisseur reel (D-095)** : la connexion `signet_app` reste tenue jusqu'a 5 s pendant la mise en file (`withTenant` englobe `sendEventWithDeadline`, choix D-086 Q-3) ; un incident Inngest amplifie par des emissions paralleles epuise le pool. A inclure dans la limite par organisation et par owner ci-dessus, avec un plafond de mises en file simultanees sur la route d'emission ;
  - renvoi manuel d'une invitation (nouvel evenement scelle, jamais relecture d'un secret) et revocation (colonne `revoked_at`, revue de `invitation_pending_idx`, ADR-0003 « Signal de reexamen ») ; liste des invitations en attente par l'API (aucune route de lecture en 003). Tant que le renvoi manque, un envoi abandonne bloque l'adresse jusqu'a l'expiration (7 jours) ;
  - purge periodique des invitations perimees (cron Inngest sur `invitation_expires_idx`) ; la seule purge actuelle est celle de `create_invitation`, pour le couple reinvite ;
  - rotation de `INVITATION_TOKEN_KEY` : une nouvelle cle rend inouvrables les evenements en attente (envoi abandonne, journalise) ; procedure a double cle (identifiant de cle dans le `sealedToken`) ;
  - ~~pour 006 : `accept_invitation` doit figer `TimeZone = 'UTC'`~~ : fait dans la tranche 006 (migration 0015, AC4).
- **Issus de la tranche 006 (D-102, ADR-0018)**, hors objectif A sauf mention :
  - **P-6** : limiteur de debit propre a `POST /api/invitations/accept` (aucun aujourd'hui : jeton de 256 bits, session exigee, inscription et connexion deja limitees par ADR-0010) ; **obligatoire si P-4 est rouvert** (lecture d'invitation sans session) ; stockage partage, pas le limiteur memoire de better-auth (route Next hors better-auth) ;
  - **P-4, a rouvrir par la tranche 012** si l'ecran doit afficher l'invitation (nom de l'organisation) avant connexion : `lookup_invitation` exige aujourd'hui un utilisateur de session (`SG002`) ; la rouvrir impose P-6 ;
  - verification d'adresse par better-auth (`email_verified`) puis exigence de `email_verified` dans `accept_invitation` : leve la limite des adresses non verifiees d'ADR-0018 ; changement d'adresse d'un compte (ADR-0018, « Signal de reexamen ») ;
  - organisation active en session (`session.active_organization_id`) apres acceptation : tranche 012 ;
  - review-006 SUGGESTION 1 : `lower()` de Postgres (depend du `ctype`, ASCII seul sous `C`) contre `toLowerCase()` de JS pour le rapprochement d'adresse ; aujourd'hui masque par la normalisation de better-auth ; documenter dans ADR-0018 ou tester une adresse non ASCII en casse mixte ;
  - review-006 SUGGESTION 2 : D-105 et ERD §1 ne disent pas que l'effacement de `app.organization_id` en entree detruit le contexte d'un appelant en transaction tenant (echec ferme mais silencieux) ;
  - review-006 SUGGESTION 3 : le test AC14 ne balaie que le dossier de la route ; l'etendre a `lib/invitations/accept.ts` et `token.ts` (nom de `INVITATION_TOKEN_KEY`) ;
  - review-006 SUGGESTION 4 : apres la restriction Q-3, une politique `TO signet_auth`/`signet_billing`/`signet_owner` sur `invitation` n'est plus detectee ; affirmer dans `tests/invitation-acceptance/catalog.test.ts` que les roles des politiques de `invitation` sont contenus dans `{signet_app, signet_definer}` ;
  - review-006 SUGGESTION 5 : code mort dans `tests/helpers/invitations-accept.ts` (`signUpWithEmail` inutilise ; `.replace(/\.TEST$/, ".TEST")` sans effet dans `mixedCase`) ;
  - review-006 (reouverture) SUGGESTION 1 (D-112) : dans `tests/helpers/invitations-accept.ts`, `waitForAcceptBlockedOnLock` accepte toute session qui execute `accept_invitation` et attend un verrou ; filtrer sur `pg_blocking_pids(pid) @> ARRAY[<pid de la connexion qui supprime le compte>]` (lu par `pg_backend_pid()`), retirer le `SET LOCAL lock_timeout` inutile ; sinon un faux positif ferait perdre la preuve de `23503` (D-108) sans faire echouer le test ;
  - review-006 (reouverture) SUGGESTION 3 (D-112), pour l'usine : preuves par mutation rejouables (outil de mutation cible, ou script qui applique chaque mutation consignee et attend un echec) ;
  - audit-006 INFO-1 : adresse non verifiee (limite d'ADR-0018) a reexaminer avec le fournisseur d'e-mails reel, avec les prealables d'audit-003 ; audit-006 INFO-2 : voir P-6 ci-dessus.
- **Issus de la tranche 004 (D-114)** :
  - `db-architect` : l'ERD §6.1 ne prevoit pas d'index sur `collection.created_by_user_id` (`ON DELETE RESTRICT`), alors que §6.2 justifie `link_author_idx` par la meme contrainte ; sans effet tant qu'aucune suppression de compte n'existe (ERD §10), a trancher avant toute suppression de compte.
  - FRICTION 2026-10-26 : `tests/billing/webhook.test.ts` AC7 peut recevoir un evenement d'invitation tardif d'un test de 003 (faux Inngest partage) ; isoler les corps par test ou attendre la fin des envois tardifs du test AC13 de 003.
  - **Pour 007 (D-122, tranche 005)** : dans la meme migration que le `GRANT DELETE` sur `link`, creer la branche `AFTER DELETE` du trigger de compteur (ERD §7 : decrement inconditionnel, tolerant a l'absence de ligne) et `signet.recompute_link_usage(org_id)` (ADR-0002), avec le test `link_count = count(*)` apres cascade ; ajouter les noms aux listes fermees des fonctions definer (D-121).
  - **Pour 007 (review-004 SUGGESTION 2, D-116)** : la politique `collection_isolation` est `FOR ALL` sans condition de role ; le `GRANT DELETE` de 007 la fera couvrir `DELETE`, et la restriction owner (US-10.2) ne sera qu'applicative. `db-architect` tranche avant 007 : politique `DELETE` dediee avec role owner (patron `invitation_owner_*`) ou barriere applicative seule assumee.
  - review-004 SUGGESTION 3 : `lower()` suit le `LC_CTYPE` de la base ; en locale `C`, « Équipe » et « équipe » sont deux noms distincts. Ecrire la locale requise dans l'ERD (`db-architect`) et ajouter un cas accentue a AC3.
  - review-004 SUGGESTION 4 : D-113 (60 s) peut ne pas suffire (FRICTION 2026-10-26, premier passage) ; capturer le message complet a la prochaine occurrence avant toute autre decision.
  - review-004 SUGGESTION 5 : le corps d'un commit qui touche un test deja ecrit cite la decision qui l'autorise (D-115, regle de lint).
  - **audit-004 MINEUR-1** : aucune limite de debit sur `POST /api/organizations/:id/collections` ; limiteur a stockage partage par utilisateur et organisation, avec audit-001 MINEUR-5 et audit-002 MINEUR-1. **Plafond de collections par organisation (ou par palier) : decision produit humaine**, non prise.
  - audit-004 INFO-1 : `pnpm audit` complet rouge par la copie de developpement de `next` 16.3.8 (`@inngest/test > inngest`) et `zod` < 4.6.6 (`eslint-config-next`) ; `--prod` vert. Branche `chore/` avec `overrides` (precedent D-050).
  - audit-004 INFO-2 : nom de collection libre en Unicode (bidi, zero-largeur) ; tranche 012 : affichage echappe, jamais dans un attribut `href`.
- Le detail complet de chaque tranche (perimetre fichiers, contrat de donnees, contrat d'API, criteres d'acceptation AC1-AC5, anti-regression) est ecrit au moment de son ouverture, au format `templates/SLICE.md`, dans `docs/03-slices/<id>-<nom>.md`.

## Questions d'architecture ouvertes

Decisions qui ne bloquaient pas la cloture de la tranche qui les a fait apparaitre (aucun constat CRITIQUE ni MAJEUR associe), mais qui doivent etre tranchees avant que d'autres tranches ne reproduisent le meme patron.

### MINEUR-1 (audit-001.md, tranche 001) — La RLS n'est pas une defense en profondeur pour les routes a `organizationId` dans le chemin

**Constat** : dans `apps/web/src/lib/db.ts` (`withTenant`), le contexte tenant (`SET LOCAL app.organization_id`) est pose **avant** d'invoquer la fonction appelante, a partir de la valeur `organizationId` que celle-ci lui passe. Pour `PATCH /api/organizations/:organizationId` (`apps/web/src/lib/organizations.ts`, `renameOrganization`), cette valeur vient directement du parametre d'URL — entierement choisie par l'appelant, validee seulement pour sa forme (UUID) par le schema Zod, jamais pour son appartenance avant cet appel. La verification d'appartenance (`SELECT role FROM member WHERE organization_id = $1 AND user_id = $2`) s'execute *ensuite*, a l'interieur de la transaction, donc *apres* que le contexte RLS ait deja ete pose sur l'organisation demandee par l'attaquant.

**Consequence exacte** : les politiques RLS `organization_id = signet.current_org()` deviennent tautologiques dans ce chemin — elles valident l'organisation que l'appelant vient de demander, pas celle a laquelle il appartient reellement. La seule protection reelle contre un acces inter-tenant est le filtre explicite `AND user_id = $2` de cette unique requete. AC5 passe aujourd'hui parce que cette requete est bien ecrite, mais ADR-0004 (point 4) affirme que « le filtre `organization_id` explicite et la politique RLS restent la defense de dernier recours si une des etapes precedentes est contournee par une erreur de code » — cette propriete ne tient pas avec un contexte derive du chemin : une route future qui lirait `member`, `organization` ou `organization_link_usage` avant (ou sans) le controle d'appartenance obtiendrait un acces inter-tenant complet, sans qu'aucune politique ne s'y oppose. Cette tranche est le gabarit que toutes les suivantes copieront — a trancher **avant la tranche 002**, qui reutilisera le meme patron `withTenant`.

**Options identifiees (audit-001.md, non arbitrees)** :
1. Poser `app.organization_id` seulement *apres* la verification d'appartenance (le controle redevient anterieur au contexte, la RLS redevient un filet reel).
2. Deriver le contexte de `session.active_organization_id` (ERD §2.2 : « c'est cette colonne qui alimente le `SET LOCAL app.organization_id` ») plutot que du parametre d'URL.
3. Conserver le patron actuel (Option B d'ADR-0004), mais corriger le point 4 d'ADR-0004 pour ne plus presenter la RLS comme une defense independante sur ces routes, et rendre le controle d'appartenance obligatoire et teste pour chaque route qui touche une ressource a `organizationId` dans le chemin.

**Tranche le 2026-09-28 par l'humain : option A** (les politiques verifient aussi l'appartenance de l'utilisateur de session), registre D-022. Realisation : tranche 010.
