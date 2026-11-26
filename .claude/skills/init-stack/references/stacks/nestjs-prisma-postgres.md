# Profil — NestJS + Prisma + Postgres

## Composition
NestJS · Prisma · PostgreSQL · Passport ou Auth0 · Stripe · BullMQ · Jest + Supertest · pnpm

## Ce que ce profil coute et rapporte
Les frontieres entre modules sont explicites et l'injection de dependances rend le test unitaire naturel. C'est le bon choix quand la logique metier est la difficulte principale. En contrepartie : plus de code d'infrastructure, une montee en charge plus lente au demarrage, et un frontend a deployer separement.

## Contrats d'API
DTO avec class-validator, exposes en OpenAPI genere. Le schema OpenAPI committe dans `docs/02-architecture/api-contracts/` est la reference que `contract-guardian` compare.

## Multi-tenant
`shared-schema-rls`. Prisma ne gere pas RLS nativement : passe par une extension de client qui pose le contexte tenant sur la connexion, et double d'un guard NestJS. Les politiques restent dans des migrations SQL manuelles.

## Pieges connus
- Un guard oublie sur un controleur ouvre la route a tout utilisateur authentifie, y compris d'un autre tenant. Applique les guards au niveau global et derogue explicitement, jamais l'inverse.
- Le middleware Prisma s'execute apres la construction de la requete : il ne rattrape pas un filtre tenant absent.

## Commandes
```json
{ "dev": "pnpm start:dev", "test": "pnpm jest", "check": "pnpm tsc --noEmit && pnpm lint",
  "migrate": "pnpm prisma migrate dev" }
```
