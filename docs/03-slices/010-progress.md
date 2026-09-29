# 010 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : ouverte
- Branche : slice/010-durcissement-isolation
- Dernier commit : (ouverture) chore(slice-010): ouvrir la tranche
- Prochaine etape : `test-writer` ecrit les tests de `tests/isolation-hardening/` depuis AC1-AC6 et ADR-0011 § Tests exiges

## Couches
- [ ] Migration 0009 (RLS par appartenance, fonctions `signet.*`)
- [ ] Migration 0010 (attributs des roles)
- [ ] Acces donnees (`withTenant` : commentaires seulement)
- [ ] Logique metier — sans objet (aucune)
- [ ] API — sans objet (aucune route modifiee)
- [ ] UI — sans objet
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->

## Decisions
- Ouverture (orchestrateur) : conception confiee a `db-architect` avant de figer le perimetre de fichiers, pour savoir si un index ou le schema Drizzle devaient changer (reponse : non). ADR-0011 acceptee, y compris la correction `pg_temp` des trois fonctions de trigger, la garde `SG002` de `create_organization` et la levee sur appartenance de role (D-027, D-028).
