# Memoire — architecte de donnees (Signet)

- [Invariants du schema](schema-invariants.md) — current_org verifiee / context_org brute (010), pieges SECURITY DEFINER, FK composite, compteur, liste fermee.
- [Decisions rejetees RLS appartenance](rls-appartenance-decisions-rejetees.md) — options ecartees par ADR-0011 (tranche 010) et pourquoi.
- [Decisions rejetees (quota, jeton)](quota-decisions-rejetees.md) — options ecartees en ADR-0002/0003 avec leur raison, pour ne pas les reproposer.
- [Questions metier ouvertes](signet-questions-ouvertes.md) — 11 trous de specification a la sortie de la phase 2, dont 3 bloquants par tranche.
- [Ecarts better-auth](better-auth-ecarts.md) — `app_user`, UUIDv7, flux d'invitation maison, et le carve-out des tables d'auth hors tenant.
