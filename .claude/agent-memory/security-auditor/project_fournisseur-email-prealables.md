---
name: audit-fournisseur-email-prealables
description: Quand une tranche branche un vrai fournisseur d'e-mails sur Signet, verifier la limite d'envois ET le nom d'organisation (texte libre de l'owner) dans le corps de l'invitation
metadata:
  type: project
---

A l'audit 003 (2026-10-20), l'envoi d'invitation n'avait aucun fournisseur reel
(EMAIL_PROVIDER_NOT_CONFIGURED) : spam et hameconnage non exploitables. Deux prealables
au fournisseur : limite d'envois par org/owner (backlog, D-086 Q-4) et contenu du nom
d'organisation (120 car., URL acceptee) repris dans le corps de l'e-mail.

**Why:** tout inscrit cree une org, devient owner et peut faire envoyer depuis le domaine
Signet un texte qu'il choisit a n'importe quelle adresse.

**How to apply:** a la tranche du fournisseur reel, ces deux points passent de MINEUR a
MAJEUR s'ils ne sont pas traites. Voir [[audit-uuid-casse-comparaison-texte]].
