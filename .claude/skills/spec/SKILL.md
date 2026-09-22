---
name: spec
description: Phase 1. Produit le PRD du projet : perimetre du MVP, user stories avec criteres d'acceptation, hors-perimetre explicite et risques. A lancer au demarrage d'un projet, avant toute architecture.
disable-model-invocation: true
---

Phase 1. Produis `docs/01-product/PRD.md`. Aucun code, aucun schema, aucun choix de bibliotheque a ce stade.

Cette phase est celle que tout le monde bacle et qui coute le plus cher : un perimetre flou produit une architecture flexible, et une architecture flexible est une architecture lente a construire et impossible a durcir.

## 1. Interroger avant d'ecrire
Si les elements manquent, pose au maximum cinq questions ciblees, puis attends. N'invente jamais une reponse metier.

Si tu poses des questions a choix, chaque choix appelle ses details : un palier sans ses limites, un role sans ses droits, un quota sans son chiffre ne sont pas des reponses. Redemande-les avant d'ecrire.

Le minimum incompressible :
- **L'utilisateur et sa douleur.** Qui paie, pour resoudre quoi, et que fait-il aujourd'hui a la place.
- **L'unite de compte.** Utilisateur seul, ou organisation avec membres, roles et donnees partagees. Cette reponse determine le modele de donnees, la strategie d'isolation et le destinataire de la facture. C'est la question la plus structurante du PRD.
- **Le modele de revenu.** Abonnement par siege, par usage, par palier, hybride. Si c'est de l'usage, ce qu'on compte exactement : le comptage doit etre concu comme une source de verite auditable, pas ajoute apres coup.
- **Les contraintes.** Delai, budget d'infrastructure, reglementation, perspectives grands comptes (SSO, journal d'audit, residence des donnees).

## 2. Structure du PRD
```
# PRD — <produit>
## Probleme et utilisateur cible
## Perimetre du MVP
## Hors-perimetre (explicite)
## Unite de compte et modele de roles
## Modele de revenu et evenements factures
## User stories
   Pour chacune : id, enonce, criteres d'acceptation numerotes et verifiables
## Contraintes non fonctionnelles
   Charge attendue, latence acceptable, disponibilite, retention, reglementation
## Risques
   Les trois principaux, avec leur signal d'alerte precoce
## Hypotheses prises
   Toute zone d'ombre comblee par une hypothese, listee ici
```

La section **hors-perimetre** n'est pas de la decoration : elle est ce sur quoi tu t'appuieras pour refuser une derive dans six semaines. Sois specifique. "Pas de multi-devise", pas "pas de fonctionnalites avancees".

Un critere d'acceptation doit etre verifiable par un test. "L'interface est intuitive" n'en est pas un. "Un membre non-proprietaire recevant une invitation obtient une erreur 403" en est un.

## 3. Cloture
Le PRD ecrit, affiche le resume et arrete-toi. Tu ne peux pas approuver ce gate toi-meme : c'est a l'humain de lancer `.\gates.ps1 approve-prd` (ou `make approve-prd` hors Windows) apres lecture. Un hook bloque toute tentative d'approbation par un agent.
