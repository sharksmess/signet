---
name: better-auth-ecarts
description: Ecarts assumes par rapport aux defauts de better-auth dans le schema Signet, et leur cout de configuration
metadata:
  type: project
---

Trois ecarts par rapport aux modeles par defaut de better-auth, decides en phase 2. Chacun coute
une ligne de configuration ou du code specifique ; les oublier fait echouer la premiere migration.

1. **Table `user` renommee `app_user`** (`schema.user.modelName = "app_user"`).
   **Why:** `user` est un mot reserve SQL, a quoter dans chaque migration RLS ecrite a la main —
   et ADR-0001 impose que ces migrations soient nombreuses et manuelles. Un oubli de quote casse
   une migration de securite.
2. **`advanced.database.generateId` doit produire un UUIDv7.** Par defaut better-auth genere des
   identifiants textuels, incompatibles avec les colonnes `uuid` du schema.
   **How to apply:** a verifier des la tranche d'authentification, avant toute insertion reelle.
3. **Le flux d'invitation du plugin `organization` n'est pas utilise** (ADR-0003) — le plugin reste
   utilise pour organisations, membres et organisation active en session.

**Carve-out d'isolation** : `app_user`, `session`, `account`, `verification` ne portent pas
d'`organization_id` — il n'y a pas de tenant a referencer (un utilisateur appartient a plusieurs
organisations, US-01.3 dit "au moins une"). Elles sont accedees par un role distinct `signet_auth`.
C'est la seule exception a la regle "chaque table reference son tenant", et elle est assumee, pas
un oubli. `app_user` garde tout de meme une politique en lecture pour `signet_app` : sans elle,
afficher l'auteur d'un lien (US-06.3) est impossible.

Voir [[schema-invariants]] et [[quota-decisions-rejetees]].
