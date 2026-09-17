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
