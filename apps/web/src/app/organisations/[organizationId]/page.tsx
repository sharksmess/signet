/**
 * Page d'une organisation (tranche 012, AC4 a AC7) : privee, membre.
 *
 * Ordre : session (sinon `307` vers `/connexion`) -> identifiant du chemin par
 * le schema du contrat, puis minuscules (malforme : page introuvable, L-7) ->
 * `listMembers` (non-membre ou inexistante : page introuvable, identique) ->
 * nom (`listMyOrganizations`) -> `listCollections` -> owner SEUL :
 * `getSubscription`. Le role est celui de la ligne de l'appelant dans
 * `listMembers`, jamais un parametre de l'adresse (chaine de requete ignoree).
 *
 * Un member ne recoit ni le bloc « Palier », ni le formulaire d'invitation,
 * ni leurs donnees : ils ne sont pas rendus et `getSubscription` n'est pas
 * appele. Textes libres passes par `visibleText` avant le rendu.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSubscription } from "@/lib/billing/subscriptions";
import { listCollections } from "@/lib/collections/collections";
import { listMembers as listMembersContract } from "@/lib/members/contracts";
import { listMembers } from "@/lib/members/members";
import { listMyOrganizations } from "@/lib/organizations";
import { formatUtc } from "@/ui/format";
import { CreateCollectionForm } from "@/ui/forms/create-collection-form";
import { InviteForm } from "@/ui/forms/invite-form";
import { SignOutButton } from "@/ui/forms/sign-out-button";
import { requirePageSession } from "@/ui/session";
import { visibleText } from "@/ui/visible-text";

interface SubscriptionSummary {
  tier: "Free" | "Pro";
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

export default async function OrganizationPage(props: { params: Promise<{ organizationId: string }> }) {
  const session = await requirePageSession();

  const parsed = listMembersContract.input.safeParse(await props.params);
  if (!parsed.success) notFound();
  const organizationId = parsed.data.organizationId.toLowerCase();

  const members = await listMembers({ userId: session.userId, organizationId });
  if (!members.ok) notFound();
  const caller = members.value.find((member) => member.userId === session.userId);
  if (caller === undefined) notFound();
  const isOwner = caller.role === "owner";

  const organizations = await listMyOrganizations(session.userId);
  if (!organizations.ok) throw new Error("lecture des organisations : refus inattendu");
  const organization = organizations.value.find((item) => item.id === organizationId);
  if (organization === undefined) notFound();

  const collections = await listCollections({ userId: session.userId, organizationId });
  if (!collections.ok) notFound();

  let subscription: SubscriptionSummary | null = null;
  if (isOwner) {
    const read = await getSubscription({ userId: session.userId, organizationId });
    if (!read.ok) throw new Error("lecture du palier : refus inattendu pour un owner");
    subscription = {
      tier: read.value.tier === "pro" ? "Pro" : "Free",
      status: read.value.status,
      cancelAtPeriodEnd: read.value.cancelAtPeriodEnd,
      currentPeriodEnd: read.value.currentPeriodEnd === null ? null : formatUtc(read.value.currentPeriodEnd),
    };
  }

  return (
    <>
      <p>
        <Link href="/organisations">Mes organisations</Link>
      </p>
      <h1>{visibleText(organization.name)}</h1>

      <h2>Collections</h2>
      {collections.value.length === 0 ? (
        <p data-testid="empty-collections">Aucune collection.</p>
      ) : (
        <ul>
          {collections.value.map((collection) => (
            <li key={collection.id} data-testid="collection-row">
              <Link href={`/organisations/${organizationId}/collections/${collection.id}`}>{visibleText(collection.name)}</Link>
            </li>
          ))}
        </ul>
      )}
      <CreateCollectionForm organizationId={organizationId} />

      <h2>Membres</h2>
      <ul>
        {members.value.map((member) => (
          <li key={member.userId} data-testid="member-row">
            {visibleText(member.email)} — {member.role}
          </li>
        ))}
      </ul>

      {subscription !== null ? (
        <section data-testid="subscription-block">
          <h2>Palier</h2>
          <p>{subscription.tier}</p>
          <p>Statut : {subscription.status}</p>
          <p>Annulation programmee : {subscription.cancelAtPeriodEnd ? "oui" : "non"}</p>
          {subscription.tier === "Pro" && subscription.currentPeriodEnd !== null ? <p>Fin de periode : {subscription.currentPeriodEnd}</p> : null}
        </section>
      ) : null}
      {isOwner ? <InviteForm organizationId={organizationId} /> : null}

      <SignOutButton after="connexion" />
    </>
  );
}
