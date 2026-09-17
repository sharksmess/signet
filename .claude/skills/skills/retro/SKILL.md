---
name: retro
description: Transforme les frictions rencontrees pendant le travail en amendements concrets a l'usine (skills, hooks, agents, gabarits). A lancer en fin de tranche, de lot ou de projet.
disable-model-invocation: true
---

Boucle de capitalisation. Sans elle, l'usine est un gabarit fige : chaque projet redecouvre les memes frictions et rien ne remonte.

## 0. Ou vit la matiere premiere
Le journal `docs/04-runbooks/FRICTION.md` du projet. Chaque entree y est ecrite **au moment ou la friction survient**, pas reconstituee en fin de parcours : une friction notee trois jours plus tard a perdu son contexte et la solution qu'on avait en tete sur le moment.

Si le journal est vide ou absent, reconstitue-le a partir du journal git, des rapports d'audit et des tranches rouvertes, mais dis-le explicitement : une retro fondee sur une reconstitution vaut moins qu'une retro fondee sur des notes prises a chaud.

## 1. Classer, ne pas tout traiter
Pour chaque friction, une seule question : **est-ce que ca se reproduira sur le prochain projet ?**

- **Oui, mecaniquement** (hook trop strict, gabarit incomplet, etape manquante dans une skill) → amendement a l'usine.
- **Oui, mais propre au socle** (piege Drizzle, comportement Celery) → ajout au fichier de profil dans `references/stacks/`.
- **Non, circonstanciel** (erreur ponctuelle, dependance cassee ce jour-la) → ne rien faire.

Cette troisieme categorie est la plus importante. Une usine qui absorbe chaque incident devient un empilement de regles que plus personne ne lit, et qui perd donc toute force. Sois severe sur ce tri, et nomme dans le rapport ce que tu as ecarte et pourquoi.

## 2. Formuler l'amendement
Pour chacun :
- **Fichier de l'usine concerne** : chemin precis.
- **Nature** : hook trop strict / hook trop permissif / instruction manquante / instruction ambigue / gabarit incomplet / agent mal delimite.
- **Preuve** : ce qui s'est reellement passe. Un amendement sans incident concret derriere lui est une preference de style, pas un apprentissage.
- **Modification proposee** : le texte ou le code, redige, pas decrit.
- **Test associe** : le scenario a ajouter a `tests/run-tests.sh`. **Obligatoire pour toute modification de hook.** Un hook amende sans test est un hook qui cessera de mordre un jour sans que rien ne le signale.

## 3. Le cas particulier des hooks trop stricts
C'est la friction la plus frequente et la plus mal traitee. La tentation est d'assouplir le hook ; c'est presque toujours la mauvaise reponse, parce qu'on desarme une garantie permanente pour un cas particulier.

Ordre de preference :
1. Le perimetre de tranche etait mal declare → corriger la facon dont `/slice` le redige.
2. La regle est bonne mais son message est incomprehensible → ameliorer le message, pas la regle.
3. La regle a une exception legitime et nommable → l'ecrire explicitement dans le hook, avec son test.
4. La regle est fausse → alors seulement, la retirer, avec un ADR.

## 4. Livrable
`docs/04-runbooks/retro-<date>.md` : frictions retenues, amendements rediges, frictions ecartees avec leur raison.

Puis applique les amendements dans le depot de l'usine, incremente sa version dans `.claude-plugin/plugin.json`, ajoute une entree au `CHANGELOG.md`, et **lance `bash tests/run-tests.sh`**. Aucun amendement n'est termine tant que les tests ne passent pas.

Termine en rappelant que les projets existants ne recoivent rien automatiquement : ils doivent lancer `scripts/update-factory.ps1`.
