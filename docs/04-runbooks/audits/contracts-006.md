# Rapport de controle des contrats, tranche 006 (acceptation d'une invitation)

Perimetre : `git diff eb0dae0..HEAD`, hors commit `1bb5acd`. Je n'ai pas lance `pnpm test`.

## Ruptures

Aucune rupture au sens de la regle. La route `POST /api/invitations/accept` n'existait pas avant la tranche, donc aucun client ni integration ne la consomme. Les amendements de D-102 portent sur un contrat declare mais jamais implemente.

Pour memoire, ces changements auraient ete des ruptures sur une route livree :
- **Champ de requete retire :** `password` est retire de `acceptInvitation`. Un `password` fourni est ignore, car `z.object` retire les cles inconnues et la route le dit en commentaire. Justifie par D-102 Q-1 et ADR-0018.
- **`minRole` :** passe de `"public"` a `"authenticated"`. Il y a donc un 401 nouveau pour un appel sans session. Justifie par D-102 et D-109.
- **Codes ajoutes :** 401 `UNAUTHENTICATED`, 403 `INVITATION_EMAIL_MISMATCH` et 409 `ALREADY_MEMBER`. Justifies par D-102 Q-2 et P-5.

## Conformite au contrat

- **`createInvitation` :** inchange. Le diff de `invitations.ts` ne touche que `acceptInvitation`.
- **`_contract.ts` :** `minRole` devient `"public" | "authenticated" | "member" | "owner"`. C'est un ajout a l'enumeration, pas une rupture. Les contrats `collections`, `links`, `members`, `organizations` et `subscriptions` ne sont pas touches.
- **Sortie :** `{ organizationId: Uuid, role: "member" }` n'a pas change. La route renvoie `{ organizationId, role: "member" }` avec le statut 200.
- **Entree :** `token: z.string().max(256)` est valide par `acceptInvitationContract.input`, importe depuis le contrat par `lib/invitations/contracts.ts`. L'implementation n'a donc pas de schema parallele.
- **Ordre d'evaluation :** session, puis validation, puis decodage strict, puis `accept_invitation`, puis `lookup_invitation`. C'est l'ordre decrit dans le contrat.
- **Statuts et codes de la route :** chacun correspond a l'implementation.
  - 401 `UNAUTHENTICATED` : pas de session, ou `SG002` / `23503` de `accept_invitation()`. Aussi le cas `pending` avec l'adresse de session identique a l'adresse invitee.
  - 422 `VALIDATION_FAILED` : corps non JSON ou non objet, token absent, non textuel ou de plus de 256 caracteres. La query string n'est pas lue.
  - 404 `INVITATION_NOT_FOUND` : token malforme (motif de 43 caracteres base64url, reecriture identique, 32 octets) sans aucune requete en base, ou token inconnu. Le corps est identique dans les deux cas.
  - 410 `INVITATION_EXPIRED` et 409 `INVITATION_ALREADY_USED` : etats `expired` et `accepted` de `lookup_invitation()`.
  - 403 `INVITATION_EMAIL_MISMATCH` : etat `pending` avec une autre adresse. Le message est fixe et ne contient pas d'adresse.
  - 409 `ALREADY_MEMBER` : `SG008`, avec rollback au point de sauvegarde, donc rien n'est consomme.
- **`errors.ts` :** `ApiErrorCode` est elargi de quatre valeurs et le statut 410 est ajoute au type. Ce sont des ajouts. Les erreurs existantes ne changent pas.

## Base de donnees

- **Migrations 0001 a 0014 :** le diff n'en modifie aucune. Seuls sont ajoutes `0015_accept_invitation.sql`, `meta/0005_snapshot.json` et une entree dans `_journal.json` (idx 5, tag `0015_accept_invitation`).
- **Tables, colonnes, index :** `0015` n'en modifie aucun. Il n'ajoute que des GRANT, quatre politiques `TO signet_definer` et deux fonctions. `signet_app` n'a aucun privilege ni politique en plus. Pas de NOT NULL ajoute.
- **Signatures :**
  - `accept_invitation(p_token_hash bytea) RETURNS TABLE(organization_id uuid)` est conforme a l'ERD §1 et §5 amende (P-2, sans `user_id`).
  - `lookup_invitation(p_token_hash bytea) RETURNS TABLE(organization_name, email, state)` est conforme a l'ERD amende.
  - Les deux sont `SECURITY DEFINER`, appartiennent a `signet_definer` et ont `EXECUTE` pour `signet_app` seul.
- **ERD :** il est mis a jour dans la meme tranche : §0 (SG008), §1, §2.1, §5, matrice et liste des migrations.
- **Test existant adapte :** `tests/invitations/database.test.ts` (AC15 de la tranche 003) filtre desormais sur les politiques applicables a `signet_app`. Le commentaire du test invoque D-102 Q-3 et la regle D-065 n°2. Les assertions de la tranche 003 restent les memes pour `signet_app`. Ce n'est pas une rupture de contrat.
- **Types partages et evenements :** aucun changement. Aucun evenement, webhook ou message de file n'est touche.

## Ajouts, a signaler sans qu'ils soient des ruptures

- Fonctions `signet.lookup_invitation` et `signet.accept_invitation`, route `/api/invitations/accept`, fonction `linkTokenToHash`.
- Code SQL `SG008` et codes d'erreur `INVITATION_*`.

## Points non couverts ou a noter

1. **Ecart de description dans l'ERD.** L'ancienne ERD §5 disait que `accept_invitation` "leve une erreur typee" quand il n'y a aucune ligne. La fonction renvoie maintenant zero ligne sans lever, et l'ERD amende le decrit ainsi. La fonction n'avait aucun appelant, donc il n'y a pas de rupture.
2. **Mapping du 401.** Le cas `pending` avec adresse de session identique est traduit en 401 par un choix d'implementation. Ce choix est documente dans le contrat et dans D-108. Je ne l'ai pas verifie contre le texte du registre.
3. **Texte de D-102 a D-109.** Je n'ai pas relu `docs/DECISIONS.md`. Les references de decision citees ci-dessus viennent des commentaires des contrats, du SQL et de l'ERD.

CONTRACTS: PASS
