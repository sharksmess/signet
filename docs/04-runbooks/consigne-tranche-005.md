# Consigne — ouvrir la tranche 005 (ajout d'un lien avec quota Free)

Redigee par l'orchestrateur (cowork) le 2026-10-26, objectif A (D-083, D-084). **Tranche la plus risquee du backlog** (PRD, risque #3) : menee avec l'humain, pas en mode autonome. A lire au lancement de `/slice 005`, **en plus** de la skill. Le contrat est relu par l'orchestrateur et valide par l'humain **avant** d'etre active.

## Sources a relire
PRD US-06 (et risque #3) ; **ADR-0002** (quota Free atomique), ADR-0001, ADR-0011 ; ERD §6 (`collection`, `link`, cle etrangere composite `(collection_id, organization_id)`) et les sections sur `organization_link_usage`, `link_quota`, `propagate_subscription_quota` (tranche 002, D-057 : `link_quota` NULL en Pro, 50 en Free) ; `docs/02-architecture/api-contracts/links.ts` (creation seulement) ; patron des tranches 003, 004, 006.

## Exigences pour le contrat
1. **Atomicite (ADR-0002)** : le refus du 51e lien est porte par la base, en une seule instruction ou sous verrou de ligne sur le compteur ; jamais « lire le compte puis ecrire ». Dis exactement le mecanisme et pourquoi il tient en `READ COMMITTED`.
2. **Preuves de concurrence** : 49 liens existants et N ajouts simultanes (N >= 5, depuis plusieurs connexions) -> exactement **un** reussit, les autres `409 FREE_TIER_QUOTA_EXCEEDED`, compteur et nombre reel de lignes egaux a 50 ; meme preuve repartie sur **plusieurs collections** de la meme organisation (« tous collections confondues ») ; Pro (`link_quota` NULL) : aucun refus ; organisation retrogradee au-dessus du quota (75 liens, tranche 002) : tout ajout refuse, rien de supprime.
3. **Coherence du compteur** : un test de catalogue ou d'invariant prouve que le compteur ne peut pas diverger du nombre reel de liens par les chemins de cette tranche (insertion refusee = compteur inchange). La suppression (007) est hors tranche : dis ce qui la garantira plus tard, sans l'implementer.
4. **URL (US-06.2) et securite** : seuls `http` et `https` sont acceptes (refus de `javascript:`, `data:`, `file:` et des URL sans hote), longueur bornee, message explicite ; c'est ce qui protegera les ecrans (012) d'un lien piege. Titre : 1 a 200 caracteres apres normalisation.
5. **Auteur et date (US-06.3)** : poses par le serveur (utilisateur de session, horloge de la base), jamais par le client.
6. **Isolation** : collection d'une autre organisation -> `404 COLLECTION_NOT_FOUND` identique a un identifiant inexistant ; test en base sous contexte etranger force ; impossible d'inserer un lien dont l'organisation differe de celle de sa collection.
7. **Fonctions definer** : s'il en faut, regle d'ADR-0011 (D-033) et test sous contexte etranger force.
8. **Tests** : aucune comparaison permanente a `main` ; valeurs de test inventees visiblement fausses.
9. **Dependances nouvelles** : aucune attendue.
10. Hors tranche explicite : liste et lecture des liens (009), suppression (007), ecrans (012), apercu ou verification en ligne des URL.

## Deroule
- Etapes 1 a 4 de la skill, puis **arrete-toi avant l'activation** : pas de `.gates/current-slice`, pas de commit d'ouverture, pas de `test-writer`.
- Rapport court et en clair : criteres et cas limites, mecanisme d'atomicite, perimetre, decisions prises, questions pour l'humain avec ta recommandation (la liste la plus courte possible).
- Apres validation humaine : activation, commit d'ouverture `chore(slice-005): ouvrir la tranche` (avec cette consigne, D-118, et la ligne 20 de `docs/00-context/JOURNAL.md` passee a « PR #34 fusionnee (commit 5ccd609) »), puis `test-writer`.
- Scripts et tests **au premier plan**. Fichier manquant au perimetre : demande a l'humain (`.\gates.ps1 scope-add`).
