# Backlog des tranches — Signet

Ordre de dependance technique d'abord, risque decroissant en departage a profondeur egale (la tranche la plus risquee en premier, tant qu'il reste du temps pour se tromper). Chaque tranche couvre une capacite utilisateur complete du PRD (base + API + UI) ; l'isolation tenant (US-09) n'est pas une tranche a part — c'est le critere d'acceptation AC5, obligatoire dans chaque tranche ci-dessous qui touche une donnee d'organisation.

| # | Tranche | User story(ies) | Depend de | Pourquoi cet ordre |
|---|---|---|---|---|
| 001 | Creation d'organisation et compte owner | US-01 | aucune | Fondation : toute autre tranche suppose une organisation et un utilisateur authentifie. |
| 002 | Abonnement et changement de palier | US-08 | 001 | Depend seulement de l'organisation. Placee tot malgre son risque (integration Stripe, argent, source de verite auditable — ADR-0005) car la tranche 005 (quota) a besoin de connaitre le palier courant de l'organisation pour decider d'un refus a 50 liens : c'est une dependance technique reelle, pas seulement un choix de risque. |
| 003 | Invitation d'un membre | US-02 | 001 | Depend seulement de l'organisation et du role owner. Risque moderat (securite du token d'invitation, fiabilite de l'envoi d'e-mail — ADR-0006), inferieur a celui de la facturation. |
| 004 | Creation d'une collection | US-05 | 001 | Depend seulement de l'organisation. CRUD simple, risque le plus bas de sa couche de dependance : placee en dernier parmi les tranches ne dependant que de 001. |
| 005 | Ajout d'un lien avec quota Free | US-06 | 002, 004 | Depend d'une collection existante (004) et du palier courant (002). **Risque le plus eleve du backlog** : le PRD nomme explicitement (risque #3) la verification de quota non atomique comme le piege le plus probable de cette tranche — a traiter avec le plus de marge possible. |
| 006 | Acceptation d'une invitation | US-03 | 003 | Depend d'une invitation existante (003). Risque securite (validation de token, expiration, rejeu) reel mais suit un patron plus standard que la tranche 005. |
| 007 | Suppression d'une collection (cascade) | US-10 | 004, 005 | Depend d'une collection et de liens a supprimer en cascade dans la meme operation, pour verifier reellement la cascade. Operation irreversible (pas de soft delete) : risque de perte de donnee si la cascade est mal bornee. |
| 008 | Retrait d'un membre | US-04 | 006 | Depend d'un membre reel obtenu par acceptation d'invitation (006), pour tester le retrait sur un membre effectif plutot que sur une donnee de fixture. Contient l'invariant "dernier owner protege" (US-04.3). |
| 009 | Consultation des collections et des liens | US-07 | 004, 005 | Depend de collections et de liens existants pour verifier le tri et l'isolation en lecture sur des donnees reelles. Risque le plus bas du backlog : lecture seule, patron d'isolation deja eprouve par les tranches precedentes. |

## Notes

- Aucune tranche ne couvre l'edition de lien/collection ni la suppression d'un lien isole : hors-perimetre explicite du PRD (US-10 ne couvre que la suppression d'une collection entiere).
- Toute tranche qui ferait apparaitre une fonctionnalite listee en hors-perimetre (recherche, tags, import Slack, etc.) est un signal du risque #1 du PRD (derive de perimetre) et doit etre refusee ou renvoyee en backlog explicite, pas glissee dans une tranche existante.
- Avant tout choix d'hebergement (audit-001 MINEUR-11) : fixer l'en-tete IP de confiance et les proxys de confiance de better-auth (`advanced.ipAddress.ipAddressHeaders`/`trustedProxies`) et le consigner dans ADR-0010. Sans cela, le limiteur de debit est contournable ou bloque tous les utilisateurs selon le proxy.
- Migration 0009 (audit-001 MINEUR-10) : reimposer les attributs des quatre roles `signet_*` (`ALTER ROLE ... NOBYPASSRLS NOSUPERUSER ...`) et verifier par test de catalogue `rolbypassrls`/`rolsuper`/appartenances : un role preexistant n'est aujourd'hui jamais verifie.
- Corriger `.claude/rules/drizzle-postgres.md:22` : les privileges par defaut visent le role qui CREE les fonctions (le role de migration), pas leur proprietaire final ; `FOR ROLE signet_definer` serait sans effet (audit-001, passe 4).
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

Decision d'architecture : a trancher par un humain, pas a corriger silencieusement dans une tranche.
