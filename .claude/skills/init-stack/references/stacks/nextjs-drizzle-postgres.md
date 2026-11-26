# Profil — Next.js + Drizzle + Postgres

## Composition
Next.js (App Router, Server Components) · Drizzle ORM · PostgreSQL · Better-Auth ou Clerk · Stripe · Inngest · Vitest + Playwright · pnpm

## Ce que ce profil coute et rapporte
Un seul deploiement, un seul langage, un seul jeu de types de la base a l'interface : c'est le chemin le plus court vers un premier client payant. En contrepartie, la frontiere entre logique metier et rendu est faible par construction — elle ne tient que par discipline de dossier.

## Contrats d'API
Ecrits comme des schemas Zod dans `docs/02-architecture/api-contracts/*.ts`, importes par les Route Handlers et par les tests. Le contrat est le code, pas sa documentation.

## Multi-tenant
`shared-schema-rls` par defaut. Les politiques RLS Postgres s'appliquent meme si une requete oublie son filtre : c'est une defense qui survit a l'erreur humaine, contrairement a un filtre applicatif. Une connexion applicative non privilegiee, avec le contexte tenant pose par `SET LOCAL` au debut de chaque transaction.

## Pieges connus
- Les Server Actions sont des endpoints publics. Elles exigent la meme authentification, autorisation et validation qu'une route.
- Le cache de Next masque les erreurs d'isolation en developpement : teste toujours avec deux tenants reels.
- Drizzle ne genere pas les politiques RLS : elles vivent dans des migrations SQL ecrites a la main et versionnees.

## Commandes
```json
{ "dev": "pnpm dev", "test": "pnpm vitest run", "check": "pnpm tsc --noEmit && pnpm lint",
  "migrate": "pnpm drizzle-kit generate && pnpm drizzle-kit migrate" }
```
