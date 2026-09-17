---
paths: ["apps/web/**", "**/app/**", "**/*.tsx"]
---

# Next.js App Router

- **Les Server Actions sont des endpoints publics.** Elles exigent exactement la meme authentification, autorisation et validation qu'une route HTTP. Le fait qu'elles soient appelees depuis ton propre composant ne protege rien.
- Le cache de Next masque les erreurs d'isolation en developpement. Tout test d'isolation se fait avec **deux tenants reels**, jamais avec un seul compte.
- Toute entree externe passe par un schema Zod avant usage, y compris les parametres de route et les variables d'environnement.
- Les erreurs renvoyees au client ne revelent jamais l'existence d'une ressource d'un autre tenant. "Introuvable" et "interdit" doivent etre indistinguables de l'exterieur quand la ressource appartient a autrui.
- Pas de secret dans un composant client : tout ce qui n'est pas prefixe `NEXT_PUBLIC_` doit rester cote serveur, et ce qui l'est est public par construction.
- Les donnees sensibles ne transitent pas par les props d'un Server Component vers un Client Component : elles sont serialisees et visibles dans le HTML.
