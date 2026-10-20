# Consigne — ouvrir la tranche 003 (invitation d'un membre)

Redigee par l'orchestrateur (cowork) le 2026-10-20, objectif A (D-083, D-084). A lire au lancement de `/slice 003`, **en plus** de la skill. Le contrat est relu par l'orchestrateur et valide par l'humain **avant** d'etre active.

## Sources a relire
PRD US-02 (et US-03 pour ne pas empieter sur 006) ; ADR-0003 (jeton : empreinte SHA-256, jamais le secret), ADR-0004, ADR-0006 (Inngest : la ligne d'invitation fait foi, l'e-mail part en file), ADR-0011 (regle d'audit-010 MINEUR-2 sur les fonctions definer), ADR-0016 (patron Inngest et doublures de la tranche 002) ; ERD §5 (`invitation`, `invitation_pending_idx`) ; `docs/02-architecture/api-contracts/invitations.ts` ; backlog (ligne 003, Notes).

## Exigences pour le contrat
1. **Aucun fournisseur d'e-mails reel (D-083)** : l'envoi passe par une interface (« expediteur d'e-mails ») ; les tests utilisent une **fausse messagerie** qui capture les messages (modele du faux Stripe de 002). Le code de production sans fournisseur configure **echoue bruyamment** au premier envoi (jamais un succes silencieux). Le choix du fournisseur reel est hors objectif : ecris-le au backlog.
2. **Jeton (ADR-0003)** : genere cote serveur (aleatoire cryptographique, 32 octets au moins), seule son empreinte est en base ; le jeton n'apparait que dans l'e-mail (lien construit depuis `APP_URL`) ; jamais dans un journal, une reponse d'API, une erreur ou un evenement Inngest en clair. Un test le prouve (aucune colonne ni aucun evenement ne contient le jeton).
3. **Expiration** : 7 jours, imposes par la base (ERD §5) ; aucun appelant ne peut allonger le delai.
4. **ADR-0006** : la creation de l'invitation reussit meme si l'envoi echoue ; l'envoi est rejoue sans dupliquer l'invitation ; dis comment on evite d'envoyer deux fois le meme e-mail (ou pourquoi un double envoi est acceptable).
5. **Cas limites listes** : member -> 403 ; tenant B -> 404 (AC5) ; e-mail absent ou malforme -> 422 ; invitation deja en attente pour cet e-mail -> 409 ; e-mail normalise (casse, espaces) avant comparaison ; adresse d'un membre deja present ; l'owner qui s'invite lui-meme ; invitation expiree puis reinvitation ; deux invitations simultanees pour le meme e-mail (concurrence, index unique partiel).
6. **D-033** : toute fonction `SECURITY DEFINER` nouvelle suit la regle d'ADR-0011 (contexte depuis une valeur de confiance), avec un test sous contexte etranger force. `lookup_invitation` et `accept_invitation` appartiennent a 006 : ne les ecris pas ici.
7. **Abus** : dis si une limite d'envois par organisation est dans la tranche ou au backlog (audit-001 MINEUR-5 et audit-002 MINEUR-1 sont du meme ordre).
8. **Dependances nouvelles** : aucune attendue (fausse messagerie ecrite dans le depot) ; sinon ADR et quarantaine pnpm.
9. **Variables d'environnement** : noms seulement dans les modeles ; valeurs inventees en test et dans `ci/build.env` si le build en a besoin (de preference : lecture au premier usage, D-079).
10. Hors tranche explicite : acceptation (006), ecrans (012), fournisseur reel, renvoi manuel d'une invitation, revocation.

## Deroule
- Etapes 1 a 4 de la skill (choisir, branche, contrat, perimetre), puis **arrete-toi avant l'activation** : n'ecris pas `.gates/current-slice`, ne committe pas, ne lance pas `test-writer`.
- Rapport court : criteres et cas limites, perimetre, decisions prises et options ecartees, questions pour l'humain (avec ta recommandation, la plus courte liste possible).
- Apres validation humaine : activation, un seul commit d'ouverture `chore(slice-003): ouvrir la tranche` qui inclut aussi cette consigne et la ligne 15 de `docs/00-context/JOURNAL.md` (PR #28 fusionnee), puis `test-writer`.
- Scripts et tests **au premier plan**. Un fichier manquant au perimetre se demande a l'humain (`.\gates.ps1 scope-add`).
