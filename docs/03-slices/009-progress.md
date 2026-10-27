# 009 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : tests ecrits (rouges : routes GET absentes, 405)
- Branche : slice/009-consultation
- Dernier commit : aec6dd4 test(slice-009): criteres d'acceptation de la tranche 009
- Prochaine etape : implementer les deux GET (acces donnees, logique metier, API) jusqu'a ce que `pnpm vitest run tests/consultation` soit vert

## Couches
- [ ] Migration — sans objet (D-131 point 5 : aucune migration)
- [ ] Acces donnees
- [ ] Logique metier
- [ ] API
- [ ] UI — sans objet (tranche 012)
- [ ] Suite complete verte + `pnpm run check`

## Blocages

## Decisions
- Ouverture (orchestrateur) : lectures de forme D-132 (contrat de tranche, section « Lectures de l'orchestrateur ») ; ERD §6.1 aligne sur D-131 point 1.
- Tests (test-writer) : 38 tests dans `tests/consultation/` (nominal, order, errors, isolation, read-only) + `tests/helpers/consultation.ts`. 36 echouent en 405 (GET non exporte) ; 2 passent deja (AC6 d, SELECT sous signet_app : la RLS existe deja, non-regression).
- Horodatage egal (AC2) : ids fixes par le test (prefixe aleatoire + suffixe 1 a 6) inseres dans l'ordre 3,6,1,5,2,4, pour que l'ordre d'insertion differe de l'ordre des ids de facon deterministe ; precondition verifiee (un seul created_at).
- Messages de 422 : on prouve qu'ils sont fixes (sans la valeur soumise ni Zod) et lesquels sont distincts, sans figer les textes (precedent D-124).
- AC9 : un test supplementaire sur le nom de collection (le contrat de creation l'accepte ; le contrat de tranche rend `name` tel qu'enregistre). D-131 point 4 ne cite que l'URL et le titre : extension inscrite en D-132 point 6 par l'orchestrateur, a valider par l'humain.
