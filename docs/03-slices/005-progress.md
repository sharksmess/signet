# 005 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : ouverte
- Branche : slice/005-ajout-lien
- Dernier commit : chore(slice-005): ouvrir la tranche
- Prochaine etape : `test-writer` ecrit `tests/links/**` depuis AC1 a AC14 (et l'ajout D-121 aux deux tests de catalogue), avant toute implementation

## Couches
- [ ] Migration
- [ ] Acces donnees
- [ ] Logique metier
- [ ] API
- [ ] UI (aucune : ecrans en 012)
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->

## Decisions
- Ouverture : contrat valide par l'humain avant activation (D-119 a D-122). `addLink.input.url` resserre au commit d'ouverture (D-120), regle verifiee hors depot sur les 18 refus et 5 acceptations d'AC3 ; `pnpm typecheck` vert.
