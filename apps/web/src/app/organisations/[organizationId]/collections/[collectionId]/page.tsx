/**
 * Page d'une collection (tranche 012, AC7 a AC10) : privee, membre.
 *
 * Ordre : session (sinon `307` vers `/connexion`) -> identifiants du chemin par
 * le schema du contrat `listLinks`, puis minuscules (malforme : page
 * introuvable) -> `listLinks` (`ORGANIZATION_NOT_FOUND` ou
 * `COLLECTION_NOT_FOUND` : meme page introuvable ; le chemin fait autorite) ->
 * `listMembers` (adresse des auteurs ; « ancien membre » sinon, L-4) -> nom de
 * l'organisation (`listMyOrganizations`) et de la collection
 * (`listCollections`). Ordre des liens : celui de `listLinks`.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { listCollections } from "@/lib/collections/collections";
import { listLinks as listLinksContract } from "@/lib/links/contracts";
import { listLinks } from "@/lib/links/links";
import { listMembers } from "@/lib/members/members";
import { listMyOrganizations } from "@/lib/organizations";
import { AddLinkForm } from "@/ui/forms/add-link-form";
import { SignOutButton } from "@/ui/forms/sign-out-button";
import { LinkRow } from "@/ui/link-row";
import { requirePageSession } from "@/ui/session";
import { visibleText } from "@/ui/visible-text";

export default async function CollectionPage(props: { params: Promise<{ organizationId: string; collectionId: string }> }) {
  const session = await requirePageSession();

  const parsed = listLinksContract.input.safeParse(await props.params);
  if (!parsed.success) notFound();
  const organizationId = parsed.data.organizationId.toLowerCase();
  const collectionId = parsed.data.collectionId.toLowerCase();

  const links = await listLinks({ userId: session.userId, organizationId, collectionId });
  if (!links.ok) notFound();

  const members = await listMembers({ userId: session.userId, organizationId });
  if (!members.ok) notFound();
  const emails = new Map(members.value.map((member) => [member.userId, member.email]));

  const organizations = await listMyOrganizations(session.userId);
  if (!organizations.ok) throw new Error("lecture des organisations : refus inattendu");
  const organization = organizations.value.find((item) => item.id === organizationId);
  if (organization === undefined) notFound();

  const collections = await listCollections({ userId: session.userId, organizationId });
  if (!collections.ok) notFound();
  const collection = collections.value.find((item) => item.id === collectionId);
  if (collection === undefined) notFound();

  return (
    <>
      <p>
        <Link href="/organisations">Mes organisations</Link> / <Link href={`/organisations/${organizationId}`}>{visibleText(organization.name)}</Link>
      </p>
      <h1>{visibleText(collection.name)}</h1>

      <h2>Liens</h2>
      {links.value.length === 0 ? (
        <p data-testid="empty-links">Aucun lien dans cette collection.</p>
      ) : (
        <ul>
          {links.value.map((link) => (
            <LinkRow key={link.id} url={link.url} title={link.title} authorEmail={emails.get(link.addedBy) ?? null} createdAt={link.createdAt} />
          ))}
        </ul>
      )}
      <AddLinkForm organizationId={organizationId} collectionId={collectionId} />

      <SignOutButton after="connexion" />
    </>
  );
}
