---
paths: ["**/db/**", "**/schema/**", "**/migrations/**", "**/*.sql"]
---

# Schema et migrations — Drizzle + Postgres

- **Drizzle ne genere pas les politiques RLS.** Elles vivent dans des migrations SQL ecrites a la main et versionnees, a cote des migrations generees. Une table ajoutee sans sa politique est une table ouverte a tous les tenants.
- Toute table portant de la donnee client reference son tenant **directement**, pas via une jointure transitive. Une politique qui depend de trois jointures est une politique qu'on desactivera un jour pour debugger.
- Le contexte tenant se pose par `SET LOCAL` au debut de la transaction, avec une connexion applicative **non privilegiee**. Le proprietaire de la table contourne RLS : ne l'utilise jamais pour les requetes applicatives.
- Cles primaires : UUIDv7 ou ULID. Jamais d'entier auto-incremente expose publiquement (fuite de volumetrie, enumeration triviale).
- `timestamptz`, jamais `timestamp`. Montants en entiers dans la plus petite unite monetaire, jamais en flottant.
- Unicite conditionnelle → index unique partiel, pas de verification applicative. Entre deux requetes concurrentes, la verification applicative perd.
- Colonne nullable → une ligne de justification en commentaire. Par defaut NOT NULL.
- Ne jamais modifier une migration committee. Renommage = ajouter, doubler l'ecriture, migrer, supprimer dans une migration ulterieure.

## Fonctions SECURITY DEFINER — liste obligatoire
Une telle fonction s'execute avec les droits de son proprietaire. Sous `NOBYPASSRLS` elle reste soumise a RLS : si elle ne pose pas son contexte, elle ne voit **aucune ligne** et conclut a tort, sans erreur. C'est arrive deux fois dans ce projet (suppression du dernier owner autorisee, quota jamais ferme).
1. `SET search_path = <schema>, pg_temp` dans la definition.
2. Proprietaire : un role dedie `NOLOGIN NOBYPASSRLS`, jamais le superutilisateur.
3. **Premiere instruction** : poser le contexte tenant de l'operation (`set_config('app.organization_id', ..., true)`) ; si l'identifiant est NULL, `RAISE EXCEPTION`. Echouer bruyamment, jamais conclure « rien a faire ».
4. Tout `UPDATE`/`DELETE` qui doit toucher une ligne verifie `GET DIAGNOSTICS n = ROW_COUNT` et leve une exception si `n = 0`.
5. `REVOKE ALL ON FUNCTION ... FROM PUBLIC`, puis `GRANT EXECUTE` au seul role appelant. La premiere migration pose `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` pour que les fonctions futures naissent fermees.
6. Un test qui appelle la fonction **sans** contexte et exige une erreur, et un test d'isolation croisee entre deux organisations.

Les points 1, 2 et 5 sont verifies automatiquement pour tout le schema par `tests/_factory/db-catalog.test.ts`.

## Limites, quotas, droits
- Une limite n'est jamais NULL au sens « illimite ». Valeur par defaut = la limite la plus restrictive (palier gratuit), `NOT NULL`, et une valeur sentinelle explicite si l'illimite existe. Un oubli doit fermer, pas ouvrir.
- Toute valeur par defaut de securite est restrictive : droits, visibilite, quotas, activation.

## Roles
- Les roles sont communs a tout le cluster (base de dev, de test, de CI) : leur creation est idempotente (`DO $$ ... IF NOT EXISTS ... $$`), jamais de `CREATE ROLE` nu.
- Aucun mot de passe dans une migration. Ils sont poses par l'humain (local) ou par la CI.
