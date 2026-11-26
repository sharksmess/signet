# Profil — FastAPI + SQLAlchemy + Postgres

## Composition
FastAPI · SQLAlchemy 2.x + Alembic · PostgreSQL · Authlib ou Auth0 · Stripe · Celery ou ARQ · pytest · uv

## Ce que ce profil coute et rapporte
Le bon choix quand le produit a une composante donnees, calcul ou ML : l'ecosysteme est la et il n'y a pas de frontiere de langage entre l'API et le traitement. En contrepartie, le typage est plus lache qu'en TypeScript strict et la discipline doit venir de mypy en mode strict plus Pydantic, pas du langage.

## Contrats d'API
Modeles Pydantic dans `docs/02-architecture/api-contracts/`, importes par les routes et par les tests. Le schema OpenAPI genere est committe pour la detection de rupture.

## Multi-tenant
`shared-schema-rls`. Le contexte tenant est pose par `SET LOCAL` dans une dependance FastAPI qui ouvre la transaction. Attention aux taches de fond : Celery n'herite pas du contexte de la requete, chaque tache doit le reposer explicitement — c'est la source d'erreur numero un de ce profil.

## Pieges connus
- Le lazy loading de SQLAlchemy produit des N+1 invisibles en developpement. Charge explicitement.
- `mypy --strict` et Pydantic sont non negociables : sans eux ce profil perd la garantie qui justifie le pipeline.

## Commandes
```json
{ "dev": "uv run fastapi dev", "test": "uv run pytest",
  "check": "uv run mypy --strict . && uv run ruff check .",
  "migrate": "uv run alembic revision --autogenerate && uv run alembic upgrade head" }
```
