/**
 * Fixtures partagees. La fixture a deux organisations distinctes est le socle
 * du test d'isolation tenant (AC5) : elle est definie ici une seule fois pour
 * que toute tranche future qui touche `organization`/`member`/
 * `organization_link_usage`/`subscription` puisse la reutiliser telle quelle.
 */
import { signUp, type AuthenticatedSession } from "./auth";
import { createOrganization } from "./organizationsApi";
import { asBypassRls } from "./db";

export interface OrganizationFixture {
  organizationId: string;
  name: string;
  owner: AuthenticatedSession;
}

/** Cree une organisation reelle via le contrat HTTP (dogfooding : AC1 sert de fixture aux autres AC). */
export async function createOrganizationFixture(name: string): Promise<OrganizationFixture> {
  const owner = await signUp();
  const { status, body } = await createOrganization(owner, { name });
  if (status !== 200 && status !== 201) {
    // Echec immediat et explicite : ne JAMAIS laisser un appelant continuer
    // avec un organizationId absent — c'est ce qui transformerait un 422 ici
    // en violation de contrainte (member_organization_id_organization_id_fk)
    // bien plus loin, sur un appel qui ne dirait rien de la cause reelle.
    throw new Error(
      `createOrganizationFixture("${name}") : le serveur a refuse la creation ` +
        `(HTTP ${status}), aucune organisation n'a ete construite. Corps de la reponse : ` +
        `${JSON.stringify(body)}`,
    );
  }
  const organizationId = (body as { id?: string }).id;
  if (!organizationId) {
    throw new Error(
      `createOrganizationFixture("${name}") : reponse HTTP ${status} sans champ "id". ` +
        `Corps de la reponse : ${JSON.stringify(body)}`,
    );
  }
  return { organizationId, name, owner };
}

export interface TwoOrganizationsFixture {
  orgA: OrganizationFixture;
  orgB: OrganizationFixture;
}

/**
 * Deux organisations totalement distinctes, chacune avec son propre owner,
 * aucun utilisateur ni aucune ligne partagee entre les deux. C'est la fixture
 * minimale exigee par AC5 : sans elle, un test "d'isolation" a une seule
 * organisation ne prouverait rien (regle du projet : "deux tenants reels,
 * jamais un seul compte").
 */
export async function createTwoOrganizationsFixture(): Promise<TwoOrganizationsFixture> {
  const [orgA, orgB] = await Promise.all([
    createOrganizationFixture("Organisation A"),
    createOrganizationFixture("Organisation B"),
  ]);
  return { orgA, orgB };
}

/**
 * Ajoute un membre non-owner a une organisation en ecrivant directement en
 * base avec un role `BYPASSRLS` (cf. tests/helpers/db.ts).
 *
 * Pourquoi ce contournement est necessaire ici et nulle part ailleurs : cette
 * tranche (001) n'expose aucune route qui cree un membre `role='member'`
 * (les invitations sont la tranche 003). AC2 exige pourtant de verifier
 * qu'un membre non-owner ne peut pas renommer l'organisation. Sans cette
 * fixture d'arrangement, AC2 serait intestable avant la tranche 003 — ce
 * qui retarderait sa couverture de deux tranches sans raison valable.
 * Cette fonction ne doit JAMAIS servir a verifier un comportement sous test :
 * seulement a construire l'etat de depart.
 */
export async function addMemberDirect(params: {
  organizationId: string;
  userId: string;
  role: "owner" | "member";
}): Promise<void> {
  // Garde-fou explicite : sans elle, un organizationId/userId invalide
  // (fixture en amont qui a echoue silencieusement) ne se manifeste qu'au
  // niveau de la contrainte member_organization_id_organization_id_fk, un
  // message qui ne dit rien de la cause reelle.
  if (!params.organizationId || !params.userId) {
    throw new Error(
      `addMemberDirect appele avec un identifiant manquant (organizationId=${JSON.stringify(params.organizationId)}, ` +
        `userId=${JSON.stringify(params.userId)}) — la fixture qui a produit cette valeur a echoue avant cet appel.`,
    );
  }
  await asBypassRls(async (client) => {
    await client.query(
      "INSERT INTO member (organization_id, user_id, role) VALUES ($1, $2, $3)",
      [params.organizationId, params.userId, params.role],
    );
  });
}

/** Lit le nom courant d'une organisation directement en base (verification "boite blanche", role BYPASSRLS). */
export async function readOrganizationNameDirect(organizationId: string): Promise<string | null> {
  return asBypassRls(async (client) => {
    const result = await client.query<{ name: string }>(
      "SELECT name FROM organization WHERE id = $1",
      [organizationId],
    );
    return result.rows[0]?.name ?? null;
  });
}

/**
 * Organisations dont `userId` est membre (verification "boite blanche", role
 * BYPASSRLS). La creation pose l'owner dans la meme transaction (AC1) : une
 * organisation creee par une requete de cet utilisateur apparait ici. Ne
 * compte jamais la table entiere, qui depend des autres tests.
 */
export async function countOrganizationsOfUserDirect(userId: string): Promise<number> {
  return asBypassRls(async (client) => {
    const result = await client.query<{ count: string }>(
      "SELECT count(*)::text FROM member WHERE user_id = $1",
      [userId],
    );
    return Number(result.rows[0]?.count ?? "0");
  });
}

/** Organisations portant exactement `name` (verification "boite blanche", role BYPASSRLS). */
export async function countOrganizationsNamedDirect(name: string): Promise<number> {
  return asBypassRls(async (client) => {
    const result = await client.query<{ count: string }>(
      "SELECT count(*)::text FROM organization WHERE name = $1",
      [name],
    );
    return Number(result.rows[0]?.count ?? "0");
  });
}
