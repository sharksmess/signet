# Recette de la tranche 012 — ecrans (visite guidee, environ 15 minutes)

But : voir de vos yeux, dans votre navigateur, les ecrans que les tests automatiques ont deja prouves (AC17). Cochez chaque case, notez ce qui differe, puis consignez le resultat dans la fiche de preuves `docs/04-runbooks/evidence/012.md` **avant** la fusion.

Valeurs a utiliser : inventees et visiblement fausses (adresses en `.invalid`, noms « Org-Test-... »). Ne collez jamais une valeur de `.env` dans un ticket, une conversation ou ce fichier.

## Prerequis (une fois)
- [ ] `.env` aligne sur les roles : `docs/04-runbooks/stripe-facturation-locale.md`, section 1, **etape 4** (sans elle, `pnpm dev` refuse de demarrer).
- [ ] Controle du fichier, sans afficher aucune valeur : `.\scripts\env-check.ps1 -Local .env -Example .env.example` → aucune variable manquante.
- [ ] `pnpm db:migrate`, puis `pnpm dev` ; ouvrir `http://localhost:3100`.
- [ ] Deux navigateurs, ou une fenetre normale et une fenetre privee (deux comptes en meme temps).

## Ce qui n'est pas faisable sur le poste
- **Recevoir l'e-mail d'invitation** : en developpement, aucun e-mail ne part (`EMAIL_CAPTURE_URL` refusee hors `APP_ENV=test`), et sans serveur Inngest local l'invitation repond « service indisponible » (`503`). L'**acceptation reelle** et donc la **vue member** ne se voient pas ici : elles sont prouvees par les tests automatiques (`tests/screens/organizations.test.ts` AC5, `invitation-page.test.ts` AC11 et AC12).
- Le double clic, l'effacement du fragment apres acceptation et le rafraichissement apres ecriture ne sont testes par aucun robot (pas de navigateur dans les tests, D-137) : c'est cette visite qui les montre, quand c'est faisable.

## 1. Acces sans session (2 min)
- [ ] `http://localhost:3100/` → renvoi vers `/connexion`, adresse sans parametre.
- [ ] `/organisations` → meme renvoi.
- [ ] `/connexion` et `/inscription` s'affichent.

## 2. Inscription avec organisation (3 min) — fenetre A
- [ ] `/inscription` montre **exactement trois champs** : adresse, mot de passe, nom de l'organisation.
- [ ] Inscription avec `owner-recette@exemple.invalid`, un mot de passe de 8 caracteres ou plus, organisation `Org-Test-Recette` → arrivee sur la page de l'organisation.
- [ ] Bloc « Palier » visible : `Free`, `active` ; formulaire « Inviter » visible ; membres : votre adresse, `owner`.
- [ ] Bouton d'envoi : il se desactive pendant l'envoi (cliquez deux fois vite : une seule organisation creee).
- [ ] Revenir sur `/inscription` connecte → renvoi vers `/organisations`.

## 3. Mes organisations (1 min)
- [ ] `/organisations` liste `Org-Test-Recette` avec un lien vers sa page ; formulaire de creation present.
- [ ] `/organisations?creation=echec` → message fixe « Votre compte est cree, mais l'organisation n'a pas pu l'etre. Creez-la ci-dessous. » ; `/organisations?creation=autre` → aucun message.

## 4. Collections et liens (3 min)
- [ ] Creer la collection `Lectures` → elle apparait sans recharger la page a la main.
- [ ] Recreer `Lectures` → « Une collection de cette organisation porte deja ce nom. »
- [ ] Ouvrir `Lectures`, ajouter `https://exemple.invalid/article` titre `Article test` → ligne avec titre, nom d'hote a part, URL en texte, auteur (votre adresse), date `AAAA-MM-JJ HH:MM UTC`.
- [ ] Le lien s'ouvre dans un nouvel onglet.
- [ ] Ajouter `ftp://exemple.invalid` → message fixe commencant par « URL invalide : » ; la valeur saisie n'est pas reprise dans le message.

## 5. Valeurs piegees (2 min)
- [ ] Creer une collection nommee `<script>alert(1)</script>` → le texte s'affiche tel quel, **aucune** fenetre d'alerte.
- [ ] Ajouter un lien titre `"><img src=x onerror=alert(1)>` → texte affiche tel quel, aucune image cassee, aucune alerte.

## 6. Isolation (2 min) — fenetre B
- [ ] Fenetre B : inscription `autre-recette@exemple.invalid`, organisation `Org-Test-Autre`.
- [ ] Copier dans B l'adresse de la page `Org-Test-Recette` (fenetre A) → page « introuvable », sans le nom de l'organisation ni aucune adresse.
- [ ] Meme chose avec l'adresse de la collection `Lectures` → « introuvable ».
- [ ] `/organisations` de B ne liste que `Org-Test-Autre`.

## 7. Invitation (2 min)
- [ ] Fenetre A : inviter `autre-recette@exemple.invalid` → sans serveur Inngest, message fixe de service indisponible (comportement attendu en developpement, voir plus haut) ; avec le serveur Inngest local (`stripe-facturation-locale.md`, section 5), message de succes. Aucun e-mail n'arrive dans les deux cas.
- [ ] `/invitations/accept` sans `#token=` → « Lien d'invitation incomplet », aucun bouton d'acceptation.
- [ ] Fenetre B, `/invitations/accept#token=faux` → bouton « Accepter l'invitation » et « Se deconnecter » ; aucun envoi avant le clic ; apres le clic, message fixe d'invitation invalide ou introuvable, l'adresse du compte connecte est rappelee.
- [ ] Se deconnecter depuis cette page → les formulaires de connexion et d'inscription s'affichent **dans la page**, l'inscription sans champ d'organisation.

## Resultat
A recopier dans `docs/04-runbooks/evidence/012.md`, section « Visite guidee » : date, navigateur, cases cochees, ecarts constates (une ligne chacun), verdict (`conforme` / `ecarts`).
