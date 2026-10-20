# 003 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : ouverte
- Branche : slice/003-invitation-membre
- Dernier commit : chore(slice-003): ouvrir la tranche
- Prochaine etape : tests depuis les criteres d'acceptation AC1 a AC16 (`test-writer`), avant toute implementation

## Couches
- [ ] Migration
- [ ] Acces donnees
- [ ] Logique metier
- [ ] API
- [ ] UI (sans objet : ecrans en tranche 012)
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
- Action humaine attendue avant la premiere execution de la suite : ajouter a `.env.test.local` les nouveaux noms de `.env.test.example` (`INVITATION_TOKEN_KEY`, `TEST_SERVER_ENV_INVITATION_TOKEN_KEY` de meme valeur, `EMAIL_CAPTURE_URL`), valeurs inventees.

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Gate d'ouverture : D-086 (humain). Decisions locales : D-087 (expediteur et fausse messagerie), D-088 (une seule migration), D-089 (ADR-0017 reserve).
- `create_invitation` sans parametre `p_id` : avec l'option B, le scellement se fait apres l'insertion avec l'`id` retourne par la base ; l'identifiant n'a pas a etre genere cote application.
