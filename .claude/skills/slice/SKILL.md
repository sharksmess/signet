---
name: slice
description: Ouvre une tranche verticale : redige son contrat, declare son perimetre de fichiers et l'active. A lancer avant chaque unite de travail, une fois l'architecture approuvee.
disable-model-invocation: true
---

Ouvre une tranche verticale. Une tranche est la seule unite de travail autorisee par l'usine : bornee, testable, close ou non ouverte.

## 1. Choisir
Lis `docs/03-slices/000-backlog.md` et propose la prochaine tranche selon l'ordre de dependance et de risque. Si l'humain en nomme une autre, verifie que ses dependances sont closes et signale-le sinon.

## 2. Rediger le contrat
Copie `templates/SLICE.md` en `docs/03-slices/NNN-<nom-court>.md` et remplis-le depuis le PRD et les contrats d'API. Les deux sections que l'on bacle et qui font toute la valeur :

- **NE touche PAS** — la liste explicite de ce qui est hors sujet. C'est ce qui te permettra de refuser une derive sans rediscuter le perimetre.
- **Criteres d'acceptation** — numerotes, verifiables par un test, incluant obligatoirement un critere d'isolation tenant (un utilisateur du tenant B ne peut ni lire ni modifier les donnees du tenant A via cette capacite). Meme si la tranche semble ne pas concerner le multi-tenant.

Une tranche sans cas limites listes (doublon, expiration, concurrence, permission insuffisante, valeur absente) est incomplete.

## 3. Declarer le perimetre de fichiers
Ecris `.gates/scope-NNN.txt` : un motif glob par ligne, les chemins que la tranche a le droit de modifier.

```
apps/api/src/modules/invitations/*
apps/api/src/db/schema/invitations.ts
apps/web/src/app/settings/team/*
tests/invitations/*
*migrations/*
```

Le hook `gate-check.sh` refusera toute ecriture hors de ces motifs. Sois precis : un motif trop large annule la protection, un motif trop etroit bloquera l'implementation sur un fichier legitime. En cas de doute, reste etroit — elargir prend dix secondes, une derive de perimetre coute une journee.

## 4. Activer
Ecris l'identifiant de la tranche dans `.gates/current-slice`, puis lance le sous-agent `test-writer` pour produire les tests depuis les criteres d'acceptation, avant toute implementation.

## 5. Rendre compte
Affiche le contrat de tranche, le perimetre declare, et la prochaine action : `/saas-factory:implement`.
