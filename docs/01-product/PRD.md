# PRD — Signet

> Banc d'essai jetable destiné à éprouver le pipeline de l'usine. Périmètre volontairement minimal, aucune ambition produit au-delà du test.

## Problème et utilisateur cible

Les petites équipes produit partagent des liens utiles (articles, concurrents, références) dans Slack, où ils sont perdus en trois jours. Aujourd'hui, elles utilisent un canal Slack dédié, un tableau Notion abandonné, ou rien du tout.

- **Payeur** : le responsable d'équipe (owner).
- **Utilisateurs** : les membres de l'équipe (member), qui lisent et ajoutent des liens.

## Périmètre du MVP

- Création d'une organisation et d'un compte owner.
- Invitation et gestion des membres par l'owner.
- Création de collections (regroupement thématique de liens).
- Ajout de liens (URL + titre) dans une collection, avec vérification du quota du palier gratuit à chaque ajout.
- Suppression d'une collection par l'owner, avec suppression en cascade de ses liens.
- Consultation des collections et de leurs liens par tous les membres de l'organisation.
- Abonnement par palier, géré par l'owner.

## Hors-périmètre (explicite)

- Pas de recherche plein texte.
- Pas d'import depuis Slack.
- Pas de tags.
- Pas de commentaires.
- Pas d'application mobile.
- Pas de multi-devise.
- Pas de SSO.
- Pas d'édition de lien ou de collection.
- Pas de suppression d'un lien pris isolément — seule la suppression d'une collection entière (avec tous ses liens, par un owner) est couverte, voir US-10.

## Unité de compte et modèle de rôles

Organisation avec membres et rôles.

- **owner** : gère les membres (invitation, retrait) et l'abonnement. Peut aussi créer des collections et ajouter des liens.
- **member** : lit et ajoute des liens dans les collections de l'organisation. Ne peut pas gérer les membres ni l'abonnement.

Une organisation a toujours au moins un owner. Un utilisateur appartient à une ou plusieurs organisations, avec un rôle par organisation.

## Modèle de revenu et événements facturés

Abonnement par palier (plans fixes), facturé à l'organisation et payé par l'owner.

Paliers :
- **Free** : jusqu'à 50 liens par organisation, tous collections confondues. Le quota est vérifié à chaque tentative d'ajout de lien ; un ajout qui ferait dépasser 50 liens est refusé explicitement (le lien n'est pas créé).
- **Pro** : liens illimités.

Événements facturables :
- Souscription initiale à un palier.
- Changement de palier (upgrade/downgrade).
- Annulation de l'abonnement.

Chaque événement est horodaté et rattaché à l'organisation concernée, pour servir de source de vérité auditable.

## User stories

**US-01 — Création d'organisation**
En tant que responsable d'équipe, je crée un compte et une organisation pour commencer à utiliser le produit.
1. À l'inscription, l'utilisateur crée une organisation et en devient automatiquement owner.
2. Une organisation a un nom, modifiable uniquement par un owner.
3. Un utilisateur authentifié appartient toujours à au moins une organisation.

**US-02 — Invitation d'un membre**
En tant qu'owner, j'invite un membre par e-mail pour qu'il rejoigne mon organisation.
1. Un owner peut envoyer une invitation à une adresse e-mail ; l'invitation est liée à l'organisation et expire après 7 jours.
2. Un member qui tente d'envoyer une invitation reçoit une erreur 403.
3. L'invité reçoit un e-mail contenant un lien d'acceptation unique.

**US-03 — Acceptation d'une invitation**
En tant qu'invité, j'accepte une invitation pour rejoindre l'organisation en tant que member.
1. Cliquer sur un lien d'invitation valide crée le compte (ou lie un compte existant) avec le rôle member sur l'organisation.
2. Un lien d'invitation expiré retourne une erreur explicite et ne crée aucune association.
3. Un lien d'invitation déjà utilisé retourne une erreur explicite et ne crée aucune association supplémentaire.

**US-04 — Retrait d'un membre**
En tant qu'owner, je retire un membre de mon organisation.
1. Un owner peut retirer un member ; celui-ci perd immédiatement l'accès aux collections et liens de l'organisation.
2. Un member qui tente de retirer un autre membre reçoit une erreur 403.
3. Le dernier owner d'une organisation ne peut ni se retirer lui-même, ni être retiré.

**US-05 — Création d'une collection**
En tant que membre (owner ou member), je crée une collection pour ranger des liens par thème.
1. Un owner ou un member peut créer une collection avec un nom, visible par tous les membres de l'organisation.
2. Une collection appartient à une seule organisation et n'est jamais visible depuis une autre organisation.
3. Deux collections d'une même organisation ne peuvent pas porter exactement le même nom.

**US-06 — Ajout d'un lien**
En tant que membre, j'ajoute un lien à une collection pour le partager avec mon équipe.
1. Un owner ou un member peut ajouter un lien (URL + titre) à une collection existante de son organisation.
2. Une URL malformée est rejetée avant enregistrement, avec un message d'erreur explicite.
3. Chaque lien enregistre son auteur et sa date d'ajout.
4. Si l'organisation est sur le palier Free et compte déjà 50 liens, une tentative d'ajout d'un 51e lien est refusée avec un message explicite, et aucun lien n'est créé.

**US-07 — Consultation des liens**
En tant que membre, je consulte les collections et leurs liens pour retrouver une ressource partagée.
1. Un utilisateur ne voit que les collections et liens des organisations dont il est owner ou member.
2. La liste des liens d'une collection est triée du plus récent au plus ancien par défaut.
3. Un utilisateur non authentifié n'a accès à aucune collection ni lien.

**US-08 — Abonnement et changement de palier**
En tant qu'owner, je choisis et change le palier d'abonnement de mon organisation.
1. Un owner peut consulter le palier actuel et le changer pour un autre palier disponible.
2. Un member qui tente de consulter ou modifier l'abonnement reçoit une erreur 403.
3. Un changement de palier réussi crée un événement facturable horodaté, rattaché à l'organisation.

**US-09 — Isolation stricte entre organisations**
En tant qu'utilisateur, je ne dois jamais pouvoir accéder aux données d'une organisation à laquelle je n'appartiens pas.
1. Toute requête sur une collection ou un lien filtre explicitement sur l'organisation de l'utilisateur authentifié.
2. Une tentative d'accès à une ressource d'une autre organisation (identifiant deviné ou forgé) retourne une erreur 404, jamais les données.

**US-10 — Suppression d'une collection**
En tant qu'owner, je supprime une collection devenue inutile, avec tous ses liens.
1. Un owner peut supprimer une collection de son organisation ; tous les liens qu'elle contient sont supprimés avec elle, dans la même opération.
2. Un member qui tente de supprimer une collection reçoit une erreur 403.
3. Une fois la collection supprimée, elle et ses liens n'apparaissent plus dans aucune consultation, pour aucun membre de l'organisation.

## Contraintes non fonctionnelles

- **Charge attendue** : négligeable — banc d'essai, quelques organisations et membres au maximum.
- **Latence** : pas d'exigence spécifique au-delà d'une réactivité normale d'application web (pas de mesure formelle attendue).
- **Disponibilité** : best-effort, aucun SLA — le produit n'a pas vocation à rester en production durablement.
- **Rétention** : aucune politique de rétention légale requise ; les données d'une organisation sont supprimées si l'organisation est supprimée.
- **Réglementation** : aucune contrainte réglementaire spécifique.
- **Hébergement** : Union européenne.

## Risques

1. **Dérive de périmètre** — le projet étant un test de pipeline, la tentation d'ajouter des fonctionnalités (recherche, tags, import Slack) pour "rendre le test plus réaliste" est réelle.
   Signal d'alerte précoce : apparition d'une tranche couvrant une fonctionnalité listée en hors-périmètre.

2. **Isolation tenant mal implémentée** — un oubli de filtre sur l'organisation dans une requête exposerait les données d'une organisation à une autre.
   Signal d'alerte précoce : une route ou une requête d'accès aux collections/liens sans filtre explicite sur l'organisation, détectée en revue ou par l'auditeur de sécurité.

3. **Vérification de quota non atomique** — le quota de 50 liens du palier Free doit être vérifié à l'ajout ; une vérification non atomique (lecture du compte puis écriture séparée) permettrait de dépasser le quota lors d'ajouts concurrents.
   Signal d'alerte précoce : le contrôle du quota est implémenté comme une lecture suivie d'une écriture non contrainte au niveau base de données, plutôt que comme une contrainte vérifiée de façon atomique.

## Hypothèses prises

- Le nom "Signet" est un nom de travail provisoire, sans enjeu de marque puisque le produit est jetable.
- Le MVP ne couvre pas l'édition de lien ou de collection, ni la suppression d'un lien pris isolément — seule la suppression d'une collection entière (avec ses liens, par un owner) est couverte, car la consigne initiale ne mentionnait que la lecture et l'ajout de liens par les members.
- La périodicité de facturation (mensuelle vs annuelle) n'a pas été précisée ; supposée mensuelle récurrente par défaut, à confirmer en phase de conception du module billing.
