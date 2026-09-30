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
| 011 | Montee Next 16 et ESLint 10 (tranche technique) | transverse | 010 | Decision humaine D-041 : Next 15 arrive en fin de maintenance en octobre 2026 (ADR-0008) ; la migration ne coutera jamais moins cher qu'avec 3 routes. **Executee avant 002.** |

## Ordre d'execution

Les identifiants ne sont jamais renumerotes (D-025) : une tranche inseree prend le prochain numero libre, et l'ordre d'execution est ecrit ici.

001 (close) -> 010 (close) -> **011** -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 -> 009

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

- Aucune tranche ne couvre l'edition de lien/collection ni la suppression d'un lien isole : hors-perimetre explicite du PRD (US-10 ne couvre que la suppression d'une collection entiere).
- Toute tranche qui ferait apparaitre une fonctionnalite listee en hors-perimetre (recherche, tags, import Slack, etc.) est un signal du risque #1 du PRD (derive de perimetre) et doit etre refusee ou renvoyee en backlog explicite, pas glissee dans une tranche existante.
- Avant tout choix d'hebergement (audit-001 MINEUR-11) : fixer l'en-tete IP de confiance et les proxys de confiance de better-auth (`advanced.ipAddress.ipAddressHeaders`/`trustedProxies`) et le consigner dans ADR-0010. Sans cela, le limiteur de debit est contournable ou bloque tous les utilisateurs selon le proxy.
- ~~Migration 0009 (audit-001 MINEUR-10)~~ : integree a la tranche 010 (D-024).
- **Critere d'acceptation obligatoire de la tranche 002 (audit-010 MINEUR-2, decision humaine D-033)** : les fonctions `SECURITY DEFINER` voient le contexte brut `context_org()`, choisi par l'appelant. Ecrire dans ADR-0011 la regle « toute fonction definer executable par `signet_app` pose son contexte depuis une valeur de confiance ou filtre sur `current_user_id()` en premiere instruction », avec un test par fonction sous contexte etranger force (modele d'AC2 de 010). 002 ajoutera les premieres fonctions definer depuis 010.
- audit-010 MINEUR-1 (reconduit d'audit-001 MINEUR-2) : `REVOKE INSERT ON organization FROM signet_app` par migration, avec assertion de catalogue sur les privileges de table de `signet_app`. Effet attendu : la precondition « `signet_app` a le droit INSERT » des tests AC2/AC3 d'`INSERT` de `tests/isolation-hardening/rls-membership.test.ts` echouera ; ces tests deviennent alors des tests de privilege (refus par GRANT) a reecrire dans la meme tranche.
- audit-010 INFO-1 : etendre l'assertion de roles de 0010 au sens inverse (`pg_auth_members.roleid` parmi les `signet_*`) et a `pg_db_role_setting`, a la prochaine migration de roles.
- ~~audit-010 INFO-2~~ : traite dans la tranche 010 (37c213f). Inclure les politiques `TO PUBLIC` (`0 = ANY(pol.polroles)`) dans les invariants de catalogue `current_org(`/`context_org(` de `tests/isolation-hardening/definer-functions.test.ts`.
- ~~audit-010 INFO-3~~ : traite dans la tranche 010 (37c213f). Le test AC4 « owner different » devrait utiliser l'owner reel d'une autre fixture plutot qu'un UUID sans `app_user`.
- review-010 SUGGESTION-1 : les tests AC3 de 010 sur `organization_link_usage`, `subscription` et `app_user` n'assertent pas l'existence prealable des lignes (vraie aujourd'hui) ; ajouter cette precondition si une tranche change leur creation.
- audit-010 INFO-4 / ADR-0011 : la RLS verifie l'appartenance, pas le role ; durcir `UPDATE organization` au role owner en RLS reste une option (hors D-022).
- ~~Corriger `.claude/rules/drizzle-postgres.md:22`~~ : fait dans l'usine 1.4.0 (revocation sans `FOR ROLE` ni `IN SCHEMA`, visant le role qui cree les fonctions).
- Reevaluer ESLint 10 (`latest`) au passage a Next 16 : ESLint reste en 9.39.5 parce que `eslint-config-next@15.5.26` echoue sous ESLint 10 (ADR-0009). A traiter avec la montee de Next, fin de vie de la ligne 15 en octobre 2026 (ADR-0008).
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
