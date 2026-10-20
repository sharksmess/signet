# 003 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : **tests verts**. Suite complete : 30 fichiers, 354 tests, 0 echec ; `pnpm run check` vert. AC1 a AC16 coches dans le contrat de tranche
- Branche : slice/003-invitation-membre
- Dernier commit : `87e68ea test(invitations): rolname::text et EMAIL_CAPTURE_URL retiree (D-094)` (puis ce journal)
- Prochaine etape : relecteurs (`security-auditor`, `contract-guardian`, `code-reviewer`), puis `close-slice.sh` — par l'orchestrateur

## Couches
- [x] Migration — `9289cbb` (0014, `tests/helpers/db.ts` : `invitation` au TRUNCATE). `database.test.ts` 19/19 apres `87e68ea` (D-094)
- [x] Acces donnees et logique metier — `c3e1c3e` (`lib/invitations/token.ts`, `contracts.ts`, `invitations.ts`, `env.ts`, `errors.ts`)
- [x] Fonction Inngest et expediteur — `cd18daf` (`lib/inngest/send-invitation-email.ts`, `lib/email/sender.ts`, `lib/invitations/email.ts`, `client.ts`, `/api/inngest`). Verifiee par une sonde temporaire non committee (evenement forge et scelle avec la cle de test : nominal, memorisation, 500, muette, reponse perdue, alteration, autre cle, fournisseur absent, cle invalide : 2/2 verts)
- [x] API — `3b85698` (route `POST`) ; tests corriges `87e68ea` (D-094 : `rolname::text` en 003, `EMAIL_CAPTURE_URL` retiree dans `stubProductionServe` de 002)
- [ ] UI (sans objet : ecrans en tranche 012)
- [x] Suite complete verte + `pnpm run check` — 30/30 fichiers, 354/354 tests

## Tests ecrits : correspondance AC -> fichier
| AC | Fichier | Notes |
|---|---|---|
| AC1 | `tests/invitations/emission.test.ts` | ligne, 7 jours exacts, evenement unique, forme de `sealedToken` |
| AC2 | `tests/invitations/sending.test.ts` | message, lien, `sha256(jeton) = token_hash`, ouverture independante du jeton scelle |
| AC3 | `tests/invitations/sending.test.ts` | cinq lieux de fuite x trois formes du jeton ; 5 alterations du `sealedToken` -> `NonRetriableError` |
| AC4 a-d | `tests/invitations/sending.test.ts` | 500, muette, rejeu, seconde execution, reponse perdue (double envoi) ; texte ADR-0017 dans `environment.test.ts` |
| AC5 a | `tests/invitations/emission.test.ts` | |
| AC5 b-c | `tests/invitations/database.test.ts` | `asTenant` sous `signet_app`, contexte etranger force |
| AC6 | `emission.test.ts` (403, 401) et `database.test.ts` (RLS, fonction) | |
| AC7 | `tests/invitations/emission.test.ts` | 11 entrees invalides, normalisation, champs inconnus |
| AC8, AC9, AC12, AC13 | `tests/invitations/emission.test.ts` | AC9 : purge testee aussi sous `signet_app` dans `database.test.ts` |
| AC10 | `tests/invitations/concurrency.test.ts` | 5 courses, avec et sans ligne expiree |
| AC11 | `tests/invitations/database.test.ts` | `23514`, signature du catalogue |
| AC14 | `sending.test.ts` (expediteur non configure) et `environment.test.ts` (garde du schema) | |
| AC15 | `database.test.ts` (catalogue, migration 0014 sans `SECURITY DEFINER`) et `environment.test.ts` (imports du module d'envoi, transitifs) | les invariants de 010 restent couverts par `tests/_factory/db-catalog.test.ts` |
| AC16 | `sending.test.ts` (cle absente ou mal formee), `environment.test.ts` (schema, dependances inchangees depuis `main`, exemples d'environnement, CI) | |
| Contrat de donnees (ERD §5) | `tests/invitations/database.test.ts` | CHECK, index nommes, cles etrangeres |

Assistants : `tests/helpers/invitations.ts`, `invitations-db.ts`, `invitations-flow.ts`, `tests/invitations/fakes/fake-mailbox.ts`. Le faux Inngest est `tests/billing/fakes/fake-inngest.ts` (importe tel quel).

## Contrat suppose par les tests (a respecter, ou a discuter avec l'humain)
- **Fonction d'envoi** : `apps/web/src/lib/inngest/send-invitation-email.ts` exporte `getSendInvitationEmail()` (patron `getProcessStripeEvent`, D-079), qui retourne la fonction Inngest ; le jeton en clair n'est jamais retourne par un pas.
- **Protocole de l'expediteur vers `EMAIL_CAPTURE_URL`** (non fixe par le contrat de tranche, choisi par les tests, voir l'en-tete de `fake-mailbox.ts`) : `POST` sur l'URL, en-tete `Idempotency-Key: <id de l'invitation>`, corps JSON `{ "to", "subject", "text" }`, succes = tout `2xx`. L'expediteur borne sa requete par un delai d'attente (<= 10 s) : la messagerie muette doit produire une erreur rejouable, pas une suspension.
- **Erreur nommee** : le message de l'erreur non rejouable contient `EMAIL_PROVIDER_NOT_CONFIGURED` (nom ou message, les tests cherchent la chaine dans l'erreur et dans les journaux).
- **Cle** : `INVITATION_TOKEN_KEY` est lue au premier usage (pas par `parseServerEnv` au demarrage : l'environnement de production de 002 reste valide sans elle). Son refus (absente ou mal formee) nomme la variable dans le message d'erreur ou le journal, jamais la valeur. Le test ne fixe ni le lieu ni la rejouabilite du refus.
- **Empreinte** (tranche par l'humain, D-090) : `token_hash = sha256(32 octets du secret, avant encodage base64url)` (ADR-0003). Le test d'AC2 de `sending.test.ts` a ete corrige en ce sens et affirme que l'empreinte du texte ne correspond pas.
- **Texte clair scelle** : les tests acceptent les 32 octets bruts ou la chaine base64url de 43 caracteres (le contrat ne fixe pas ce detail interne) ; ce qui est fixe : `iv(12) || chiffre || etiquette(16)`, AES-256-GCM, donnees authentifiees = `invitationId` en UTF-8, base64url.
- **Evenement** : donnees exactement `invitationId, organizationId, email, organizationName, sealedToken` (aucune cle en plus).
- **Journaux du serveur** : le processus serveur n'est pas capture par les tests ; l'absence du jeton dans les journaux de la route n'est donc verifiee que par construction (le jeton n'est jamais ecrit nulle part ailleurs que dans l'e-mail). Les journaux de la fonction d'envoi, executee dans le processus de test, sont espionnes.
- **Migration** : fichier `packages/db/migrations/0014_*.sql` ; la fonction `signet.create_invitation(p_organization_id uuid, p_email text, p_token_hash bytea)` doit porter exactement ces noms d'arguments ; l'`EXECUTE` n'est accorde qu'a `signet_app` (ni `PUBLIC`, `signet_auth`, `signet_billing`, `signet_owner`).
- **Remise a zero** : `tests/helpers/db.ts` n'a pas ete modifie. Son `TRUNCATE ... organization ... CASCADE` vide deja `invitation` (cle etrangere vers `organization`) ; y nommer `invitation` avant que la table existe ferait echouer toutes les suites existantes. L'implementeur peut l'ajouter dans la couche migration, apres creation de la table.

## Route en attente (a ecrire des que le perimetre est corrige)
Fichier `apps/web/src/app/api/organizations/[organizationId]/invitations/route.ts`, `POST` seul :
session (`auth.api.getSession`, sinon `401`) ; corps JSON objet (sinon `422 VALIDATION_FAILED`) ;
`createInvitation` du contrat (`@/lib/invitations/contracts`) sur `{ ...body, organizationId }`
(le chemin fait autorite) ; `normalizedEmail` sur `parsed.data.email` (sinon `422`) ;
`createInvitation` de `@/lib/invitations/invitations` avec `userId = session.user.id`,
`organizationId` en minuscules, e-mail normalise ; erreur -> `{ code, message }` au statut de
l'erreur ; succes -> `201` avec `{ id, organizationId, email, expiresAt }`. Meme forme que la route
`subscription` de 002.

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
- Action humaine attendue avant la premiere execution de la suite : ajouter a `.env.test.local` (valeurs inventees) `TEST_SERVER_ENV_INVITATION_TOKEN_KEY` (32 octets en base64url, 43 caracteres) et `TEST_SERVER_ENV_EMAIL_CAPTURE_URL` (URL locale, port explicite, par exemple `http://localhost:12113`, port de la fausse messagerie). Une seule variable pour la cle : la suite la reporte dans son propre processus par `applyServerEnvToProcess` (`TEST_SERVER_ENV_X` -> `X`). L'implementeur ajoute les memes noms a `.env.test.example` et au workflow CI.
- Les verifications de ce journal ont ete faites avec ces deux variables posees dans le terminal (valeurs inventees), sans toucher `.env.test.local`.
- **LEVE (D-094, `87e68ea`)** — (implementeur) Defaut de test : `tests/invitations/database.test.ts`, AC15 « invitation a la RLS activee ET forcee... » echoue pour une mauvaise raison. La colonne `roles` (`ARRAY(SELECT CASE ... rolname ...)`) est de type `name[]`, que le pilote `pg` ne decode pas : le test recoit la chaine `'{signet_app}'` et `toEqual(["signet_app"])` echoue. Le test de 002 (`tests/billing/database.test.ts`) a la meme requete mais n'utilise que `.includes`, qui marche sur une chaine. Le test ne contredit pas le contrat : je ne l'ai pas modifie (consigne). Correction proposee (renforce, n'affaiblit pas) : `(SELECT rolname::text FROM pg_roles WHERE oid = o)`. A trancher : autoriser cette correction (ligne au registre, regle D-065 n°2).
- **LEVE (D-094, perimetre `db65158`, route `3b85698`)** — (implementeur) Perimetre : `gate-check.sh` refuse `apps/web/src/app/api/organizations/[organizationId]/invitations/route.ts`. Cause : le hook compare chaque motif par `case "$REL" in $pat)` ; dans `apps/web/src/app/api/organizations/[organizationId]/invitations/*`, `[organizationId]` est une classe de caracteres (un seul caractere), jamais le dossier `[organizationId]`. Essai : une ecriture, refusee ; aucun contournement. Options : ajouter au perimetre `apps/web/src/app/api/organizations/\[organizationId\]/invitations/*` (crochets echappes) ou `apps/web/src/app/api/organizations/*/invitations/*`. Consigne dans FRICTION.md.
- **LEVE (D-094, `87e68ea`)** — (implementeur) Regression de 002 : `tests/billing/environment.test.ts`, AC15 (2 tests `/api/inngest` hors mode developpement) echouent : `Environnement du serveur invalide, demarrage refuse. EMAIL_CAPTURE_URL : acceptee seulement avec APP_ENV=test.` Cause : `stubProductionServe()` appelle `applyServerEnvToProcess()` (qui recopie toutes les `TEST_SERVER_ENV_*`, dont `TEST_SERVER_ENV_EMAIL_CAPTURE_URL` ajoutee pour 003), pose `APP_ENV=production`, et ne retire que `INNGEST_DEV` et `STRIPE_API_BASE_URL`. La garde de `EMAIL_CAPTURE_URL` est exigee par AC14 (teste sur `parseServerEnv`) : le conflit ne se resout pas cote code sans affaiblir AC14. Se produira aussi en CI (la variable y est posee). Option proposee : ajouter `vi.stubEnv("EMAIL_CAPTURE_URL", undefined);` a cote de `vi.stubEnv("STRIPE_API_BASE_URL", undefined);` dans `stubProductionServe` (meme intention : retirer les variables reservees aux tests) ; exige d'ajouter `tests/billing/environment.test.ts` au perimetre et une ligne au registre (D-065 n°2). Autre option : aucune qui garde AC14 et ce test intacts.
- (implementeur) `pnpm db:migrate` sur la base de developpement : refuse, `DATABASE_URL_MIGRATE n'est pas definie` (aucun `.env` charge depuis `packages/db`). Action humaine ; la base de test est migree par le globalSetup.

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Gate d'ouverture : D-086 (humain). Decisions locales : D-087 (expediteur et fausse messagerie), D-088 (une seule migration), D-089 (ADR-0017 reserve).
- `create_invitation` sans parametre `p_id` : avec l'option B, le scellement se fait apres l'insertion avec l'`id` retourne par la base ; l'identifiant n'a pas a etre genere cote application.
- D-091, D-092, D-093 : **validees par l'humain** (message de l'orchestrateur, D-094). D-094 (humain) : levee des trois blocages.
- **D-092** (implementeur) — refus attendus de l'emission sans `throw` : point de sauvegarde autour de `create_invitation`, du scellement et de la mise en file ; `ROLLBACK TO SAVEPOINT` puis `409` ou `503`. Ecartes : exception sentinelle pour declencher le `ROLLBACK` de `withTenant` ; modifier `withTenant` (hors perimetre).
- **D-093** (implementeur) — fonction d'envoi : refus de `INVITATION_TOKEN_KEY` rejouable (redeploiement), jeton inouvrable et fournisseur absent `NonRetriableError` levees hors du pas sur une issue sans secret ; delais 5 s (file, route) et 8 s (envoi HTTP). Ecartes : refus de cle non rejouable ; `NonRetriableError` levee dans le pas.
- Autres choix sans portee de decision : sujet fixe « Invitation a rejoindre une organisation sur Signet » ; caracteres de controle du nom d'organisation remplaces par des espaces dans le corps ; schema `strict` des donnees de l'evenement a la lecture ; `normalizedEmail` (minuscules, 254, forme de `app_user.email`) applique apres le schema du contrat, qui ne borne pas la longueur.
- **D-091** (implementeur) — `signet.create_invitation` porte `SET TimeZone = 'UTC'`. Raison : le DEFAULT `now() + interval '7 days'` et le CHECK ajoutent 7 jours en heure murale du fuseau de la session ; sous Europe/Paris, la semaine du 25 octobre donne 169 h (constate : `lifetime = 608400` au lieu de 604800). Fige en UTC, l'emission dure 168 h exactement quel que soit le fuseau du serveur. Ecartes : `interval '168 hours'` dans le DEFAULT et le CHECK (le CHECK refuserait les lignes d'arrangement des tests, calculees en heure murale, et s'ecarte du texte de l'ERD) ; reglage du fuseau par base ou par role (D-064 : aucun reglage par role ; etat de cluster hors migration). Consequence pour 006 : un `UPDATE` reevalue le CHECK dans le fuseau de la session ; `accept_invitation` devra figer `TimeZone = 'UTC'` lui aussi (note ajoutee a l'ERD §5).
- Tests : le module de la fonction d'envoi est importe par un chemin tenu dans une constante (`tests/helpers/invitations.ts`), pour que `tsc` reste vert tant que le fichier n'existe pas ; l'echec attendu est « module introuvable » a l'execution.
