---
name: audit-uuid-casse-comparaison-texte
description: Sur Signet, chercher les comparaisons d'UUID en TEXTE entre une valeur venue de l'API (casse libre) et uuid::text (minuscules) — faille trouvee a l'audit 002
metadata:
  type: project
---

Le schema `Uuid` du contrat (`z.string().uuid()`, Zod 4) accepte les majuscules et ne
normalise pas ; Postgres rend `uuid::text` en minuscules. Toute comparaison `text`
entre les deux (ex. `v_metadata_org IS DISTINCT FROM v_org::text`) est contournable
en changeant la casse dans l'URL.

**Why:** audit de la tranche 002 (2026-10-15) : l'UUID d'organisation passe tel quel
dans `metadata.organization_id` de Stripe ; la fonction `apply_stripe_subscription`
leve SG004 (non rejouable) sur tout evenement suivant -> annulation jamais appliquee,
Pro gratuit a vie. Aucun test n'utilisait de majuscules.

**How to apply:** a chaque valeur d'identifiant qui sort vers un systeme tiers
(metadonnees Stripe, file Inngest) puis revient, verifier normalisation ou comparaison
en type `uuid`. Voir [[audit-verifier-les-tests-pas-que-le-correctif]].
