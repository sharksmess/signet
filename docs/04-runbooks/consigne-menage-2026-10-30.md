# Consigne — menage avant le second projet (Dependabot #35, note du relecteur)

Redigee par l'orchestrateur (cowork) le 2026-10-30. Lis `.claude/rules/dependencies.md`, `git.md` et `documentation.md`. Aucune tranche active : `apps/` et `packages/` fermes, sauf les manifestes `package.json` sur une branche `chore/` (usine 1.6.4). Un commit par etape, messages de 72 caracteres au plus, `git --no-pager`, **tests et scripts au premier plan** (si la plateforme en bascule un en arriere-plan, attends sa notification sans le relancer). Le poste reste eveille. Une seule PR, deux sujets dans des commits distincts.

## Ce que l'humain a deja decide (a inscrire au registre)
- **D-160 (humain, 2026-10-30)** : PR #42 (tranche 014) fusionnee ; **D-158 et D-159 validees** ; constat AC6 de 014 (client hors navigateur, sans `Origin`, `Referer`, `Cookie` ni `Sec-Fetch-*`, accepte par better-auth) : **option (a), accepte et documente** — pas une faille CSRF (un navigateur envoie toujours `Origin` sur un `POST` entre sites ; un client hors navigateur n'a pas les cookies de la victime et ne peut que creer son propre compte, comme par la page d'inscription ; tentatives repetees freinees par le limiteur d'ADR-0010). Ecartee : (b) exiger un indice de navigateur (modification d'`apps/`, gain de securite nul). L'entree du backlog correspondante passe a « accepte (D-160) » ; l'entree D-144 Q-2 (controle d'origine des routes d'ecriture de l'application, avant la mise en ligne) reste ouverte, inchangee.
- **Index du journal** : la ligne 26 passe a « PR #42 fusionnee (commit <hash du squash de #42 sur main, lu par `git log`>) ».

## Etape 0 — Branche
Depuis `main` a jour : `git switch -c chore/menage-2026-10-30`. Cette consigne, non suivie, te suit.

## Etape 1 — Dependabot #35 : inventaire
`gh pr view 35 --json title,body,files`. Tableau : paquet, version dans `main` -> proposee, nature (correctif ou mineure), avis de securite eventuel. Certaines peuvent etre deja dans `main` (correctifs du 25/10 et du 29/10, override `systeminformation`) : rien a faire pour elles. Le registre fait foi (`pnpm view <paquet> version`, `time`). Une **majeure** dans la liste : arrete-toi (decision humaine).

## Etape 2 — Application
Les mises a jour encore utiles, par les commandes pnpm (epinglage exact, `--filter` selon le paquet), **sans aucune exception a la quarantaine de pnpm** : une version encore en quarantaine est laissee de cote et notee. Commit : `build: mises a jour mineures et correctifs (Dependabot #35)`.

## Etape 3 — Preuve
`pnpm install --frozen-lockfile`, `pnpm run check`, `pnpm test`, `pnpm audit --prod --audit-level=high`. Tout doit passer. Un test qui echoue n'est jamais modifie ici : arret et rapport (nom du test et message). Un echec par delai sans lien avec les paquets (FRICTION) : rejoue le fichier seul, puis la suite une fois ; consigne-le.

## Etape 4 — Note de methode de `code-reviewer`
Le correctif mis de cote le 2026-10-29 (`code-reviewer-memory.patch`, dans ton dossier temporaire de session) : s'il existe encore, applique-le a `.claude/agent-memory/code-reviewer/` tel quel, sans le reecrire. S'il a disparu, ou si l'ecriture est refusee par un garde-fou : ne le reconstitue pas de memoire, note-le au backlog et passe a la suite. Commit : `docs: note de methode de code-reviewer`.

## Etape 5 — Documentation
- ADR des dependances : section datee « 2026-10-30 » dans ADR-0013 (comme D-154), avec le tableau de l'etape 1 et chaque paquet **nomme** (exige par `close-slice` et la regle des dependances) ; un nouvel ADR seulement si l'une des mises a jour change un comportement documente.
- `docs/DECISIONS.md` : D-160 (ci-dessus) ; D-161 (claude-code) pour les mises a jour de la #35 et, s'il y a lieu, la note de `code-reviewer`.
- Journal : entree 27 `docs/00-context/journal/27-menage-2026-10-30.md` et sa ligne d'index, avec la ligne 26 mise a jour.
Commit : `docs: ADR-0013, registre et journal 27`, avec cette consigne.

## Etape 6 — Livraison
`bash scripts/ship-branch.sh "chore: menage avant le second projet (Dependabot #35, note du relecteur)"`, puis arrete-toi avec le lien. Ne ferme pas la #35 : Dependabot la fermera apres la fusion (si elle reste ouverte, dis-le dans le rapport).

Rapport final court et en clair : tableau des paquets, resultats de l'etape 3, sort de la note du relecteur, lien de la PR.
