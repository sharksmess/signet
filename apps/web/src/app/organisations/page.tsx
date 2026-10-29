/**
 * Mes organisations (tranche 012, AC2 e, AC3) : privee. Liste de
 * `listMyOrganizations` de l'utilisateur de session, dans son ordre ;
 * formulaire de creation ; deconnexion.
 *
 * `?creation=echec` (L-10) : affiche un message fixe si et seulement si la
 * valeur vaut exactement `echec` ; la valeur n'est jamais reprise. Tout autre
 * parametre est ignore (`userId` vient de la session).
 */
import Link from "next/link";
import { z } from "zod";
import { listMyOrganizations } from "@/lib/organizations";
import { CreateOrganizationForm } from "@/ui/forms/create-organization-form";
import { SignOutButton } from "@/ui/forms/sign-out-button";
import { MESSAGES } from "@/ui/messages";
import { requirePageSession } from "@/ui/session";
import { visibleText } from "@/ui/visible-text";

const CreationFailed = z.object({ creation: z.literal("echec") });

export default async function OrganizationsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePageSession();
  const creationFailed = CreationFailed.safeParse(await props.searchParams).success;

  const organizations = await listMyOrganizations(session.userId);
  if (!organizations.ok) throw new Error("lecture des organisations : refus inattendu");
  const items = organizations.value.map((organization) => ({ id: organization.id, name: visibleText(organization.name) }));

  return (
    <>
      <h1>Mes organisations</h1>
      {creationFailed ? <p role="alert">{MESSAGES.creationFailed}</p> : null}
      {items.length === 0 ? (
        <p data-testid="empty-organizations">Vous n&apos;etes membre d&apos;aucune organisation.</p>
      ) : (
        <ul>
          {items.map((organization) => (
            <li key={organization.id} data-testid="organization-row">
              <Link href={`/organisations/${organization.id}`}>{organization.name}</Link>
            </li>
          ))}
        </ul>
      )}
      <CreateOrganizationForm />
      <SignOutButton after="connexion" />
    </>
  );
}
