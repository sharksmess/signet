# 012 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : ouverte
- Branche : slice/012-ecrans
- Dernier commit : 6d49e4d test(slice-012): criteres d'acceptation de la tranche 012
- Prochaine etape : implementer couche par couche (fonctions pures `apps/web/src/ui/`, puis pages) jusqu'a faire passer `tests/screens/**` ; lever d'abord les deux questions de la section Decisions (AC13 Origin, serialisation RSC)

## Couches
- [ ] Migration — sans objet (aucune migration, consigne point 1)
- [ ] Acces donnees — sans objet (fonctions existantes de `lib/`, inchangees)
- [ ] Logique metier — fonctions pures d'affichage et de requetes (`apps/web/src/ui/`)
- [ ] API — sans objet (aucune route ; seule l'etiquette `minRole` de D-143 dans `api-contracts/organizations.ts`)
- [ ] UI — pages `apps/web/src/app/` et composants `apps/web/src/ui/`
- [ ] Suite complete verte + `pnpm run check`
- [ ] Visite guidee : `docs/04-runbooks/recette-012.md` ecrite, resultat consigne par l'humain

## Blocages

## Decisions
- Ouverture (orchestrateur) : contrat valide par l'humain (D-144, avec Q-1 option A, Q-2, liste fermee des marqueurs) ; lectures L-10 et L-11 ajoutees apres D-144 (D-145, a valider). D-142 et D-143 inscrites au registre ; l'etiquette D-143 de `organizations.ts` est laissee a l'implementation (couche contrat, commit dedie).
- Verifie avant contrat (orchestrateur) : cookie de session better-auth `SameSite=Lax` par defaut (`better-auth/dist/cookies/index.mjs`) ; better-auth controle `Origin` sur `/api/auth/*` (helper `tests/helpers/auth.ts`) ; les routes de l'application lisent le corps par `request.json()` sans controle du type de contenu ni d'`Origin` (D-144 Q-2, backlog). Mode developpement : `EMAIL_CAPTURE_URL` refusee hors `APP_ENV=test`, donc aucun e-mail d'invitation sur le poste ; sans serveur Inngest de developpement, `POST .../invitations` rend `503` (`lib/env.ts`, `stripe-facturation-locale.md` § 5).

### Tests de 012 (test-writer)
- Fichiers : `tests/screens/{access,organizations,isolation,safe-display,collection-page,invitation-page,form-protection,requests,messages,visible-text,sources}.test.ts` ; helpers `tests/helpers/screens.ts` (pages, extraction HTML, arrangements), `screens-ui.ts` (chargement dynamique des fonctions pures, faux fetch), `screens-source.ts` (verifications de source). 198 tests ; avant implementation : 170 echecs, 28 reussites (voulus : AC13 cookies et 401 sans cookie, detecteurs de source, verifications de source vraies par absence).
- Signatures des fonctions pures fixees (reprises en tete de `screens-ui.ts`) : `ui/visible-text.ts` `visibleText(value)` ; `ui/safe-link.tsx` `safeLink(url)` -> `{kind:"link",href,hostname}` | `{kind:"text"}` ; `ui/requests.ts` `build*Request`, `tokenFromFragment(hash)`, `signUpWithOrganization(fetchFn, {email,password,organizationName})` -> `created` | `creation_failed` | `refused` ; `ui/messages.ts` `chooseMessage(form, status, body)` et `FIXED_MESSAGES`.
- Marqueurs de page fixes (valeurs fixes, jamais libres) : `<li data-testid>` `organization-row`, `collection-row`, `member-row`, `link-row` ; blocs `subscription-block`, `invite-form` (owner seul), `create-organization-form`, `create-collection-form`, `add-link-form`, `sign-in-form`, `sign-up-form` ; `empty-organizations`, `empty-collections`, `empty-links` ; dans une ligne de lien `link-hostname` ; role ecrit `owner`/`member` ; date `AAAA-MM-JJ HH:MM UTC`.
- Cas discriminants : precondition de statut 200 dans les tests d'absence (sinon une page 404 absente les ferait passer a vide) ; 404 comparees apres remplacement des identifiants ; `?role=owner` compare HTML et RSC a l'identique ; valeur du compteur d'appels de l'inscription (un seul POST organisations, 2 appels au total).
- Interpretation d'AC8 pour la charge RSC : une chaine JSON `<script>` est brute par construction dans `text/x-component` ; test = pas de cle `__html`, pas servi comme HTML ; suites piegees brutes interdites dans le HTML seulement ; marqueurs et caracteres invisibles interdits bruts dans les deux.
- QUESTION 1 (AC13, derniere clause) : sur le serveur de test, `POST /api/auth/sign-in/email` avec `Origin` etrangere recoit **200**, avec ou sans cookie de session : better-auth ne refuse pas l'Origin etrangere ici. Le test (avec cookie) echoue donc independamment des ecrans ; sans travail serveur (interdit) il ne peut pas passer. A arbitrer par l'humain (retirer la clause, ou backlog serveur).
- QUESTION 2 (risque) : les comparaisons d'identite avec parametre (`?role=owner`, AC5) et l'absence d'une valeur piegee de `?creation=` (AC2 e) portent aussi sur la charge RSC ; Next peut y serialiser la chaine de requete (cle de segment de page). Si l'implementation echoue sur ce seul point, arbitrage a faire, pas un defaut de page.
- Non testes : vrais clics/double clic/`router.refresh`/`history.replaceState` (aucun navigateur, D-137) ; propositions de suite d'erreur (`Se deconnecter` sur 403, lien `/organisations` sur 409 ALREADY_MEMBER, lien `/connexion` sur 401) ; texte propre du formulaire « Ajouter un lien » pour un 422 hors liste (non specifie : seul le fait d'etre dans `FIXED_MESSAGES` est teste) ; schema non http(s) cote page (la base refuse ces URL, seule la fonction pure est testee).
