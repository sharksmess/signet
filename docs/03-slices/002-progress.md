# 002 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : ouverte
- Branche : slice/002-abonnement-palier
- Dernier commit : chore(slice-002): ouvrir la tranche
- Prochaine etape : `test-writer` ecrit les tests de AC1 a AC17 dans `tests/billing/` (doublures `tests/billing/fakes/`), avant toute implementation

## Couches
- [ ] Migration (role `signet_billing` + INFO-1 ; `billing_event`, politiques, trigger, fonction definer)
- [ ] Acces donnees (connexion `signet_billing` isolee, lecture `subscription`)
- [ ] Logique metier (client Stripe, correspondance des statuts, fonction Inngest)
- [ ] API (`subscription` GET/POST, webhook Stripe, `/api/inngest`)
- [ ] UI — sans objet (Q-6, D-057)
- [ ] Documentation (ADR-0015, ADR-0016, ADR-0007, ADR-0011, ERD, contrat `subscriptions.ts`, runbook, `.env*.example`, CI)
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
- A prevoir avant le premier `pnpm test` avec la nouvelle migration de roles : l'humain fixe le mot de passe de `signet_billing` et complete `.env.test.local` (noms dans `.env.test.example`).

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Gate d'ouverture : D-057 (humain), D-058 a D-064 (claude-code), voir `002-abonnement-palier.md` § Decisions du gate d'ouverture.
