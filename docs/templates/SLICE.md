# NNN — <capacite en une ligne>

## Capacite
En tant que <role>, je peux <action> afin de <benefice>.

## Perimetre
- **Touche** : <tables, modules, routes, ecrans>
- **NE touche PAS** : <ce qui est explicitement hors sujet, et vers quelle tranche cela renvoie>

## Dependances
- Tranches devant etre closes avant celle-ci : <ids ou "aucune">

## Contrat de donnees
| Table | Colonnes ajoutees / modifiees | Contraintes et index |
|---|---|---|
|  |  |  |

## Contrat d'API
| Route | Methode | Entree | Sorties | Role minimal | Idempotent sur |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## Criteres d'acceptation
- [ ] AC1 — <cas nominal>
- [ ] AC2 — <cas d'erreur metier>
- [ ] AC3 — <cas limite : doublon, expiration, concurrence, valeur absente>
- [ ] AC4 — <permission insuffisante>
- [ ] AC5 — **isolation tenant** : un utilisateur du tenant B ne peut ni lire ni modifier les donnees du tenant A via cette capacite. Obligatoire dans toute tranche.

## Anti-regression
- <ce qui ne doit pas casser, et le test qui le prouve>

## Notes d'implementation
- <pieges connus, decisions deja prises>
