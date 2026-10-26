# Consigne — ouvrir la tranche 006 (acceptation d'une invitation)

Redigee par l'orchestrateur (cowork) le 2026-10-25, objectif A (D-083, D-084). A lire au lancement de `/slice 006`, **en plus** de la skill. Le contrat est relu par l'orchestrateur et valide par l'humain **avant** d'etre active.

## Avant tout : usine 1.6.4
L'humain a lance `update-factory.ps1` sur `main` (usine 1.6.4). Apres la creation de la branche, premier commit distinct : `chore: installer l'usine 1.6.4` (fichiers de l'usine que montre `git status --short`, `.claude/FACTORY_VERSION` = `1.6.4`), puis le reste de l'ouverture (D-101).

## Sources a relire
PRD US-03 ; ADR-0003, ADR-0004 (authentification, better-auth), ADR-0011 (regle d'audit-010 MINEUR-2 : fonctions definer), ADR-0017 (jeton scelle, lien en fragment `#token=`) ; ERD §1 et §5 (`lookup_invitation`, `accept_invitation`, consommation atomique) ; `docs/02-architecture/api-contracts/invitations.ts` (`acceptInvitation`) ; registre D-086 a D-095 (tranche 003), en particulier **D-090** (empreinte = sha256 des **32 octets decodes** du jeton) et **D-091** (dates en UTC).

## Exigences pour le contrat
1. **Empreinte identique a 003 (D-090)** : la route decode le jeton (base64url), refuse tout ce qui ne fait pas exactement 32 octets, puis hache les octets. Un test le prouve avec un jeton emis par la tranche 003 (bout en bout).
2. **Identite de l'invite** : dis comment US-03.1 est tenue (« cree le compte ou lie un compte existant ») : session better-auth existante, creation de compte dans la meme requete (le contrat prevoit `password` facultatif), ou passage par l'inscription d'abord. Dis aussi si l'adresse du compte doit **correspondre** a l'adresse invitee, et pourquoi. Recommande une option, ecris les autres.
3. **D-033 / ADR-0011** : `lookup_invitation` et `accept_invitation` sont `SECURITY DEFINER` sans contexte tenant ; chacune pose son contexte depuis une valeur de confiance (la ligne d'invitation retrouvee par l'empreinte) et lie l'utilisateur a `current_user_id()`. Un test par fonction sous contexte etranger force. `lookup_invitation` ne revele que le nom de l'organisation, l'adresse cible et la validite.
4. **Consommation atomique** : deux acceptations simultanees du meme jeton -> une seule appartenance, un seul `accepted_at` ; l'autre recoit `409 INVITATION_ALREADY_USED`.
5. **Cas limites listes** : jeton inconnu -> 404 ; malforme (pas 32 octets) -> 404 identique (ne rien reveler) ; expire -> 410 (calcul en UTC, D-091, test autour du changement d'heure) ; deja utilise -> 409 ; invite deja membre de l'organisation ; owner d'une autre organisation qui accepte (multi-organisation) ; compte supprime entre l'invitation et l'acceptation ; reponses d'erreur qui ne permettent pas d'enumerer les invitations.
6. **Secret** : le jeton n'apparait dans aucun journal, aucune erreur, aucune reponse ; il arrive dans le **corps** de la requete, jamais dans le chemin (contrat).
7. **Limitation de debit** : dis si la route publique d'acceptation passe par le limiteur existant (ADR-0010) ; sinon au backlog avec la raison.
8. **Tests** : aucune comparaison permanente a `main` (usine 1.6.4) ; valeurs de test inventees visiblement fausses (faible entropie).
9. **Dependances nouvelles** : aucune attendue.
10. Hors tranche explicite : ecrans (012), renvoi et revocation d'invitation, retrait d'un membre (008), fournisseur d'e-mails reel.

## Deroule
- Etapes 1 a 4 de la skill (choisir, branche, contrat, perimetre), puis **arrete-toi avant l'activation** : pas de `.gates/current-slice`, pas de commit d'ouverture, pas de `test-writer`.
- Rapport court et en clair : criteres et cas limites, perimetre, decisions prises, questions pour l'humain avec ta recommandation (la liste la plus courte possible).
- Apres validation humaine : activation, commit de l'usine 1.6.4 puis commit d'ouverture `chore(slice-006): ouvrir la tranche` (avec cette consigne et D-101), puis `test-writer`.
- Scripts et tests **au premier plan**. Fichier manquant au perimetre : demande a l'humain (`.\gates.ps1 scope-add`).
