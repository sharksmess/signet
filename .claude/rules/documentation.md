# Documentation : tout est ecrit dans le depot

Toujours charge. Regle posee par l'humain le 2026-09-28 : **chaque decision et chaque choix du projet est documente dans le depot.** Une decision qui n'existe que dans une conversation est perdue a la fin de la session, et un auditeur externe ne peut pas evaluer ce qu'il ne peut pas lire.

## Ou ecrire quoi
| Nature | Ou | Qui |
|---|---|---|
| Toute decision, quelle qu'elle soit | une ligne dans `docs/DECISIONS.md` (registre unique, chronologique) | celui qui decide ou l'orchestrateur qui la recoit |
| Choix structurant : architecture, dependance, securite, donnees, outillage | un ADR `docs/02-architecture/ADR/NNNN-*.md`, reference dans le registre | l'agent qui propose, statut « accepte » seulement apres accord humain si le choix engage le produit |
| Decision locale d'implementation | section « Decisions » du journal `docs/03-slices/NNN-progress.md`, reprise dans la PR | l'implementeur |
| Decision humaine (gate, arbitrage, fusion, priorite) | registre, decideur « humain », avec les options presentees et la raison | l'orchestrateur, jamais reformulee |
| Produit (perimetre, regle metier) | registre + mise a jour du PRD ou du backlog dans la meme PR | l'orchestrateur |
| Schema de donnees | `docs/02-architecture/ERD.md`, dans la meme PR que la migration | l'implementeur |
| Incident, friction, contournement | `docs/04-runbooks/FRICTION.md`, au moment ou il survient | quiconque le constate |
| Procedure | `docs/04-runbooks/` | l'orchestrateur |
| Recapitulatif d'etape (tranche livree, adoption d'usine, point d'arret) | une entree `docs/00-context/journal/NN-titre.md`, indexee dans `docs/00-context/JOURNAL.md` | l'orchestrateur, a la fin de l'etape |

## Format d'une ligne du registre
`| D-NNN | AAAA-MM-JJ | decision en une phrase | decideur | portee (tranche, projet, usine) | lien : ADR, journal, PR |`

Les identifiants ne sont jamais reutilises. Une decision remplacee reste dans le registre, marquee « remplacee par D-NNN ».

## Journal de projet
Chaque etape franchie laisse un recapitulatif lisible en deux minutes (gabarit `docs/templates/JOURNAL-ENTREE.md`) : objectif, ce qui a ete fait, decisions (numeros du registre), preuves (commits, PR, fiche de preuves), incidents, etat a la fin, etape suivante. Il part **dans la PR de l'etape** ; une etape sans PR (point d'arret, arbitrage) part dans une PR `docs/`. C'est l'historique que l'humain et un auditeur externe lisent en premier (Signet, decision D-037).

## Regles
- La documentation part **dans la meme PR** que le changement qu'elle explique. Pas de « je documenterai apres ».
- Une hypothese est une decision : si tu combles un trou de specification, c'est que tu as decide. Arrete-toi et demande (CLAUDE.md), ou, si le cadre t'y autorise, ecris-la.
- Ecris le **pourquoi** et les **options ecartees**, pas seulement le quoi : c'est ce qui evite de rediscuter la meme question dans trois semaines.
- `scripts/close-slice.sh` verifie mecaniquement une partie de cette regle : ADR pour toute dependance ajoutee, ERD modifie si une migration est ajoutee, journal de decisions renseigne, tranche citee dans le registre et dans le journal de projet. Le relecteur (`code-reviewer`) verifie le reste.
