# ADR-0004 — Authentification et autorisation par role d'organisation

- **Statut** : accepte
- **Date** : 2026-09-22
- **Phase** : 2 — architecture

## Contexte

Le PRD definit deux roles par organisation (owner, member) avec des permissions distinctes sur cinq actions : gestion des membres, gestion de l'abonnement (owner seul), creation de collection/ajout de lien (owner ou member), consultation (owner ou member). Toute action refusee doit retourner une 403 explicite (US-02.2, US-04.2, US-08.2, US-10.2), jamais un echec silencieux ou une 404 qui masquerait l'existence de la ressource pour un utilisateur legitime mais mal autorise — a distinguer du cas US-09.2 (acces a une ressource d'une autre organisation), qui lui doit retourner 404.

`stack.json` fixe `better-auth` comme brique d'authentification, deja gelee en phase 1. Cet ADR ne rouvre pas ce choix : il precise comment l'autorisation par role s'articule avec l'isolation tenant (ADR-0001) et l'authentification.

## Options envisagees

### Option A — Role stocke sur la session, verifie en middleware global
Le role de l'utilisateur pour l'organisation active est charge une fois et attache a la session/au contexte de requete. Simple, mais le "role pour l'organisation active" suppose une organisation active unique par session — or un utilisateur peut appartenir a plusieurs organisations avec un role different dans chacune. Risque de fuite si l'organisation active n'est pas revalidee a chaque requete contre la ressource ciblee.

### Option B — Role recalcule a chaque requete, a partir de l'organisation de la ressource ciblee
Chaque route/Server Action identifie d'abord l'organisation concernee par la ressource (celle du chemin, ou celle du corps de la requete pour une creation), verifie que l'utilisateur authentifie y appartient, recupere son role pour *cette* organisation precise, puis autorise ou refuse l'action. Aucune notion d' "organisation active" en session. Cout : une requete de verification (ou une jointure) par appel. Benefice : correct meme si l'utilisateur navigue entre plusieurs organisations, et la verification d'appartenance sert aussi de premiere ligne d'isolation tenant (US-09), avant meme le filtre RLS.

## Decision

Option B. Le critere qui tranche : le PRD autorise explicitement un utilisateur a appartenir a plusieurs organisations avec un role different dans chacune (section "Modele de revenu et evenements factures" / role model) ; une session a organisation active unique serait une hypothese silencieuse non justifiee par le PRD. La verification d'appartenance + role se fait donc systematiquement a partir de la ressource, jamais a partir d'un etat de session suppose a jour.

Ordre de verification impose pour toute route touchant une ressource d'organisation :
1. Authentification (utilisateur identifie) — sinon 401.
2. Appartenance a l'organisation de la ressource ciblee — sinon 404 (US-09.2 : ne jamais reveler l'existence de la ressource a un non-membre).
3. Role suffisant pour l'action demandee — sinon 403 (le 403 ne fuit rien de plus que "vous etes membre mais pas autorise", ce que l'utilisateur sait deja puisqu'il est membre).
4. Le filtre `organization_id` explicite dans la requete (regle absolue de `CLAUDE.md`) et la politique RLS (ADR-0001) restent la defense de dernier recours si une des etapes precedentes est contournee par une erreur de code.

## Consequences acceptees

- Chaque route/Server Action doit resoudre explicitement "de quelle organisation s'agit-il" avant toute logique metier — pas de raccourci "l'utilisateur a un seul role, je le lis une fois en session". Cela ajoute une requete d'appartenance systematique, acceptable vu la charge negligeable du PRD.
- Les contrats d'API (`docs/02-architecture/api-contracts/`) doivent documenter pour chaque route le role minimal requis ET le code d'erreur exact selon l'etape ou l'autorisation echoue (401 / 404 / 403), pour que `contract-guardian` puisse detecter une regression sur ce point precis.
- Les Server Actions suivent exactement le meme ordre de verification que les Route Handlers (piege connu du profil `nextjs-drizzle-postgres` : une Server Action est un endpoint public).
- L'invariant "un owner ne peut jamais se retirer lui-meme ni etre retire s'il est le dernier owner" (US-04.3) est une regle metier verifiee en base (contrainte ou transaction), pas seulement en couche applicative — a modeliser par `db-architect`.

## Signal de reexamen

Le PRD introduit une notion de "session avec organisation active persistante" (ex. commutateur d'organisation dans l'UI avec effets de bord serveur), ou une action necessite de verifier le role sur plusieurs organisations a la fois dans une meme requete.
