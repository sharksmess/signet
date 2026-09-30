---
name: rls-appartenance-decisions-rejetees
description: Options ecartees par ADR-0011 (RLS par appartenance de l'utilisateur de session, tranche 010) avec leur raison, pour ne pas les reproposer
metadata:
  type: project
---

ADR-0011 (2026-09-29, realise D-022 option A de l'humain ; B et C de D-022 ne se rouvrent pas).

**Mecanisme**
- Predicat `EXISTS member` dans chaque politique : recursion sur `member`, et chaque table future
  doit le recopier (oubli silencieux = tautologie, la faiblesse meme de D-022 option B).
- Nouvelle `current_member_org()` en gardant `current_org()` brute : le motif recopie
  `organization_id = current_org()` perd la verification en silence. Retenu a la place : redefinir
  `current_org()` (verifiee) + `context_org()` brute reservee a `signet_definer`.
- Politique `AS RESTRICTIVE` par table : meme discipline par table, facile a manquer en revue.
- Deriver l'utilisateur du jeton de session en base : couple tenant et tables d'auth, secret porteur
  dans un GUC, hors menace de D-022.

**Recursion** : proprietaire BYPASSRLS (refus humain D-009) ; proprietaire `signet_owner` (FORCE, ne
voit rien) ; table d'appartenance sans RLS (copie non gardee). Retenu : SECURITY DEFINER `signet_definer`.

**Volatilite** : VOLATILE (pas de cle d'index, rien gagne) ; IMMUTABLE (resultat fige dans un plan
prepare reutilise par le pool = fuite). Retenu STABLE.

**create_organization** : supprimer le parametre owner (change la signature pour rien) ; statu quo
(creation au nom d'un tiers). Retenu : lever SG002 si owner <> current_user_id().

**Contexte malforme** : attraper le cast et renvoyer NULL (masque un bogue serveur). Retenu : 22P02.

**Roles (0010)** : revoquer silencieusement les appartenances (cache une mauvaise config sur un etat
de cluster partage). Retenu : lever sur toute appartenance, reimposer les attributs.

**Why:** eviter de rediscuter ces options a la tranche 002/005/006.
**How to apply:** si quelqu'un propose l'une d'elles, renvoyer a ADR-0011 et a cette raison.
Voir [[schema-invariants]].
