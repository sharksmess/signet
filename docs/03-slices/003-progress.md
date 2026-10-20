# 003 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : tests ecrits (avant implementation)
- Branche : slice/003-invitation-membre
- Dernier commit : `test(invitations): tests d'acceptation de la tranche 003` (parent : a249ffe chore(slice-003): ouvrir la tranche)
- Prochaine etape : implementer couche par couche (migration `0014_*`, acces donnees, logique metier, API, fonction Inngest) jusqu'a ce que `tests/invitations/**` passe ; ajouter les variables a `.env.example`, `.env.test.example` et au workflow CI (les tests `environment.test.ts` les verifient)

## Couches
- [ ] Migration
- [ ] Acces donnees
- [ ] Logique metier
- [ ] API
- [ ] UI (sans objet : ecrans en tranche 012)
- [ ] Suite complete verte + `pnpm run check`

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

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
- Action humaine attendue avant la premiere execution de la suite : ajouter a `.env.test.local` (valeurs inventees) `TEST_SERVER_ENV_INVITATION_TOKEN_KEY` (32 octets en base64url, 43 caracteres) et `TEST_SERVER_ENV_EMAIL_CAPTURE_URL` (URL locale, port explicite, par exemple `http://localhost:12113`, port de la fausse messagerie). Une seule variable pour la cle : la suite la reporte dans son propre processus par `applyServerEnvToProcess` (`TEST_SERVER_ENV_X` -> `X`). L'implementeur ajoute les memes noms a `.env.test.example` et au workflow CI.
- Les verifications de ce journal ont ete faites avec ces deux variables posees dans le terminal (valeurs inventees), sans toucher `.env.test.local`.

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Gate d'ouverture : D-086 (humain). Decisions locales : D-087 (expediteur et fausse messagerie), D-088 (une seule migration), D-089 (ADR-0017 reserve).
- `create_invitation` sans parametre `p_id` : avec l'option B, le scellement se fait apres l'insertion avec l'`id` retourne par la base ; l'identifiant n'a pas a etre genere cote application.
- Tests : le module de la fonction d'envoi est importe par un chemin tenu dans une constante (`tests/helpers/invitations.ts`), pour que `tsc` reste vert tant que le fichier n'existe pas ; l'echec attendu est « module introuvable » a l'execution.
