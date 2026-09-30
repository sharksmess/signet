---
name: schema-invariants
description: Invariants non negociables du schema Signet (RLS verifiee par appartenance, primitives current_org/context_org, FK composite link/collection, compteur non ecrivable, liste fermee SECURITY DEFINER) et ce qui casse si on y touche
metadata:
  type: project
---

Les details vivent dans `docs/02-architecture/ERD.md` ; ce qui suit est ce qui n'apparait pas
dans le document et qu'on redecouvrirait douloureusement.

1. **`link.organization_id` est denormalise ET verrouille par une FK composite**
   `FOREIGN KEY (collection_id, organization_id) REFERENCES collection (id, organization_id)`,
   ce qui impose un `UNIQUE (id, organization_id)` sur `collection` qui a l'air redondant avec la PK.
   Ne pas le supprimer en croyant nettoyer.
   **Why:** ADR-0001 interdit les politiques RLS a jointure transitive ; une copie que rien ne garde
   honnete est pire que la jointure.
   **How to apply:** toute nouvelle table enfant de `collection` ou `link` reprend le meme motif.

2. **Le compteur `organization_link_usage` n'est pas ecrivable par `signet_app`**
   (`REVOKE INSERT/UPDATE/DELETE`, triggers `SECURITY DEFINER`). Voir [[quota-decisions-rejetees]].

3. **Deux primitives de contexte depuis la migration 0009 (ADR-0011, tranche 010)** :
   `signet.current_org()` = organisation du contexte **si l'utilisateur de session en est membre**
   (`SECURITY DEFINER`, proprietaire `signet_definer`), sinon NULL ; `signet.context_org()` = valeur
   brute, executable par `signet_definer` seul.
   - Politique `TO signet_app` : toujours `current_org()`. Politique `TO signet_definer` : jamais
     `current_org()` (recursion sur `member` + casse les fonctions sans utilisateur : webhook,
     create_organization avant l'INSERT member), toujours `context_org()` ou `current_user_id()`.
   - `current_org()` ne leve pas sur contexte absent (fermeture par defaut = 0 ligne ; isolation.test
     l'exige). Exception documentee a la regle « sans contexte, lever ».
   - `FORCE ROW LEVEL SECURITY` reste indispensable en plus d'`ENABLE`.
   **Why:** D-022 (humain) : la RLS doit etre une seconde barriere reelle contre l'oubli applicatif,
   et le motif recopie par les tranches futures doit etre sur par defaut.

4. **Pieges `SECURITY DEFINER` rencontres en concevant 010** :
   - `CREATE OR REPLACE FUNCTION` conserve le proprietaire : une fonction creee en 0001 par le role de
     migration (superuser) et passee en `SECURITY DEFINER` s'executerait hors RLS. Toujours
     `ALTER FUNCTION ... OWNER TO signet_definer`. Le test de catalogue de l'usine ne le voit pas (il
     exclut `current_user`).
   - `search_path` sans `pg_temp` explicite = `pg_temp` cherche EN PREMIER pour les relations ;
     `signet_app` a `TEMPORARY` par defaut. Toujours `..., pg_temp` en dernier + noms qualifies.
   - Codes d'erreur : ne pas reutiliser `42501` pour une garde metier, sinon un `GRANT EXECUTE`
     errone est masque dans les tests d'invariant (d'ou `SG002`).

5. **Liste fermee des `SECURITY DEFINER`** : points d'entree `create_organization`,
   `organizations_for_user`, `lookup_invitation`, `accept_invitation` (006) ; triggers
   `create_organization_counters`, `propagate_subscription_quota`, `assert_owner_remains` (+ compteur
   de liens en 005) ; primitive `current_org` (010). Toute nouvelle entree = revue d'architecture.

6. **La RLS verifie l'appartenance, pas le role** (sauf `subscription` owner). Le role reste une garde
   applicative (ADR-0004 etape 3, amendement 2026-09-29).
