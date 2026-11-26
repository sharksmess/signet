# Consigne — analyse : d'ou vient l'adresse IP du limiteur de connexions ?

Redigee par l'orchestrateur (cowork) le 2026-11-26. `main` contient l'usine 1.6.7 (PR #52, D-167, D-168). **Analyse en lecture seule** : aucune branche, aucun commit, aucun fichier modifie, aucune commande qui ecrit. Tu n'ouvres, ne cherches ni ne cites jamais `.env*.local` ni `*.local.ps1`. Aucune sortie coupee : sortie complete dans `.logs/analyse-ip-*.log`, puis lue.

## Pourquoi
Dans le second projet (liste-courses), la relecture de la tranche 001 a trouve un defaut MAJEUR : la limite de tentatives de connexion prenait l'adresse IP du client dans l'en-tete `X-Forwarded-For`, que n'importe quel client peut ecrire lui-meme. En changeant cet en-tete a chaque requete, un attaquant obtenait un compteur neuf a chaque essai : la limite ne limitait plus rien. Signet a un limiteur du meme genre (backlog : « source de l'adresse IP du limiteur de connexions »). Il faut savoir s'il a le meme defaut.

## Ce que tu cherches (code de l'application et de ses dependances directes, par `git grep` ou l'outil Read)
1. **Ou est le limiteur** : celui de better-auth (`rateLimit`, et ses options `advanced.ipAddress`, `ipAddressHeaders`, `disableIpTracking`, ou leurs equivalents dans la version installee — lis le code de better-auth dans `node_modules`, pas la documentation de memoire), et tout limiteur maison (`AUTH_RATE_LIMIT` ou autre). Fichiers et lignes.
2. **D'ou vient l'IP** pour chacun : quel en-tete ou quelle source, dans quel ordre, avec quel repli. Cite le code exact.
3. **Est-ce falsifiable** : un client qui envoie lui-meme `X-Forwarded-For` (ou un autre en-tete lu) change-t-il la cle du compteur ? Que se passe-t-il sans aucun en-tete (toutes les requetes partagent-elles un seul compteur) ?
4. **Ce que prouvent les tests existants** : un test envoie-t-il des en-tetes d'IP differents et verifie-t-il que la limite tient quand meme ? Lequel, ou aucun.
5. **Ce qui depend de l'hebergement** : la bonne source d'IP depend de la plateforme de mise en ligne (son proxy ecrit ou nettoie certains en-tetes). Releve ce que le projet dit deja de son hebergement (ADR, PRD, backlog) ; ne choisis pas de plateforme.

## Verdict attendu
Un des trois :
- **A — non falsifiable** (preuve : code et, si possible, test existant) ;
- **B — falsifiable** (scenario concret : requetes, en-tetes, consequence) ;
- **C — indetermine** (ce qui manque pour conclure).

Pour B, propose 2 ou 3 options de correction (avec ce que chacune suppose de l'hebergement) et dis ce qu'exigerait une tranche de correction : fichiers touches, tests a ecrire (dont un test qui envoie un `X-Forwarded-For` different a chaque essai et verifie que la limite tient), decision humaine a prendre. **Ne corrige rien.**

## Rapport
Ecris l'analyse complete dans `docs/04-runbooks/audits/analyse-ip-limiteur.md` (le seul fichier que tu crees ; il reste non committe, l'humain decidera de sa livraison avec la suite). Puis arrete-toi avec un rapport court et en clair : verdict, preuve, options, prochaine decision humaine.
