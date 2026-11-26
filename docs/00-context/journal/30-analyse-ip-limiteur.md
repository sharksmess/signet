# 30 — Analyse de la source d'IP du limiteur de connexions

- **Dates** : 2026-11-26
- **Objectif** : savoir si le limiteur de connexions de Signet a le defaut trouve dans liste-courses (tranche 001) : une adresse IP prise dans `X-Forwarded-For`, que le client peut ecrire lui-meme.

## Ce qui a ete fait
- Consigne de l'orchestrateur `docs/04-runbooks/consigne-analyse-ip-limiteur.md`, analyse en lecture seule sur `main` a `af67d0e` : code de l'application, `better-auth` et `@better-auth/core` 1.7.13 et `next` 16.4.5 lus dans `node_modules`.
- Verdict **B, falsifiable** : sans `advanced.ipAddress`, better-auth croit une valeur unique de `X-Forwarded-For`, et Next ne remplace pas l'en-tete envoye par le client. Contournement par en-tete change a chaque essai, blocage d'une victime par usurpation de son IP, compteur partage par tous derriere un proxy qui ajoute a l'en-tete. Aucun test n'exerce le limiteur reel. Trois options de correction, sans rien corriger. Rapport : `docs/04-runbooks/audits/analyse-ip-limiteur.md`.
- Branche `docs/analyse-ip-limiteur` : analyse et consigne committees, D-169 au registre, ligne MINEUR-11 du backlog mise a jour (bloquant, renvoi a l'analyse, test exige).

## Decisions
- D-169 : defaut confirme ; correction reportee au choix de l'hebergement ; bloquant avant toute mise en ligne ; limite par compte a trancher au meme moment (humain). Le detail est dans `docs/DECISIONS.md`.

## Preuves
Citations de code exactes dans le rapport d'analyse (fichiers et lignes de `node_modules`). Documentation seule : hook pre-push et CI de la PR.

## Incidents
Le garde-fou `block-dangerous` a refuse un `grep -r` dans `node_modules` non filtre ; relance avec `--include='*.mjs'`.

## Etat a la fin
Defaut documente et bloquant pour la mise en ligne ; aucune exposition aujourd'hui (application non en ligne). PR ouverte.

## Etape suivante
Fusion par l'humain. Au choix de l'hebergement : decider de l'option 1 ou 2 et de la limite par compte, puis ouvrir la tranche de correction.
