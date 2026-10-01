# Relecture de code, tranche 011 (slice/011-montee-next16, a2af79f, base main 192dd46)

## Methode
J'ai lu le diff complet `git diff main...HEAD` (11 commits, 20 fichiers), le contrat, le journal, ADR-0013, les amendements d'ADR-0008 et d'ADR-0009, le cadrage du backlog, D-041, `.claude/rules/dependencies.md`, `documentation.md` et `git.md`.

J'ai aussi fait des controles en lecture seule, sans lancer `pnpm test` et sans rien laisser sur disque :
- **Exports reels d'`eslint-config-next@16.3.7`.** `core-web-vitals` exporte 4 objets et `typescript` en exporte 5. Chacun contient exactement un objet `{ ignores: [".next/**","out/**","build/**","next-env.d.ts"] }`, sans `name`.
- **Configuration resolue (`calculateConfigForFile`).** `apps/web/src/lib/organizations.ts` et `packages/db/src/migrate.ts` resolvent tous deux `ban-ts-comment` en `[2,{"ts-expect-error":true,"ts-ignore":true,"ts-nocheck":true}]` et `no-explicit-any` en `[2]`. Le parseur est `typescript-eslint/parser` et `projectService` est conserve.
- **Ignores (`isPathIgnored`).** Le filtre est bien effectif : `out/x.ts` et `build/x.ts` ne sont pas ignores, `apps/web/next-env.d.ts` l'est.
- **Perimetre.** `git diff main --stat -- apps/web/src packages tests/organizations tests/isolation-hardening tests/_factory` est vide, et `pnpm-workspace.yaml` n'a pas change (aucun `minimumReleaseAgeExclude`).
- **Messages de commit.** Les 11 sujets respectent Conventional Commits, 59 caracteres au plus, avec le trailer `Slice: 011`. Le commit 814ff9d, qui regroupe versions et configuration, explique pourquoi dans son corps.

## Constats

### A CORRIGER

**1. Toute PR Dependabot `majeures` sera bloquee par `eslint` 10, et le refus est manuel**
- **Emplacement :** `.github/dependabot.yml:19-20`, ADR-0013 section « Consequences acceptees » (1re puce), `docs/03-slices/000-backlog.md:73`.
- **Constat :** l'ADR et le backlog demandent de « refuser les PR Dependabot qui montent `eslint` en 10 ». Or le groupe `majeures` regroupe toutes les montees majeures npm dans une seule PR. Chaque semaine, `eslint` 10 y figurera tant qu'`eslint-plugin-react` n'aura pas suivi.
- **Consequence :** refuser la PR fait perdre toutes les autres majeures du groupe. L'accepter casse `pnpm run check`. La tranche vient de corriger ce meme probleme pour `@types/node` (D-040) avec un `ignore`, mais pas pour `eslint`, alors que le blocage est reproduit et documente.
- **Direction :** ajouter un `ignore` `semver-major` pour `eslint`, lie au signal de reexamen d'ADR-0013 et couvert par un test `tests/stack-upgrade`. Sinon, ecrire explicitement au registre qu'on accepte de refuser ces PR a la main. Cela peut aller au backlog, puisque le contrat limitait le changement Dependabot a `@types/node`.

**2. L'egalite stricte `next` = `eslint-config-next` bloquerait une PR de securite isolee**
- **Emplacement :** `tests/stack-upgrade/versions.test.ts:55-59`, ADR-0013 section « Consequences acceptees » (5e puce).
- **Constat :** les montees courantes sont groupees, donc les deux paquets bougent ensemble. Mais les mises a jour de securite de Dependabot ne suivent pas les `groups` de version (elles ne sont groupees que par une configuration dediee). Un avis visant `next` ouvrirait une PR qui ne monte que `next`, et le test la ferait echouer.
- **Consequence :** le correctif de securite serait retarde, alors que `dependencies.md` lui donne priorite « dans les 48 h ». L'ADR ne mentionne ce risque que pour « un groupe qui ne monterait que l'un des deux ». L'egalite est bien exigee par l'AC1 du contrat : le code est conforme, c'est la regle qui a cet effet.
- **Direction :** dans l'ADR, soit nommer ce cas avec la procedure a suivre (monter `eslint-config-next` a la main dans la PR), soit ajouter un groupe Dependabot `next` + `eslint-config-next` qui couvre aussi les mises a jour de securite, soit relacher le test a la meme ligne majeure.mineure.

### SUGGESTION

**3. Le filtre des ignores globaux n'est garde par aucun test**
- **Emplacement :** `eslint.config.mjs:16-20`, `tests/stack-upgrade/lint-scope.test.ts`.
- **Constat :** le filtre et son commentaire sont exacts pour 16.3.7. Deux derives possibles d'une future version passeraient sans aucun signal :
  - un objet d'ignores global portant une nouvelle cle (par exemple `basePath`, pris en charge par ESLint 9.30+) ne serait plus filtre, et `out/**` et `build/**` entreraient silencieusement dans les ignores ;
  - un motif utile ajoute dans ces objets serait perdu. L'ADR le reconnait en consequence, mais rien ne le detecte.
- **Direction :** ajouter un test qui verifie que la liste filtree par `eslint-config-next` est exactement celle constatee, ou au minimum que `isPathIgnored("out/x.ts")` reste faux. Une montee de Dependabot qui change cette liste ferait alors echouer la CI de facon visible.

**4. Le test AC2 ne verifie que la severite, pas les options conservees**
- **Emplacement :** `tests/stack-upgrade/lint-scope.test.ts:62-68`.
- **Constat :** l'ADR ecrit « options conservees » pour `ban-ts-comment`. C'est vrai aujourd'hui, je l'ai constate. Mais cela tient seulement parce que `typescript-eslint/recommended`, ajoute apres les regles du depot, ne donne que la severite. Le test normalise en 0/1/2 : si une future version d'`eslint-config-next` fournit les options par defaut (`ts-expect-error: "allow-with-description"`), `@ts-expect-error` redeviendrait autorise dans `apps/web` et le test resterait vert.
- **Direction :** comparer aussi les options de `ban-ts-comment` a `{ts-expect-error:true, ts-ignore:true, ts-nocheck:true}`.

**5. Le test Dependabot lit le YAML comme du texte**
- **Emplacement :** `tests/stack-upgrade/dependabot.test.ts:47-55`.
- **Constat :** un `ignore:` mal indente, par exemple sous `groups:`, passerait le test alors que Dependabot le lirait autrement. Le journal indique une relecture ponctuelle avec `js-yaml`, mais elle n'est pas rejouable. Le choix de l'analyse textuelle (pas de dependance sans ADR) est justifie en tete de fichier.
- **Direction :** acceptable en l'etat. Si un parseur YAML devient resolvable (`js-yaml` est deja present en transitif), un test structurel serait plus solide. Sinon, verifier au moins l'indentation de `ignore:` par rapport a `groups:`.

**6. Les dependances transitives ajoutees par `eslint-plugin-react-hooks` 7 ne sont pas citees**
- **Emplacement :** ADR-0013, paragraphe « Dependances transitives notables ».
- **Constat :** le lockfile ajoute environ 20 paquets `@babel/*` avec `browserslist`, `caniuse-lite`, `hermes-parser`, etc., tires par `eslint-plugin-react-hooks` 7.1.1 (regles issues du React Compiler). L'ADR cite le passage de 5 a 7, mais pas cet arbre de developpement.
- **Direction :** ajouter une phrase precisant que cet arbre est uniquement de developpement et hors `audit --prod`. Un auditeur qui lit le diff du lockfile n'aurait alors plus de question.

**7. Le titre du backlog annonce ESLint 10, qui n'a pas ete livre**
- **Emplacement :** `docs/03-slices/000-backlog.md:17`.
- **Constat :** la ligne du tableau s'intitule toujours « Montee Next 16 et ESLint 10 ». Le contrat, lui, s'intitule « configuration ESLint native », et ESLint 10 est reporte (ligne 73 du backlog).
- **Direction :** aligner le libelle, ou le preciser (« ESLint 10 reporte, ADR-0013 »).

**8. AC2 et AC3 sont coches sans que la case le dise**
- **Emplacement :** `docs/03-slices/011-montee-next16.md:60-61`.
- **Constat :** les cases sont cochees alors que « CI verte » et le PASS de `contract-guardian` ne sont pas encore constates. Cette reserve est ecrite au journal (ligne « AC coches »), mais pas dans le contrat.
- **Direction :** annoter la reserve directement sur ces deux lignes du contrat, puisque c'est le document que lit l'humain.

**9. Une modification de doc n'est pas committee**
- **Emplacement :** `docs/04-runbooks/autonomous-run-2026-09-30.md`.
- **Constat :** le fichier est modifie et non committe sur la branche (`git status`). La tranche a aussi retouche la ligne 09 de `docs/00-context/JOURNAL.md` (« PR #16 fusionnee »), une mise a jour de l'orchestrateur sans lien avec 011.
- **Direction :** l'orchestrateur doit committer le runbook avant `close-slice.sh`.

## A faire figurer au registre `docs/DECISIONS.md` (par l'orchestrateur, apres relecture)
- Cible `next` / `eslint-config-next` 16.3.7 et non 16.3.8, en quarantaine pnpm (regle d'ADR-0012).
- ESLint 10 reporte avec l'erreur reproduite. C'est un ecart explicite au libelle de D-041 (« Montee Next 16 + ESLint 10 ») : le cadrage prevoyait ce repli, mais le registre doit l'acter.
- Filtrage des objets `{ ignores }` globaux d'`eslint-config-next`, avec les options ecartees.
- Versions et configuration native livrees dans un seul commit (derogation a « un commit par couche », avec sa raison).
- Contrainte d'egalite `next` = `eslint-config-next` et politique face aux PR Dependabot `eslint` 10 (voir les constats 1 et 2).
- Mise a jour du lien de D-041 : « ADR-0013 a ecrire » devient ADR-0013.

## Bilan
- **Solide :** les versions sont exactes et epinglees, la configuration ESLint native est juste (verifiee sur les exports reels et la configuration resolue), la documentation est exceptionnellement complete (guide Next 16 traite ligne par ligne, erreur ESLint 10 exacte, dates de publication), et le perimetre est strictement respecte.
- **Fragile :** plusieurs protections ne tiennent qu'a la version actuelle, sans test (filtre des ignores, options de `ban-ts-comment`, YAML lu comme du texte), et la contrainte d'egalite entre les deux paquets pese sur les futures PR de securite.
- **Manquant :** un `ignore` Dependabot, ou une decision ecrite, pour les PR `eslint` 10 qui bloqueront le groupe `majeures` ; le commit du runbook en cours ; les lignes du registre, a ecrire par l'orchestrateur.

REVIEW: PASS
