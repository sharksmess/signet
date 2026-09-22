---
name: schema-invariants
description: Invariants non negociables du schema Signet (RLS, FK composite link/collection, compteur de quota) et ce qui casse si on y touche
metadata:
  type: project
---

Le schema Signet repose sur quatre invariants poses en phase 2. Les details vivent dans
`docs/02-architecture/ERD.md` ; ce qui suit est ce qui n'apparait pas dans le document et qu'on
redecouvrirait douloureusement.

1. **`link.organization_id` est denormalise ET verrouille par une FK composite**
   `FOREIGN KEY (collection_id, organization_id) REFERENCES collection (id, organization_id)`,
   ce qui impose un `UNIQUE (id, organization_id)` sur `collection` qui a l'air redondant avec la PK.
   Ne pas le supprimer en croyant nettoyer : sans lui, la FK composite ne compile pas et la
   politique RLS de `link` devient une affirmation non verifiee.
   **Why:** ADR-0001 interdit les politiques RLS a jointure transitive ; la denormalisation est
   donc obligatoire, et une copie que rien ne garde honnete est pire que la jointure.
   **How to apply:** toute nouvelle table enfant de `collection` ou `link` reprend le meme motif.

2. **Le compteur `organization_link_usage` n'est pas ecrivable par `signet_app`**
   (`REVOKE INSERT/UPDATE/DELETE`, triggers `SECURITY DEFINER`). Voir [[quota-decisions-rejetees]].
   **Why:** sinon un `UPDATE ... SET link_count = 0` finira par etre ecrit pour "reparer" une
   incoherence en prod, ce qui desactive le quota sans laisser de trace.
   **How to apply:** un desalignement se corrige par `signet.recompute_link_usage(org_id)`, jamais
   par un UPDATE manuel.

3. **Fermeture par defaut du contexte tenant.** `signet.current_org()` retourne NULL si
   `SET LOCAL app.organization_id` a ete oublie ; toute politique devient fausse. Un oubli fait
   echouer, il ne fait pas fuiter. `FORCE ROW LEVEL SECURITY` est indispensable en plus de
   `ENABLE`, sinon le role proprietaire (celui des migrations et des scripts d'exploitation)
   contourne tout silencieusement.

4. **Quatre fonctions `SECURITY DEFINER`, liste fermee** : `create_organization`,
   `organizations_for_user`, `lookup_invitation`, `accept_invitation`. Ce sont les seules
   operations qui precedent l'existence d'un contexte tenant.
   **Why:** sans cette liste posee d'avance, un role `BYPASSRLS` sera ajoute le jour ou quelqu'un
   butera sur l'acceptation d'invitation hors contexte tenant.
   **How to apply:** une cinquieme fonction de ce type est un signal de revue d'architecture, pas
   un detail d'implementation. Toutes doivent porter `SET search_path`.
