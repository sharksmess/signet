---
name: ship
description: Phase 5. Met le produit en service : CI/CD, facturation Stripe, observabilite, runbooks et checklist de premiere mise en production. A lancer apres le durcissement.
disable-model-invocation: true
---

Phase 5. Le produit fonctionne en local ; il s'agit maintenant de le rendre exploitable par quelqu'un d'autre que toi, a 3 h du matin.

## 0. Prerequis
`.gates/04-hardening.approved` doit exister. Sinon, arrete-toi : mettre en service du code non durci deplace simplement le probleme en production, la ou il coute le plus cher.

## 1. Integration continue
Le pipeline rejoue exactement ce que `scripts/close-slice.sh` verifie en local. Si CI et local divergent, l'un des deux ment et personne ne saura lequel.

Etapes : installation figee (lockfile), controle de types, lint, tests unitaires, migrations sur base jetable, tests d'integration, build, E2E sur l'artefact construit.

Regles : la CI ne deploie jamais depuis une branche dont les tests n'ont pas tourne sur le commit exact deploye ; aucun secret dans les logs ; le lockfile fait foi.

## 2. Migrations en production
Le point ou l'on casse le plus de choses.
- Migrations appliquees **avant** le deploiement du code, et compatibles avec la version precedente. Une colonne supprimee alors que l'ancien code tourne encore provoque une panne pendant la bascule.
- Renommage = ajouter, doubler l'ecriture, migrer, supprimer plus tard. Jamais en une etape.
- Toute migration destructrice exige une sauvegarde verifiee et une procedure de retour ecrite avant d'etre lancee.
- Le rollback du code doit rester possible sans rollback de la base.

## 3. Facturation
Lis `stack.json` pour le prestataire retenu. Les invariants ne dependent pas de lui :

- **Le webhook est la source de verite**, pas le retour de la page de paiement. L'utilisateur ferme son navigateur avant la redirection : c'est le cas nominal, pas l'exception.
- **Signature verifiee avant tout traitement**, sur le corps brut de la requete. Un corps deja parse invalide la signature.
- **Idempotence par cle persistee.** Enregistre l'identifiant de l'evenement en base avec une contrainte d'unicite, et sors sans rien faire s'il est deja present. Le prestataire rejoue les evenements : sans cette table, un rejeu facture deux fois.
- **Repondre vite, traiter en asynchrone.** Accuse reception, puis mets en file. Un webhook qui depasse le delai est considere en echec et rejoue.
- **L'etat d'abonnement est derive des evenements**, jamais saisi a la main dans deux endroits differents.
- Traite explicitement : paiement echoue, periode de grace, resiliation en fin de periode, changement de palier au prorata, remboursement.
- Si la facturation est a l'usage, le comptage est une source de verite auditable : evenements horodates immuables, agregation calculee, jamais un compteur incremente qu'on ne peut pas reconstituer.

Teste avec les outils de rejeu du prestataire, y compris le double envoi du meme evenement. C'est le seul test qui compte.

## 4. Observabilite
Tu ne peux pas exploiter ce que tu ne vois pas.
- Erreurs remontees avec identifiants tenant et utilisateur, **sans donnee personnelle**.
- Traces sur les chemins critiques : authentification, paiement, taches de fond.
- Une alerte pour chacun des trois risques du PRD, et pour : taux d'erreur, latence, file bloquee, webhooks en echec.
- Une alerte qui se declenche sans action possible sera desactivee dans la semaine. Chaque alerte pointe vers son runbook.

## 5. Runbooks
Un fichier par mode de defaillance previsible dans `docs/04-runbooks/` : symptome observable, diagnostic en trois commandes, remediation, prevention. Au minimum : base saturee, webhooks en echec, file bloquee, deploiement a annuler, fuite de donnees suspectee.

Ecris-les maintenant, pas pendant l'incident.

## 6. Checklist de premiere mise en service
Sauvegardes automatiques **avec une restauration reellement testee** — une sauvegarde jamais restauree n'est pas une sauvegarde. Secrets en gestionnaire dedie, pas en variables d'environnement du tableau de bord. Rate limiting actif. En-tetes de securite. RLS verifiee en conditions reelles avec deux tenants. Procedure de suppression de compte et d'export des donnees. Page d'etat et canal de signalement.

## 7. Cloture
Resume ce qui est en place et ce qui reste ouvert. Le gate de mise en service est humain : `.\gates.ps1 approve-release`.

Puis lance `/retro` : c'est le moment ou la memoire des frictions est la plus fraiche.
