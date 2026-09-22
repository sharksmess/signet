# ADR-0002 — Verification atomique du quota Free

- **Statut** : accepte
- **Date** : 2026-09-22
- **Phase** : 2 — architecture

## Contexte

Le PRD (`docs/01-product/PRD.md`) definit le palier Free comme « jusqu'a 50 liens par organisation,
tous collections confondues », et US-06.4 exige qu'une tentative d'ajout d'un 51e lien soit refusee
« avec un message explicite, et aucun lien n'est cree ».

Le PRD nomme lui-meme la facon de rater cette exigence, en risque #3 : « une verification non
atomique (lecture du compte puis ecriture separee) permettrait de depasser le quota lors d'ajouts
concurrents ». Le signal d'alerte precoce associe est explicite : « le controle du quota est
implemente comme une lecture suivie d'une ecriture non contrainte au niveau base de donnees ».

Le probleme concret : deux membres ajoutent un lien au meme instant alors que l'organisation en
compte 49. En `READ COMMITTED`, chaque transaction compte 49 (aucune ne voit la ligne non validee
de l'autre), chacune conclut que l'ajout est permis, et l'organisation se retrouve a 51 liens.
Ce n'est pas un cas theorique : deux onglets, un double-clic, ou un retry HTTP suffisent.

Il faut choisir le mecanisme avant de modeliser la table `link`, parce que l'option retenue
determine s'il existe ou non une table supplementaire dans le schema.

## Options envisagees

### Option A — Verification applicative : `SELECT count(*)` puis `INSERT`

Le chemin evident. Ecarte sans ambiguite : c'est litteralement l'anti-pattern que le PRD nomme
en risque #3. Le `count(*)` ne verrouille rien, et rien n'empeche l'autre transaction d'inserer
entre la lecture et l'ecriture. Le fait que la charge attendue soit « negligeable » ne sauve pas :
un double-clic n'a pas besoin de charge.

### Option B — Trigger `BEFORE INSERT` sur `link` faisant `SELECT count(*)`

Deplace la verification en base, ce qui la rend inevitable pour tout appelant. Mais le defaut de
fond demeure : `count(*)` ne prend aucun verrou, les deux transactions comptent 49 et passent
toutes les deux. Mieux que A sur la discipline, identique a A sur la correction. **Ecarte** :
un mecanisme qui a l'air atomique sans l'etre est pire qu'un mecanisme manifestement fragile,
parce qu'il eteint la vigilance.

### Option C — Verrou explicite sur la ligne organisation puis comptage

`SELECT ... FROM organization WHERE id = ? FOR UPDATE` avant le `count(*)` et l'`INSERT`.
Correct : le verrou serialise les ajouts d'une meme organisation. Deux objections :

1. La correction depend de la discipline de l'appelant. Tout nouveau chemin d'ecriture (un job
   Inngest, un futur import, un script de reprise) qui oublie le `FOR UPDATE` reouvre le trou,
   silencieusement. C'est exactement le mode de defaillance que `CLAUDE.md` refuse : « pas
   d'exception interne, pas d'exception c'est un job ».
2. Le `count(*)` reste un scan des liens de l'organisation a chaque ajout — sans consequence a
   50 lignes, mais le motif ne se generalise pas.

Ecartee au profit de D, qui obtient la meme serialisation sans dependre de l'appelant.

### Option D — Compteur materialise par organisation + contrainte `CHECK` + triggers

Une table `organization_link_usage (organization_id PK, link_count, link_quota)` portant :

```sql
CHECK (link_quota IS NULL OR link_count <= link_quota)
```

Un trigger `AFTER INSERT`/`AFTER DELETE` sur `link` incremente ou decremente `link_count`.
L'`UPDATE` du compteur prend un verrou de ligne : la seconde transaction attend, puis re-evalue
la ligne validee (`READ COMMITTED`), passe de 50 a 51, et viole le `CHECK`. Aucune lecture
prealable, donc aucune fenetre entre verification et ecriture.

Cout : une table de plus, un compteur qui peut theoriquement deriver, et la serialisation des
ajouts concurrents d'une meme organisation.

### Option E — Contrainte d'exclusion ou index unique sur un rang de lien

Attribuer a chaque lien un numero d'ordre par organisation (`link_number`) avec
`UNIQUE (organization_id, link_number)` et `CHECK (link_number <= 50)`. L'unicite rend le calcul
du numero atomique par echec d'insertion. Ecartee : le numero doit quand meme etre calcule
(`max + 1`, meme course), la suppression d'une collection cree des trous qui rendent le rang
non reutilisable sans renumerotation, et le plafond devient une constante figee dans une
contrainte de colonne — donc une migration a chaque evolution tarifaire.

## Decision

**Option D** : compteur materialise par organisation, plafond sur la meme ligne, contrainte
`CHECK`, triggers de maintien.

Le critere qui tranche est la resistance a l'appelant, pas la performance. Les options C et D
sont toutes deux correctes en concurrence ; seule D reste correcte quand quelqu'un ecrit dans
`link` sans connaitre la regle. Le quota cesse d'etre une politique que le code doit se rappeler
d'appliquer, pour devenir une propriete que la base refuse de violer.

Deux details rendent la decision solide :

- **Compteur et plafond sur la meme ligne.** Un `CHECK` ne peut porter que sur une seule ligne.
  C'est ce qui interdit de repartir `link_count` sur `organization` et `link_quota` sur
  `subscription` : le quota ne serait plus une contrainte, seulement une convention.
- **Le compteur n'est pas ecrivable par l'application.** `REVOKE INSERT, UPDATE, DELETE ... FROM
  signet_app`, et triggers en `SECURITY DEFINER`. Le compteur ne bouge que par creation ou
  suppression reelle d'un lien. Sans ce verrouillage, la contrainte serait contournable par un
  `UPDATE organization_link_usage SET link_count = 0`, et quelqu'un finirait par l'ecrire pour
  reparer une incoherence en production.

Le plafond lui-meme est derive du palier par `signet.quota_for_tier(tier)` (`free → 50`,
`pro → NULL`), propagee par un trigger sur `subscription`. La valeur 50 n'existe qu'a un seul
endroit du systeme.

**Mise a jour du 2026-09-22 — application procedurale, pas declarative.** Le quota s'applique au
flux (une tentative d'ajout), jamais comme contrainte statique sur le stock : une retrogradation
Pro → Free d'une organisation comptant plus de 50 liens doit reussir, liens existants conserves.
La contrainte `CHECK (link_quota IS NULL OR link_count <= link_quota)` envisagee initialement est
donc abandonnee — elle bloquerait aussi bien l'ajout que la simple ecriture d'un `link_quota`
abaisse, ce qui casserait le downgrade. La verification est deplacee dans la branche `INSERT` du
trigger sur `link`, apres l'`UPDATE` du compteur : `IF link_quota IS NOT NULL AND link_count >
link_quota THEN RAISE EXCEPTION ... USING ERRCODE = 'SG001'`. La propriete d'atomicite ne change
pas : c'est le meme verrou de ligne, pris au meme instant par le meme `UPDATE`, qui serialise les
transactions concurrentes (voir ERD §7, tableau du scenario) ; seul le mecanisme de signalement du
refus change, precisement pour ne plus s'appliquer a la propagation du plafond.

## Consequences acceptees

- **Les ajouts de liens d'une meme organisation sont serialises** par le verrou sur la ligne de
  compteur. Sans consequence ici (charge « negligeable » selon le PRD). Pour une application a
  fort debit, ce point chaud imposerait une autre approche.
- **La violation de quota remonte comme une erreur Postgres**, pas comme une valeur de retour.
  La couche d'acces doit intercepter le code applicatif personnalise `SG001`, leve explicitement
  par le trigger `INSERT` (voir mise a jour ci-dessus), et le traduire en erreur metier typee
  (`QuotaExceeded`), conformement a `CLAUDE.md` (« les erreurs metier attendues sont des valeurs
  de retour typees »). Sous un niveau d'isolation plus strict que `READ COMMITTED`, c'est un
  `40001` (echec de serialisation) qui remonte a la place : les deux codes doivent etre traites,
  jamais laisses devenir un 500. Un test d'integration doit couvrir les deux.
- **Le compteur est une donnee derivee**, donc susceptible de deriver. Mitigations : il n'est
  modifiable que par trigger, une procedure `signet.recompute_link_usage(org_id)` permet de le
  recalculer, et un test d'integration verifie `link_count = count(*)` apres chaque scenario.
  Le recalcul est une commande versionnee, pas un `UPDATE` improvise.
- **Une retrogradation Pro → Free d'une organisation comptant plus de 50 liens reussit toujours**
  (decision produit du 2026-09-22) : la propagation du nouveau plafond n'est plus contrainte par
  un `CHECK`, elle s'ecrit sans condition. Les liens existants restent lisibles ; le quota ne
  redevient bloquant qu'a la prochaine tentative d'ajout. Ce n'est plus une question ouverte.
- **L'ordre des cascades de suppression n'est pas garanti.** La branche `DELETE` du trigger reste
  tolerante a l'absence de ligne de compteur et **inconditionnelle** (elle ne verifie jamais le
  quota) ; la branche `INSERT` leve au contraire si le compteur manque, parce qu'une organisation
  sans compteur est un quota desactive.
- **Une table de plus dans le schema.** Contrepartie : elle porte aussi l'affichage « 32 / 50 »
  pour tous les membres, sans leur ouvrir l'acces a `subscription`, reservee aux owners (US-08.2).

### Politique de durcissement pour toute fonction `SECURITY DEFINER` (demandee le 2026-09-22)

Cette ADR introduit les premieres fonctions `SECURITY DEFINER` internes du schema (les deux
branches du trigger sur `link`, la propagation de plafond sur `subscription`). La regle qui suit
s'applique a **toutes** les fonctions `SECURITY DEFINER` du schema, y compris les quatre points
d'entree pre-tenant de l'ERD §1 — c'est ici qu'elle est formalisee parce que c'est ce mecanisme de
quota qui en a impose la necessite : un privilege eleve qui ne serait pas borne de cette maniere
transformerait le compteur infalsifiable en un nouveau chemin de contournement de l'isolation
tenant (US-09, risque #2 du PRD), exactement ce qu'ADR-0001 cherche a rendre impossible.

1. **`search_path` fixe explicitement**, sur chaque fonction, sans exception :
   `SET search_path = pg_catalog, signet, public`. Jamais le `search_path` de session, jamais un
   schema ecrivible par un role non privilegie en tete — c'est le vecteur classique de detournement
   d'une fonction `SECURITY DEFINER`.
2. **Role dedie `signet_definer`, `NOLOGIN`.** Chaque fonction `SECURITY DEFINER` appartient a ce
   role, distinct de `signet_app` et `signet_auth`, et ne detient que les `GRANT` strictement
   necessaires a son execution (jamais un `GRANT` large en `public`, jamais la propriete du role
   de migration). `NOLOGIN` interdit toute connexion directe sous ce role : il n'est atteignable
   qu'a travers l'execution d'une fonction qu'il possede, jamais par une session ouverte a son nom.
3. **Lecture et ecriture bornees a l'organisation concernee par l'operation.** Le corps de chaque
   fonction filtre explicitement sur l'`organization_id` de l'operation en cours (`NEW.organization_id`,
   `OLD.organization_id`, ou l'identifiant passe en parametre) — jamais un `SELECT`/`UPDATE` sans
   ce predicat. Seule exception documentee : `signet.organizations_for_user()`, dont le perimetre
   legitime est l'utilisateur appelant (`user_id = signet.current_user_id()`) plutot qu'une
   organisation unique — elle reste bornee, mais sur un autre axe, explicite et unique.

**Critere de test correspondant** (a couvrir par un test d'integration pour chaque fonction
`SECURITY DEFINER` du schema, avant la cloture de toute tranche qui en ajoute ou en modifie une) :
- Requete sur `pg_proc.proconfig` : la fonction porte bien une entree `search_path=...` explicite,
  non vide.
- Requete sur `pg_proc.proowner` / `pg_roles` : le proprietaire est `signet_definer`, et
  `signet_definer.rolcanlogin = false`.
- **Test d'isolation croisee** : deux organisations de fixture A et B. Un appel de la fonction avec
  un identifiant (organization_id, token, user_id selon la fonction) appartenant a A, dans un
  contexte de session lie a B (ou sans contexte tenant), ne doit lire ni modifier aucune ligne
  appartenant a B, et ne doit jamais retourner de donnee de B. Ce test echoue bruyamment si une
  future modification de la fonction retire ou affaiblit son predicat d'organisation.

## Signal de reexamen

- Le point chaud du compteur devient mesurable : plusieurs organisations depassant quelques ajouts
  de liens par seconde, ou des attentes de verrou visibles en `pg_stat_activity`.
- L'apparition d'un quota qui n'est plus un simple compte de lignes (quota glissant sur 30 jours,
  quota par membre, quota multi-ressources) : le `CHECK` sur un compteur ne l'exprimerait plus et
  il faudrait reprendre le mecanisme de zero.
- Un besoin d'ecriture en masse (import) rendant la serialisation par organisation genante.

Aucun des trois n'est attendu au vu des contraintes non fonctionnelles du PRD.
