# 001 — Creation d'organisation et compte owner

## Capacite
En tant que responsable d'equipe authentifie, je peux creer une organisation et en devenir automatiquement owner, afin de commencer a utiliser le produit (US-01).

## Perimetre
- **Touche** : inscription/session better-auth (email+mot de passe, UUIDv7), creation d'organisation (`POST /api/organizations`), renommage d'organisation par l'owner (`PATCH /api/organizations/:id`), et l'amorçage d'infrastructure necessaire (workspace pnpm, app Next.js, schema Drizzle, migrations 1 a 3 de l'ERD : roles/schema `signet`, tables d'authentification, `organization`/`member`/`organization_link_usage`/`subscription`/`quota_for_tier`).
- **NE touche PAS** :
  - invitations (tranche 003) ni acceptation d'invitation (tranche 006) — aucune table `invitation`.
  - collections et liens (tranches 004, 005, 007, 009) — aucune table, route ni UI.
  - logique metier de facturation et changement de palier (tranche 002) — `subscription` est creee avec sa RLS complete (obligation d'invariant ERD, la ligne est instanciee par le trigger de creation d'organisation) mais aucune route `GET/PATCH` d'abonnement, aucun webhook Stripe. La table `billing_event` elle-meme n'est pas creee ici (aucune dependance d'invariant vers `organization`) : elle appartient a la tranche 002.
  - logique de quota (tranche 005) — `organization_link_usage.link_count` reste a 0, aucun trigger sur `link` (la table n'existe pas encore).
  - retrait de membre (tranche 008) — le trigger `member_keep_last_owner` est cree ici car il protege `member` des sa creation, mais aucune route de retrait n'est exposee.
  - SSO, changement de mot de passe, recuperation de compte, selecteur multi-organisation — hors perimetre PRD ou non couverts par US-01.

## Dependances
- Tranches devant etre closes avant celle-ci : aucune (premiere tranche du backlog).

## Contrat de donnees
| Table | Colonnes ajoutees / modifiees | Contraintes et index |
|---|---|---|
| `app_user` | `id, email, email_verified, name, image, created_at, updated_at` | `UNIQUE (lower(email))` ; RLS `SELECT` via co-appartenance `member` |
| `session`, `account`, `verification` | structure better-auth (ERD §2.2) | `UNIQUE(token)`, `UNIQUE(provider_id, account_id)` ; RLS `ENABLE/FORCE`, aucun acces `signet_app` |
| `organization` | `id, name, slug, created_at, updated_at` | `UNIQUE(slug)` ; RLS `id = current_org()` ; trigger `AFTER INSERT` cree `organization_link_usage` + `subscription` |
| `member` | `id, organization_id, user_id, role, created_at` | `UNIQUE(organization_id, user_id)`, `UNIQUE(organization_id) WHERE role='owner'` (`member_single_owner_idx`) ; trigger `member_keep_last_owner` (constraint trigger, deferred) ; RLS `organization_id = current_org()` |
| `organization_link_usage` | `organization_id (PK), link_count=0, link_quota=50, updated_at` | RLS lecture seule `organization_id = current_org()` ; ecriture reservee aux triggers `signet_definer` (hors perimetre de cette tranche) |
| `subscription` | `organization_id (PK), tier='free', status='active', stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, created_at, updated_at` | `CHECK` coherence tier/stripe/periode ; RLS owner uniquement (jointure `member`) |

Fonctions `SECURITY DEFINER` (liste fermee ERD §1, `search_path` fixe, role `signet_definer`) : `signet.create_organization(owner_user_id, org_name)`, `signet.organizations_for_user(user_id)`.

**Ecart assume vis-a-vis de `CLAUDE.md` ("jamais de SQL manuel")** : la structure des tables passe par `pnpm db:generate`/`pnpm db:migrate` comme toute tranche. Les politiques RLS, triggers et fonctions `SECURITY DEFINER` ci-dessus sont ecrites a la main dans des migrations SQL versionnees, conformement a l'en-tete de l'ERD et a ADR-0001/ADR-0002 — regle du projet, pas une exception locale.

## Contrat d'API
| Route | Methode | Entree | Sorties | Role minimal | Idempotent sur |
|---|---|---|---|---|---|
| `/api/organizations` | POST | `{ name }` | `{ id, name, slug, createdAt, role: "owner" }` | `public` (authentifie, sans organisation) | non-idempotent (chaque appel cree une organisation ; assume, aucune dedup exigee par le PRD) |
| `/api/organizations/:organizationId` | PATCH | `{ organizationId, name }` | `{ id, name }` | `owner` | `(organizationId, name)` |

Erreurs contractuelles (`docs/02-architecture/api-contracts/organizations.ts`) : `401 UNAUTHENTICATED`, `422 VALIDATION_FAILED` (creation) ; `401 UNAUTHENTICATED`, `404 ORGANIZATION_NOT_FOUND`, `403 INSUFFICIENT_ROLE`, `422 VALIDATION_FAILED` (renommage). `slug` est derive server-side de `name` (slugification + suffixe sur collision), jamais saisi par l'utilisateur.

## Criteres d'acceptation
- [ ] AC1 — Creation nominale (US-01.1) : un utilisateur authentifie sans organisation `POST /api/organizations` avec un `name` valide (1-120 caracteres apres trim) ; la reponse contient `role: "owner"` ; en base, `member(role='owner')`, `organization_link_usage(link_count=0, link_quota=50)` et `subscription(tier='free', status='active')` existent pour cette organisation dans la meme transaction que sa creation.
- [ ] AC2 — Renommage et permission insuffisante (US-01.2) : le nom n'est modifiable que par l'owner ; un `member` qui tente `PATCH /api/organizations/:id` recoit `403 INSUFFICIENT_ROLE` et le nom n'est pas modifie.
- [ ] AC3 — Cas limites : (a) doublon — deux organisations distinctes peuvent porter le meme `name` (aucune contrainte d'unicite dessus), une collision de `slug` genere est resolue par un suffixe numerique deterministe sans jamais lever une 500 ; (b) concurrence — deux `POST /api/organizations` simultanes pour le meme utilisateur avec un `name` identique produisent deux organisations distinctes avec des slugs distincts (retry applicatif sur violation d'unicite) ; (c) valeur absente/invalide — `name` vide, uniquement des espaces, `> 120` caracteres, ou `organizationId` non-UUID retourne `422 VALIDATION_FAILED` sans creer ni modifier d'organisation ; (d) expiration — sans objet pour cette tranche (aucune ressource a duree de vie limitee creee par US-01 ; la purge `session`/`verification` est un job Inngest hors perimetre).
- [ ] AC4 — Appartenance garantie (US-01.3) : immediatement apres inscription et creation de son organisation, `signet.organizations_for_user` retourne au moins une organisation pour cet utilisateur ; aucun etat intermediaire ou l'utilisateur est authentifie sans organisation au-dela de la fenetre transactionnelle de creation. Toute tentative de creation ou de renommage sans session valide retourne `401 UNAUTHENTICATED`.
- [ ] AC5 — **Isolation tenant** (obligatoire, US-09) : un owner de l'organisation A qui tente `PATCH /api/organizations/:idB` sur l'organisation B recoit `404 ORGANIZATION_NOT_FOUND` (jamais `403` — US-09.2, la RLS rend la ligne invisible). Un utilisateur membre de A ne peut lire ni modifier aucune ligne `organization`, `member`, `organization_link_usage` ou `subscription` de B, verifie par requete directe sous `signet_app` avec `SET LOCAL app.organization_id` pose sur A.

## Anti-regression
- `FORCE ROW LEVEL SECURITY` doit rester actif sur `organization`, `member`, `organization_link_usage`, `subscription` apres chaque migration future — toute tranche qui touche ces tables relance les tests d'isolation de celle-ci (AC5).
- `signet.create_organization()` reste l'unique chemin de creation d'organisation (liste fermee ERD §1) ; aucun chemin alternatif ne doit contourner le trigger qui instancie `organization_link_usage`/`subscription`.
- `member_single_owner_idx` et le trigger `member_keep_last_owner` restent intacts : la tranche 008 (retrait de membre) ne doit introduire aucun chemin de suppression du dernier owner.
- Le contrat `docs/02-architecture/api-contracts/organizations.ts` ne change pas de forme sans passage par `contract-guardian`.

## Notes d'implementation
- Depot entierement vierge (`apps/`, `packages/`, `tests/` vides, aucun `package.json`) : cette tranche porte l'amorçage d'infrastructure (workspace pnpm, app Next.js dans `apps/web`, schema/migrations Drizzle dans `packages/db`) sans logique metier propre a cet amorçage — les tranches suivantes reutilisent ces fondations sans les modifier.
- Postgres 16 n'a pas `uuidv7()` natif : la migration 1 doit definir `signet.uuidv7()` en PL/pgSQL (ERD §0) avant toute table.
- better-auth doit etre configure avec `advanced.database.generateId` produisant un UUIDv7 via cette meme fonction, et `schema.user.modelName = "app_user"`.
- L'ordre des migrations (ERD "Ordre des migrations") est imperatif : (1) roles/schema/fonctions de contexte, (2) tables d'authentification + politiques, (3) `organization`/`member`/`organization_link_usage`/`subscription`/`quota_for_tier`/triggers. Chaque etape inclut sa politique RLS dans la meme migration.
- `organization_link_usage` et `subscription` sont creees ici uniquement parce que l'invariant ERD l'exige (« aucune organisation ne peut exister sans compteur de quota ni sans palier ») — ne pas y ajouter de logique de quota ou de facturation, cf. perimetre.
