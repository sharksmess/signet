# 010 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : tests ecrits
- Branche : slice/010-durcissement-isolation
- Dernier commit : e3b4dff test(slice-010): ecrire les tests d'acceptation
- Prochaine etape : migration 0009 (ADR-0011), jusqu'a ce que AC2-AC4 et les tests de catalogue de la tranche passent
- Etat des tests a l'ecriture : 28 echecs attendus (AC2, AC3, AC4, catalogue ADR-0011, concurrence, AC6 i-ii), 54 verts (suite 001, catalogue usine, AC5 API, AC6 iii, recursion, member non owner)

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
