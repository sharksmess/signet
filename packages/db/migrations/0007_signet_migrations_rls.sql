-- Migration 7 — `public._signet_migrations` fermee (constat de
-- tests/_factory/db-catalog.test.ts : toute table applicative de `public` a
-- RLS active ET forcee).
--
-- Cette table n'est pas creee par une migration mais par
-- packages/db/src/migrate.ts (ensureMigrationsTable), avant la premiere
-- d'entre elles, sous le role bootstrap qui joue DATABASE_URL_MIGRATE. Elle
-- existe donc toujours quand ce fichier s'execute.
--
-- RLS activee et forcee SANS AUCUNE POLITIQUE : fermeture totale pour tout
-- role qui n'a pas BYPASSRLS, proprietaire compris. Seul un superutilisateur
-- (le role bootstrap des migrations, ADR-0007) la lit et l'ecrit encore. Le
-- REVOKE retire en plus tout privilege de table herite de PUBLIC : les roles
-- applicatifs n'ont aucune raison de connaitre l'historique des migrations.

ALTER TABLE public._signet_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._signet_migrations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public._signet_migrations FROM PUBLIC;
