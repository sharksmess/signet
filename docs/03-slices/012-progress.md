# 012 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : ouverte
- Branche : slice/012-ecrans
- Dernier commit : (commit d'ouverture) chore(slice-012): ouvrir la tranche
- Prochaine etape : `test-writer` ecrit les tests de `tests/screens/**` depuis AC1 a AC14 (AC15 a AC17 : verifications ponctuelles et visite guidee, sans test permanent)

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
