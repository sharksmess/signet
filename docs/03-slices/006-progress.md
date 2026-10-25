# 006 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : ouverte
- Branche : slice/006-acceptation-invitation
- Dernier commit : 1bb5acd chore: installer l'usine 1.6.4 (puis commit d'ouverture `chore(slice-006): ouvrir la tranche`)
- Prochaine etape : `test-writer` ecrit les tests depuis AC1 a AC14 dans `tests/invitation-acceptance/`, plus la restriction du test AC15 de 003 (D-102 Q-3)

## Couches
- [ ] Migration (`0015_*` : `lookup_invitation`, `accept_invitation`, politiques `signet_definer`, privileges)
- [ ] Acces donnees
- [ ] Logique metier (decodage strict, empreinte, traduction des codes)
- [ ] API (`POST /api/invitations/accept`)
- [ ] UI — sans objet (tranche 012)
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->

## Decisions
- Gate d'ouverture : D-102 (Q-1 A, Q-2, Q-3, P-1 a P-7) et D-103 (condition de Q-3 reformulee : seule ecriture nouvelle = `UPDATE` borne a l'acceptation, AC13).
