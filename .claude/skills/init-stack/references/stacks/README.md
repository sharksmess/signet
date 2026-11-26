# Profils de socle technique

L'usine est parametrable au niveau du plugin, **gelee au niveau du projet**.
Un projet choisit son profil une fois via `/saas-factory:init-stack`, puis
`stack.json` devient immuable a partir de l'approbation de l'architecture.

C'est ce qui donne les deux proprietes a la fois : les skills restent
reutilisables entre projets, et a l'interieur d'un projet donne elles
parlent d'un socle concret et non d'abstractions.

Ajouter un profil = ajouter un fichier ici. Aucun autre fichier a modifier.

| Profil | Quand le choisir |
|---|---|
| `nextjs-drizzle-postgres` | SaaS B2B classique, une equipe, time-to-market prioritaire |
| `nestjs-prisma-postgres` | Backend riche en logique metier, frontend separe, equipe habituee au DDD |
| `fastapi-sqlalchemy-postgres` | Produit a composante donnees ou ML, equipe Python |
