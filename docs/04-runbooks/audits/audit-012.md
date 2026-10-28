# Rapport d'audit de sécurité : tranche 012 (Écrans)

(Rapport rendu sans outil d'écriture, recopié tel quel par l'orchestrateur.)

**Périmètre :** `git diff main...HEAD` sur `slice/012-ecrans`, 17 commits. L'arbre de travail est propre, hormis `.gates/current-slice` non suivi. Le code de production ajouté se limite aux pages et composants d'écran :
- `apps/web/src/app/{page,layout,error,not-found}.tsx`
- `apps/web/src/app/{connexion,inscription,invitations/accept,organisations}/page.tsx`
- `apps/web/src/app/organisations/[organizationId]/page.tsx`
- `apps/web/src/app/organisations/[organizationId]/collections/[collectionId]/page.tsx`
- `apps/web/src/ui/*` et `apps/web/src/ui/forms/*`

Le diff ne touche ni `app/api/`, ni `lib/`, ni migration, ni `package.json`, ni `pnpm-lock.yaml`. Côté contrat, seule l'étiquette `minRole` passe à `"authenticated"` dans `docs/02-architecture/api-contracts/organizations.ts` (D-143), sans effet sur le comportement.

## Vérifications par point de la grille

1. **Isolation tenant : conforme.**
   - **Origine de l'utilisateur.** `userId` vient uniquement de `auth.api.getSession` (`ui/session.ts:18-20`), jamais de l'adresse.
   - **Lectures.** Toutes passent par les fonctions de `lib/` déjà auditées (009, 013) : `listMembers`, `listCollections` et `listLinks` vérifient l'appartenance par `organization_id = $1 AND user_id = $2` sous `withTenant` ; `listMyOrganizations` passe par `organizations_for_user`.
   - **Collection.** La page appelle d'abord `listLinks(org, collection)` (`collections/[collectionId]/page.tsx:33`), donc le chemin fait autorité : une collection de B placée sous A donne la page introuvable.
   - **Comparaisons de texte.** Les identifiants sont mis en minuscules après le schéma (`[organizationId]/page.tsx:41`, `[collectionId]/page.tsx:30-31`). Les comparaisons `item.id === organizationId`, `item.id === collectionId` et `member.userId === session.userId` portent donc sur des formes canoniques (piège de casse de l'audit 002 écarté).

2. **Autorisation : conforme.**
   - Le rôle est celui de la ligne de l'appelant dans `listMembers` (`[organizationId]/page.tsx:45-47`), jamais un paramètre de l'adresse.
   - `getSubscription` n'est appelé que si `isOwner` (l. 58), et `readAsOwner` revérifie le rôle côté `lib`.
   - Pour un member, le bloc Palier et `InviteForm` ne sont pas rendus, donc absents du HTML comme de la charge RSC (props de composant client comprises). Preuves :
     - `tests/screens/organizations.test.ts:275-310` : marqueurs, libellé « Palier » et clés d'abonnement absents des deux formes ; adresse falsifiée par `?role=…` sans effet.
     - AC12 couvre le parcours réel d'invitation.
   - Les routes d'écriture n'ont pas changé et gardent leur propre contrôle (`INSUFFICIENT_ROLE` côté serveur).

3. **Validation des entrées : conforme.**
   - Paramètres de chemin : schémas du contrat (`listMembersContract.input`, `listLinksContract.input`) ; un identifiant malformé donne la page introuvable.
   - `searchParams` n'est lu qu'à un seul endroit, par `z.object({ creation: z.literal("echec") })` (`organisations/page.tsx:19,23`). La valeur n'est jamais reprise.
   - Les identifiants reçus dans les réponses de création passent par `UUID.test` avant d'entrer dans une adresse (`requests.ts:126-130`, `accept-invitation.tsx:43-47`), donc pas de redirection ouverte.
   - Les corps envoyés sont construits champ par champ (`requests.ts:37-72`), sans objet de formulaire transmis tel quel.

4. **Injection et rendu : conforme.**
   - Aucun `dangerouslySetInnerHTML`, `<script>`, `<iframe>` ni `<img>` dans le diff. Toutes les valeurs libres sont rendues en texte par React.
   - `href` : le seul attribut alimenté par une donnée est le lien d'une URL enregistrée. Il passe par `safeLink` (`ui/safe-link.tsx:13-19`) : relecture par `URL`, schéma relu `http:`/`https:` seulement, hôte non vide, `href` normalisé, sinon texte seul. Le lien porte `target="_blank" rel="noopener noreferrer"` (`link-row.tsx:39`).
   - Les autres `href` sont fixes ou formés d'UUID lus côté serveur. Le `<title>` est fixe (`layout.tsx:9-11`).
   - **Marqueurs (D-144).** Points de code réels de la classe de `visible-text.ts:16` vérifiés en relisant le fichier : 202A-202E, 2066-2069, 200E, 200F, 061C, 200B, 2060, FEFF. C'est exactement la liste fermée, U+200D exclu. Elle est appliquée côté serveur avant tout passage aux composants (noms, adresses, titres, URL, adresse de session).

5. **Secrets et fuites : conforme.**
   - Messages : liste fermée (`ui/messages.ts`). `chooseMessage` ne renvoie jamais `body.message`, sauf égalité stricte avec un texte fixe (`messages.ts:104-107`). `error.tsx` affiche un texte fixe, et les `throw` des pages portent des messages fixes sans donnée.
   - Aucun `console.*`, `localStorage`, `sessionStorage`, `document.cookie` ni lecture d'environnement dans `ui/` ni dans les pages.
   - Page introuvable : texte fixe et identique pour une organisation d'autrui, inexistante ou malformée.
   - Renvoi sans session : `307` vers `/connexion` sans paramètre de retour, avant toute lecture. AC1 prouve que la réponse est identique pour un identifiant existant et un identifiant inexistant.
   - **Jeton d'invitation.** Lu dans `location.hash` seulement (`accept-invitation.tsx:34-36,52-53`), envoyé uniquement dans le corps du `POST` sur clic, puis effacé de l'historique par `replaceState` après succès. Jamais écrit dans une adresse, un stockage ou un journal. Le lien de l'e-mail utilise bien `#token=` (`lib/invitations/email.ts:19`). La page ne lit pas `?token=`, et `invitation-page.test.ts:101-115` prouve qu'un jeton valide dans `?token=` ne consomme pas l'invitation.
   - **Assouplissements de tests D-148/D-149.** Ils ne masquent aucune fuite :
     - `maskAddressDerivedKeys` (`tests/helpers/screens.ts:141-143`) et `replaceIds` ne servent qu'aux comparaisons d'égalité entre deux charges.
     - Les assertions d'absence (`expectAbsent`) portent sur le corps brut.
     - `secretsOutsideRequest` (l. 120-123) ne retire que les valeurs contenues dans l'adresse demandée (les identifiants). Noms, adresses e-mail et titres restent interdits.
     - Pour AC11, seule la sous-chaîne exacte `?token=<jeton>` est retirée avant de vérifier que le jeton n'apparaît nulle part ailleurs (`invitation-page.test.ts:39-43,78-80`).
     - Le motif masqué (chaîne de 21 caractères base64url suivie de `v` ou `m`, entre guillemets) ne peut couvrir ni un UUID ni les valeurs de test. Il ne masquerait une donnée que dans une comparaison d'égalité, jamais dans un contrôle d'absence.

6. **Webhooks : non concerné.**

7. **Fonctions à privilèges : rien de nouveau.** Aucune fonction, politique ni privilège ajouté.

8. **Origine du contexte tenant : conforme.**
   - `app.user_id` vient de la session.
   - `app.organization_id` vient du chemin, mais il est vérifié par le contrôle d'appartenance explicite et par `current_org()` (migration 0009), comme à l'audit 013.

9. **Limitation de débit.**
   - Connexion et inscription passent par better-auth : le `429` est traduit en « Trop de tentatives » et le limiteur n'a pas changé.
   - Les pages font de trois à quatre lectures sans borne par affichage, ce qui relève de l'entrée déjà au backlog (audit-009 MINEUR-1, étendue par audit-013 MINEUR-1). Rien de nouveau.

10. **Dépendances : conforme pour la production.**
    - `pnpm audit --prod` répond « No known vulnerabilities found ». Le diff n'ajoute aucune dépendance.
    - `pnpm audit` complet : 4 alertes (2 critiques, 2 hautes), toutes en dépendances de développement : `next` 16.0.0-16.4.0 via `@inngest/test>inngest`, et `zod` <4.6.6 via `eslint-config-next`.
    - L'application utilise `next` 16.4.3 et `zod` 4.6.7, hors des plages vulnérables. Constat identique à l'audit 004.

## Constats

**CRITIQUE :** aucun.

**MAJEUR :** aucun.

**MINEUR :** aucun.

**INFO-1. Aucun en-tête anti-encadrement** (`apps/web/next.config.ts:3-5`)
- Ni `Content-Security-Policy: frame-ancestors` ni `X-Frame-Options` : les écrans peuvent être affichés dans une `iframe`.
- **Pas exploitable aujourd'hui depuis un autre site.** Le cookie `SameSite=Lax` n'est pas envoyé dans une `iframe` d'un autre site : la page s'y charge donc sans session et renvoie vers `/connexion`.
- Une page du même site (autre sous-domaine) pourrait encadrer une page connectée et piéger un clic, par exemple sur « Se déconnecter ». Elle ne pourrait pas faire accepter une invitation : il faudrait un jeton que seul le destinataire reçoit.
- Même attaquant que la limite connue D-144 Q-2.
- **Remédiation :** joindre `frame-ancestors 'self'` (ou `X-Frame-Options: DENY`) à l'entrée du backlog « contrôle de l'origine avant la mise en ligne ». À traiter avec le choix d'hébergement (audit-001 MINEUR-11).

**INFO-2. Écritures protégées par `SameSite=Lax` seulement** (`apps/web/src/ui/requests.ts:33-35` ; routes inchangées)
- Limite connue, décidée par l'humain (D-144 Q-2) et inscrite au backlog avant la mise en ligne. La tranche ne l'aggrave pas : elle n'expose aucune route nouvelle.
- Rappel : le contrôle d'`Origin` de better-auth n'est prouvé par aucune suite (D-146 point 1, FRICTION 2026-10-28). Cette preuve reste à obtenir avec l'usine 1.6.5.

**INFO-3. Dépendances de développement vulnérables** : voir le point 10. Sans effet sur l'application servie ; à suivre quand `@inngest/test` et `eslint-config-next` seront mis à jour.

## Verdict

AUDIT: PASS
