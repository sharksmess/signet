# Memoire — architecte de donnees (Signet)

- [Invariants du schema](schema-invariants.md) — FK composite link/collection, compteur non ecrivable, fermeture par defaut du RLS, liste fermee des SECURITY DEFINER.
- [Decisions rejetees (quota, jeton)](quota-decisions-rejetees.md) — options ecartees en ADR-0002/0003 avec leur raison, pour ne pas les reproposer.
- [Questions metier ouvertes](signet-questions-ouvertes.md) — 11 trous de specification a la sortie de la phase 2, dont 3 bloquants par tranche.
- [Ecarts better-auth](better-auth-ecarts.md) — `app_user`, UUIDv7, flux d'invitation maison, et le carve-out des tables d'auth hors tenant.
