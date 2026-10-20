# 16 — Tranche 003 : invitation d'un membre (jeton scelle, fausse messagerie)

- **Dates** : 2026-10-20
- **Objectif** : permettre a l'owner d'inviter une personne par e-mail : invitation liee a l'organisation, expirant apres 7 jours, e-mail contenant un lien d'acceptation unique, sans aucun fournisseur d'e-mails reel (US-02, objectif A, D-083, D-084).

## Ce qui a ete fait
- Ouverture selon la consigne de l'orchestrateur (`docs/04-runbooks/consigne-tranche-003.md`) : contrat redige et arrete avant activation, quatre questions et deux propositions soumises a l'humain ; gate d'ouverture D-086 ; activation et commit d'ouverture (a249ffe).
- Tests avant le code par `test-writer` (ed81d0d) ; empreinte du jeton fixee par l'humain sur les 32 octets du secret, test corrige et renforce (D-090, cf2dc22).
- Implementation par `slice-implementer`, couche par couche :
  - migration `0014_invitation.sql` : table `invitation` (ERD §5), RLS forcee, politiques owner seul (P-3), `signet.create_invitation` en `SECURITY INVOKER`, dates en UTC (D-091), aucune fonction definer nouvelle ;
  - route `POST /api/organizations/:organizationId/invitations` : jeton aleatoire de 32 octets, empreinte seule en base, jeton scelle AES-256-GCM dans l'evenement Inngest (Q-1 B), mise en file avant le `COMMIT` et `503` sans rien creer si la file ne repond pas (Q-3, point de sauvegarde D-092), `409 ALREADY_MEMBER` owner compris (Q-2) ;
  - fonction Inngest d'envoi sans acces a la base, lien porte dans le fragment (P-1), expediteur « non configure » qui echoue bruyamment hors tests et fausse messagerie HTTP en test (D-087), erreurs rejouables ou non selon D-093 ;
  - ADR-0017, ERD, ADR-0003, ADR-0011, contrat `invitations.ts`, backlog.
- Trois blocages remontes sans contournement et tranches par l'humain (D-094) : defaut de `gate-check.sh` sur les crochets d'une route dynamique (perimetre elargi par `scope-add`), un test de 002 qui simulait la production avec une variable de test, un test de 003 defectueux (`rolname::text`).
- Trois relectures independantes en parallele sur b9e75a2 : securite PASS (2 mineurs), contrats PASS, code PASS avec cinq « A CORRIGER ».
- Corrections decidees par l'humain avant la cloture (D-095) : contrat et ERD alignes sur D-090 et P-3, ecart du commit c3e1c3e consigne, dix tests ajoutes (refus de cle a l'emission, fuseau UTC, journal d'abandon, rejouabilite) ; les deux mineurs de securite au backlog comme prealables au fournisseur reel.
- Seconde relecture de code, seule, en contexte neuf, sur 945f2b9 : PASS, aucun « A CORRIGER », quatre suggestions.

## Decisions
- D-086 : gate d'ouverture (Q-1 B jeton scelle, Q-2 `409 ALREADY_MEMBER`, Q-3 `503`, Q-4 limite d'envois au backlog, P-1 fragment, P-3 owner seul, cas residuel du lien inerte dans ADR-0017) (humain).
- D-087 a D-089 : expediteur et fausse messagerie, une seule migration, ADR-0017 (claude-code).
- D-090 : empreinte des 32 octets du secret (humain).
- D-091 a D-093 : dates en UTC, point de sauvegarde, rejouabilite et delais (claude-code, validees par l'humain en D-094).
- D-094 : trois blocages de l'implementation (humain).
- D-095 : corrections avant cloture et seconde relecture (humain).
Le detail est dans `docs/DECISIONS.md`.

## Preuves
- `pnpm test` : 364/364 en 31 fichiers sur 945f2b9 (execute au premier plan par l'orchestrateur), `pnpm run check` vert.
- Rapports des relecteurs : `docs/04-runbooks/audits/audit-003.md` (AUDIT: PASS), `contracts-003.md` (CONTRACTS: PASS), `review-003.md` (REVIEW: PASS, seconde relecture).
- Fiche de preuves `docs/04-runbooks/evidence/003.md` : produite par `scripts/close-slice.sh`.

## Incidents
- `gate-check.sh` lit `[organizationId]` d'un motif de perimetre comme une classe de caracteres : la route etait refusee. Le meme motif de 002 n'avait rien bloque, les garde-fous etant alors inoperants (D-082). Contournement par crochets echappes, ajoute par l'humain ; correction attendue dans l'usine, sinon 004, 005 et 012 seront bloquees (FRICTION, 2026-10-20).
- Passage a l'heure d'hiver du 25 octobre : 169 h au lieu de 168 h sur la base locale (Europe/Paris), invisible en CI (UTC) ; corrige par D-091, garde durable ajoutee par D-095.
- Commit c3e1c3e qui ne compile pas seul (symboles arrives au commit suivant) : consigne dans le journal de tranche, neutralise par le squash.
- Le hook `block-dangerous` refuse toute commande qui nomme un fichier `.env*`, y compris les modeles : lecture faite par l'outil dedie.
- `pnpm db:migrate` impossible sur la base de developpement (`DATABASE_URL_MIGRATE` absente du `.env`) : action humaine, deja connue (backlog, D-067).

## Etat a la fin
Code, migration 0014, tests (364/364) et documentation sur la branche `slice/003-invitation-membre`. Trois verdicts PASS. Aucun fournisseur d'e-mails reel : l'envoi echoue bruyamment hors tests, comme voulu (D-083).

## Etape suivante
`scripts/close-slice.sh`, puis `scripts/ship-slice.sh` (PR), CI, puis fusion par l'humain sur preuves. Ensuite, tranche 006 (acceptation d'une invitation), qui doit hacher les 32 octets decodes (D-090) et calculer ses dates en UTC (D-091).
