# 012 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : en cours d'implementation
- Branche : slice/012-ecrans
- Dernier commit : 2f3ba49 feat(ui): fonctions pures d'affichage, requetes et messages fixes
- Prochaine etape : pages `apps/web/src/app/` (gabarit, accueil, connexion, inscription, organisations, organisation, collection, acceptation, introuvable) et formulaires clients `apps/web/src/ui/`

## Couches
- [ ] Migration — sans objet (aucune migration, consigne point 1)
- [ ] Acces donnees — sans objet (fonctions existantes de `lib/`, inchangees)
- [x] Logique metier — fonctions pures d'affichage et de requetes (`apps/web/src/ui/`) : 2f3ba49 (visible-text, requests, messages, form-protection : 77 tests verts)
- [x] API — sans objet (aucune route) ; etiquette `minRole` de D-143 dans `api-contracts/organizations.ts` : c3deb74
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
- Correction D-146 (AC13) : bloc « better-auth refuse une connexion d'Origin etrangere » retire de `form-protection.test.ts` (import `expectStatus` inutile retire), commentaire d'en-tete mis a jour (TEST=true herite de Vitest) ; les tests de cookies et de 401 sans cookie sont inchanges.
- Correction D-146 (AC8) : `safe-display.test.ts` verifie le type de contenu de la charge RSC par egalite exacte du type de media (avant `;`, trim, minuscules) avec `text/x-component` ; le reste du fichier est conforme au texte corrige (HTML entier, charge RSC sans `__html` ni caractere invisible brut), aucun ecart.
- Non testes : vrais clics/double clic/`router.refresh`/`history.replaceState` (aucun navigateur, D-137) ; propositions de suite d'erreur (`Se deconnecter` sur 403, lien `/organisations` sur 409 ALREADY_MEMBER, lien `/connexion` sur 401) ; texte propre du formulaire « Ajouter un lien » pour un 422 hors liste (non specifie : seul le fait d'etre dans `FIXED_MESSAGES` est teste) ; schema non http(s) cote page (la base refuse ces URL, seule la fonction pure est testee).

### Implementation (implementeur)
- D-143 (c3deb74) : `minRole: "authenticated"` pour `createOrganization` et `listMyOrganizations`, commentaires alignes sur « toute session valide » ; aucun autre changement du contrat.
- `ui/safe-link.tsx` ne contient que la fonction pure, sans JSX : le test la charge par Vitest, dont la transformation JSX n'est pas configuree a la racine ; le rendu de la ligne de lien est dans un composant serveur separe. Ecarte : un composant JSX dans ce fichier (risque de dependre de la configuration JSX de Vitest, sans gain).
- `ui/messages.ts` recopie les textes de `lib/errors.ts` et des constantes des routes (contrat : « recopies ») au lieu de les importer : le module est charge par des composants clients et reste sans dependance serveur ; le test compare a `lib/errors.ts`, ce qui detecte toute derive. Ecarte : import de `lib/errors.ts` (couplage d'un module client a `lib/`).
- Inscription : « compte existant » = codes better-auth `USER_ALREADY_EXISTS` et `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (`@better-auth/core`, `error/codes`), sur `400`/`422` ; autre `400`/`422` : texte d'adresse ou de mot de passe invalide ; tout autre statut : texte generique. Ecarte : tout 4xx comme refus de saisie (un `418` ou `403` inattendu serait mal explique).
- Formulaires prives : le `422` de « Nouvelle collection » donne toujours le texte du nom invalide (l'identifiant d'organisation vient de la page, jamais saisi) ; `404 ORGANIZATION_NOT_FOUND` et `401` traites avant les codes propres au formulaire.
- `FIXED_MESSAGES` contient aussi les deux textes fixes de page « Lien d'invitation incomplet » et « Votre compte est cree, mais l'organisation n'a pas pu l'etre. Creez-la ci-dessous. » : liste unique de tous les textes affichables, comme le demande la signature.
- `signUpWithOrganization` : l'identifiant rendu par la creation n'est repris dans la destination que s'il a la forme d'un UUID (sinon : `creation_failed`) ; aucune valeur de reponse non verifiee dans une adresse. Erreur reseau = statut 0 (jamais d'exception vers le formulaire).

### Reponses de l'humain (D-146)
- QUESTION 1 (AC13) : clause d'`Origin` retiree de 012, raison au contrat ; correction d'usine 1.6.5 puis adoption dans Signet (test retabli, commentaire de `tests/helpers/auth.ts` corrige), au backlog. Test retire par `test-writer`.
- AC8 : interpretation validee, texte d'AC8 corrige ; `test-writer` aligne l'assertion du type de contenu RSC (egalite exacte avec `text/x-component`, au lieu de « ne contient pas `text/html` »).
- QUESTION 2 (regle d'avance) : si Next recopie la chaine de requete dans la charge RSC et qu'AC2 (e) echoue sans defaut de page, `test-writer` reporte l'assertion sur les elements reserves a l'owner (palier, formulaire d'invitation), meme intention et meme severite (D-115), consigne ici ; arret seulement si une page affiche reellement un element reserve.
- D-147 : texte « URL ou titre invalide. » pour un `422` hors liste d'« Ajouter un lien » (table du contrat) ; suites apres erreur (403, 409 ALREADY_MEMBER, 401) prouvees par la visite guidee, a ecrire dans `recette-012.md`.
