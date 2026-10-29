# Relecture code-reviewer : tranche 012, ecrans

Branche `slice/012-ecrans`, `main...HEAD`, 17 commits (649991c en tete).

**Methode.** J'ai lu le diff complet : les pages de `apps/web/src/app/`, les modules de `apps/web/src/ui/` (fonctions pures, formulaires clients), les tests `tests/screens/**` et les helpers `tests/helpers/screens*.ts`. J'ai aussi lu le contrat `012-ecrans.md`, le journal `012-progress.md`, les lignes D-142 a D-149 du registre, le backlog, FRICTION, `recette-012.md` et `.gates/scope-012.txt`. J'ai verifie dans `lib/` les variantes d'echec des lectures appelees par les pages : `listMembers`, `listLinks`, `listCollections` et `getSubscription` ne rendent `fail` que pour des refus d'appartenance ou d'existence, et une erreur SQL leve une exception. J'ai compare les textes de `ui/messages.ts` a ceux des routes (`collections/route.ts`, `links/route.ts`). Je n'ai lance ni `pnpm test` ni aucune commande qui touche la base. Les resultats de la suite sont ceux du journal : 948 verts, 1 ignore, `pnpm run check` vert.

## Constats

### BLOQUANT
Aucun.

### A CORRIGER

**1. AC2 (e) et AC5 sont plus faibles dans les tests que dans le contrat, et le contrat n'a pas ete mis a jour.**
- **Emplacement :**
  - contrat `docs/03-slices/012-ecrans.md:101` (AC2 e : « n'apparait nulle part dans la reponse ») et `:106` (AC5 : « reponse identique a celle sans parametre ») ;
  - tests `tests/screens/organizations.test.ts:100-115` et `:297-311` ;
  - registre D-146 point 4.
- **Constat :** les deux tests ont ete corriges en application de D-146 point 4. AC2 (e) admet desormais la forme encodee de la valeur piegee. AC5 ne compare plus les reponses : il verifie l'absence des elements reserves a l'owner (HTML et RSC), un texte visible identique et des lignes de membres identiques. Le journal le dit (`012-progress.md:72`). Mais :
  - le texte des deux criteres est reste tel quel, alors que D-148 a precise AC1, AC3, AC6 et AC11 ;
  - D-146 point 4 ne cite qu'AC2 (e). AC5 n'y est pas nomme, D-148 point 2 non plus.

  Pour AC5, l'affaiblissement depasse ce qui etait necessaire. Le meme fichier de tests sait deja retirer l'echo de l'adresse et masquer les cles derivees avant de comparer (`withoutAddressEcho` et `maskAddressDerivedKeys` pour AC11, `invitation-page.test.ts:39-47`). AC5 aurait pu garder l'egalite du HTML et de la charge RSC avec ce traitement. Aujourd'hui, avec `?role=owner`, une charge RSC differente qui ne porte aucun des libelles surveilles passerait.
- **Consequence :** un auditeur qui lit AC5 croit que l'identite de la reponse est prouvee, ce qui n'est plus le cas. Et l'extension de la regle a AC5 n'est ecrite que dans le journal, pas dans une decision humaine.
- **Direction :** pour AC5, de preference, retablir la comparaison du HTML et de la charge RSC apres retrait de l'echo `?role=...` et masquage des cles d'en-tete, en gardant les assertions d'absence actuelles. Sinon, corriger le texte d'AC5 et d'AC2 (e) au contrat et faire inscrire au registre que D-146 point 4 vaut aussi pour AC5.

**2. Le texte de D-147 (« URL ou titre invalide. ») n'est verifie par aucun test.**
- **Emplacement :**
  - `apps/web/src/ui/messages.ts:35,107` ;
  - `tests/screens/messages.test.ts:148-161` ;
  - `tests/screens/messages.test.ts:45` ;
  - `docs/03-slices/012-progress.md:44`.
- **Constat :** pour un `422` d'« Ajouter un lien » dont le message n'est pas dans la liste, le seul test verifie que le resultat appartient a `FIXED_MESSAGES` et ne reprend pas le message brut. Si `addLink` rendait `MESSAGES.urlInvalid` ou `MESSAGES.generic` a la place, la suite resterait verte. Le journal dit encore « non specifie : seul le fait d'etre dans `FIXED_MESSAGES` est teste », alors que D-147 a fixe ce texte depuis. Par ailleurs, la constante de test `LINK_INVALID` vaut « Lien d'invitation invalide. » : c'est le texte d'acceptation, alors que `MESSAGES.linkInvalid` vaut « URL ou titre invalide. ». Le lecteur peut confondre les deux.
- **Consequence :** une decision humaine (D-147 point 1) n'est protegee par aucun test.
- **Direction :** ajouter le cas `["add-link", 422, "VALIDATION_FAILED", "URL ou titre invalide."]` avec un message hors liste. Renommer la constante d'acceptation, par exemple en `INVITATION_LINK_INVALID`. Mettre a jour la ligne « Non testes » du journal.

**3. D-145 (L-10, L-11) est toujours « a valider par l'humain », et le journal ne le signale plus.**
- **Emplacement :**
  - `docs/DECISIONS.md`, ligne D-145 ;
  - `docs/03-slices/012-ecrans.md:167` ;
  - `docs/03-slices/012-progress.md:5-9` (« Prochaine etape » ne cite que D-149).
- **Constat :** L-10 (`/organisations?creation=echec`) fixe un comportement implemente (`organisations/page.tsx:19-32`), teste (AC2 e) et repris dans la recette. Aucune ligne du registre ne l'a validee. L'etat du journal ne mentionne que D-149 comme decision en attente.
- **Consequence :** la tranche peut etre presentee a la fusion avec une decision de l'orchestrateur, visible par l'utilisateur, que l'humain n'a pas validee, sans que la fiche de preuves le rappelle.
- **Direction :** inscrire D-145 a cote de D-149 dans « Prochaine etape » et dans la fiche de preuves, et obtenir les deux validations avant la fusion.

**4. AC16 (« `pnpm run build` vert ») n'est prouve qu'avec l'environnement de test.**
- **Emplacement :** `docs/04-runbooks/FRICTION.md` (ligne du 2026-10-28, build) et `docs/03-slices/012-progress.md:28`.
- **Constat :** hors environnement de test, le build echoue sur `/api/invitations/accept` (« DATABASE_URL_AUTH n'est pas definie »). FRICTION indique « Non verifie sur `main` ». La cause est tres probablement anterieure a 012 : la route n'est pas modifiee, et les pages de 012 sont dynamiques (`headers()`). Mais personne ne l'a constate.
- **Consequence :** si l'echec venait de 012, AC16 serait faux. S'il vient de `main`, c'est un defaut existant que la fiche de preuves doit nommer pour que l'humain fusionne en le sachant.
- **Direction :** lancer `pnpm run build` sur `main` avec le meme environnement, dans un arbre de travail separe, avant `close-slice.sh`. Ecrire le resultat dans la fiche de preuves et dans la ligne de FRICTION.

**5. Les tests des fonctions pures contournent la verification de type, alors que les modules existent desormais.**
- **Emplacement :** `tests/helpers/screens-ui.ts:97`, `:136`, `:143`.
- **Constat :** les modules `ui/*` sont charges par `import()` dynamique, puis convertis par `as unknown as RequestsApi` et `as unknown as MessagesApi` vers des interfaces recopiees dans le helper. Ce choix etait justifie avant l'implementation, quand le module n'existait pas. Il ne l'est plus. `CLAUDE.md` interdit de supprimer une verification de type.
- **Consequence :** si une signature de `requests.ts` ou de `messages.ts` change, `tsc` ne signale rien : les tests sont types contre la copie. La copie a d'ailleurs deja diverge : `headers: Record<string, string>` cote test, contre `{ "Content-Type": "application/json" }` cote production.
- **Direction :** remplacer les chargements dynamiques par des imports statiques des modules `ui/`, et supprimer les interfaces recopiees et les conversions. C'est faisable dans la tranche, sinon au backlog.

### SUGGESTION

1. **Le commentaire de `apps/web/src/ui/safe-link.tsx:8` renvoie a `link-list.tsx`, qui n'existe pas** : le rendu est dans `ui/link-row.tsx`. A corriger, sinon le lecteur cherche un fichier fantome.
2. **Le commentaire de `tests/helpers/screens.ts:97` decrit un parametre `rscStatus` absent de la signature d'`expectFullStatus`.** Il reste de la version anterieure a D-148. A aligner.
3. **La validation d'un UUID et la lecture d'un identifiant de reponse sont ecrites deux fois** : `requests.ts:31,126-130` et `forms/accept-invitation.tsx:27,43-47`. Exporter une seule fonction depuis `requests.ts`, par exemple un identifiant UUID lu sous une cle donnee, eviterait que les deux copies divergent.
4. **Une seule source garde les textes recopies des routes.** Pour `Nom de collection invalide : ...`, `URL invalide : ...` et `Titre invalide : ...`, le test recopie le texte en dur (`messages.test.ts:40-44`) au lieu de le relire depuis la route. Le journal (`012-progress.md:49`) affirme que le test « detecte toute derive » : c'est vrai pour `lib/errors.ts`, pas pour ces constantes de route. Si la route change, l'affichage retombe sur un texte fixe, donc sans fuite ; mais la derive passerait inapercue. A preciser dans le journal, ou bien exporter ces constantes et les relire (hors perimetre de 012 : backlog).
5. **Une course rare donne une page d'erreur au lieu d'une page introuvable.** Dans `organisations/[organizationId]/page.tsx:45-60`, le role est lu par `listMembers`, puis `getSubscription` est appele dans une autre transaction. Si l'owner perd ce role entre les deux (retrait d'un membre, tranche 008), `getSubscription` refuse et la page leve une exception : page d'erreur generique au lieu de 404. Sans fuite et sans consequence aujourd'hui. A noter pour 008.
6. **Les tests de l'enchainement d'inscription (AC2 c) ne verifient que l'appartenance a la liste fermee** (`requests.test.ts`, refus multiples), pas le texte exact de chaque refus. Les textes exacts sont prouves ailleurs (`messages.test.ts`, `form-protection.test.ts`). Comparer `outcome.message` au texte attendu rendrait le test autonome.

## Points verifies sans constat
- **Exactitude :**
  - `redirect()` et `notFound()` sont appeles avant tout rendu ; aucun `loading.tsx` ni `<Suspense>` ;
  - `userId` vient toujours de la session (`ui/session.ts`) ;
  - les identifiants du chemin passent par les schemas des contrats `listMembers` et `listLinks`, puis en minuscules ;
  - le role est lu dans la ligne de l'appelant ; `getSubscription` n'est appele que pour un owner ;
  - `?creation=` passe par `z.literal("echec")`, donc une valeur en tableau ou differente n'affiche rien ;
  - l'enchainement d'inscription fait un seul `POST /api/organizations` et ne reprend dans l'adresse qu'un UUID verifie ;
  - `useSubmit` garde un verrou synchrone contre le double envoi ;
  - le jeton est lu par `useSyncExternalStore` sur `location.hash`, n'est envoye qu'au clic et seulement dans le corps, et le fragment est efface avant la navigation.
- **Conformite :**
  - D-144 Q-1 : trois champs, `name` = adresse, inscription sans organisation sur la page d'acceptation ;
  - L-8 : liste fermee exacte dans `visible-text.ts`, U+200D non marque, transformation cote serveur ;
  - D-147 : texte et suites apres erreur implementes ;
  - D-143 : etiquette seule ;
  - les composants clients ne recoivent que des identifiants et des booleens, ce qui est plus strict que l'exception bornee du contrat.
- **Corrections de tests D-148 et D-149 :**
  - AC1 exclut seulement les identifiants de l'adresse demandee et ajoute une comparaison 307 existant / inexistant, ce qui renforce la preuve ;
  - AC3 garde l'egalite du texte visible ;
  - AC6 et AC7 gardent l'egalite des charges RSC apres remplacement ;
  - AC11 garde l'egalite hors echo et ajoute la preuve que l'invitation n'est pas consommee.

  Pour ces criteres, j'estime l'intention et la severite conservees. Le masque de D-149 est etroit : une chaine de 22 caracteres base64url finissant par `v` ou `m` ne peut correspondre ni a un UUID ni a une valeur de test.
- **Regles :**
  - aucun `any`, aucun `// TODO`, aucun `eslint-disable` dans le diff ;
  - aucun fichier de `app/api/`, `lib/` ou `packages/` modifie ;
  - aucune dependance ni migration (ERD sans objet).
- **Historique :** Conventional Commits, tests commites avant l'implementation, un commit de journal apres chaque couche.

## Bilan
- **Solide :** les pages appliquent dans l'ordre session, schema, appartenance puis role. L'isolation est prouvee par des 404 comparees octet a octet. L'affichage sur (marqueurs, liens, echappement) est prouve dans le HTML et dans la charge RSC. Les fonctions pures sont testees sans navigateur et avec des refus reels de better-auth.
- **Fragile :** AC5 ne compare plus les reponses alors que l'outil pour le faire existe, et les textes du contrat (AC2 e, AC5) ne disent plus ce que les tests prouvent. Les tests des fonctions pures sont types contre une copie des signatures.
- **Manquant :** un test du texte D-147 ; les validations humaines de D-145 et D-149 ; un build constate sur `main` hors environnement de test ; l'entree 24 du journal de projet (a la cloture).

REVIEW: PASS
