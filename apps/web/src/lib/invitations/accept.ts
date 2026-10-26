/**
 * Acceptation d'une invitation (US-03 ; tranche 006, D-102, ADR-0018).
 *
 * Ordre (contrat de la tranche, « Ordre dans la route ») : la route a deja
 * verifie la session et valide le corps ; ici :
 *
 * 1. decodage strict du jeton et empreinte `sha256` des 32 octets (D-090) ;
 *    jeton malforme -> 404, aucune requete en base (AC3) ;
 * 2. une transaction sous `signet_app` (`withUserOnly`, utilisateur de
 *    session seul : aucune organisation venue de la requete) ;
 * 3. `signet.accept_invitation(empreinte)` sous point de sauvegarde (patron
 *    D-092) : `SG008` (deja membre) ou `SG002` / `23503` (compte disparu)
 *    annulent l'appel sans annuler la transaction, qui valide alors sans rien
 *    avoir ecrit ;
 * 4. zero ligne : `signet.lookup_invitation(empreinte)`, APRES l'echec de la
 *    consommation, pour distinguer 404 / 410 / 409 / 403.
 *
 * Le refus d'adresse est porte par la base (P-3) : la fonction ne consomme
 * rien sous un compte d'une autre adresse. L'adresse de session ne sert ici
 * qu'a choisir le message quand la base a refuse une invitation en attente
 * (D-108).
 *
 * Le jeton n'existe en clair que dans l'appel de `linkTokenToHash` : il n'est
 * jamais journalise, jamais renvoye, jamais passe a Postgres (seule
 * l'empreinte l'est). Les erreurs inattendues de la base sont journalisees par
 * leur code seulement et relevees sans detail (500 generique).
 */
import { withUserOnly } from "../db";
import {
  alreadyMemberOnAcceptance,
  fail,
  invitationAlreadyUsed,
  invitationEmailMismatch,
  invitationExpired,
  invitationNotFound,
  ok,
  unauthenticated,
  type Result,
} from "../errors";
import { linkTokenToHash } from "./token";

const SAVEPOINT = "invitation_acceptance";

/** Codes SQL attendus de `accept_invitation` (ERD §0) et leur sens. */
const IDENTITY_LOST = new Set(["SG002", "23503"]);
const ALREADY_MEMBER = "SG008";

export interface AcceptedInvitation {
  organizationId: string;
  role: "member";
}

type InvitationState = "pending" | "expired" | "accepted";

function isInvitationState(value: string): value is InvitationState {
  return value === "pending" || value === "expired" || value === "accepted";
}

function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code: unknown = error.code;
  return typeof code === "string" ? code : undefined;
}

/** Journalise le seul code de l'erreur, puis releve une erreur sans detail. */
function unexpected(step: string, error: unknown): Error {
  console.error(`[invitations] acceptation : erreur inattendue de la base a l'etape ${step} (code ${sqlStateOf(error) ?? "absent"})`);
  return new Error(`acceptation d'invitation : erreur inattendue (${step})`);
}

export async function acceptInvitation(params: {
  userId: string;
  /** Adresse du compte de session (better-auth), pour le choix du message seulement. */
  sessionEmail: string;
  /** Champ `token` du corps, deja valide par le contrat (texte, 256 caracteres au plus). */
  token: string;
}): Promise<Result<AcceptedInvitation>> {
  const tokenHash = linkTokenToHash(params.token);
  if (!tokenHash) return fail(invitationNotFound());

  return withUserOnly(params.userId, async (client) => {
    await client.query(`SAVEPOINT ${SAVEPOINT}`);
    let accepted: string | undefined;
    try {
      const result = await client.query<{ organization_id: string }>(
        "SELECT organization_id FROM signet.accept_invitation($1::bytea)",
        [tokenHash],
      );
      accepted = result.rows[0]?.organization_id;
    } catch (error) {
      const code = sqlStateOf(error);
      if (code === ALREADY_MEMBER) {
        await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
        return fail(alreadyMemberOnAcceptance());
      }
      if (code !== undefined && IDENTITY_LOST.has(code)) {
        await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
        return fail(unauthenticated());
      }
      throw unexpected("accept_invitation", error);
    }
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);

    if (accepted) return ok({ organizationId: accepted, role: "member" });

    let lookup: { email: string; state: string } | undefined;
    try {
      const result = await client.query<{ email: string; state: string }>(
        "SELECT email, state FROM signet.lookup_invitation($1::bytea)",
        [tokenHash],
      );
      lookup = result.rows[0];
    } catch (error) {
      // L'identite de session vient d'etre verifiee par accept_invitation dans
      // la meme transaction : tout echec ici est inattendu.
      throw unexpected("lookup_invitation", error);
    }

    if (!lookup) return fail(invitationNotFound());
    if (!isInvitationState(lookup.state)) {
      throw new Error("lookup_invitation a retourne un etat inconnu");
    }
    switch (lookup.state) {
      case "expired":
        return fail(invitationExpired());
      case "accepted":
        return fail(invitationAlreadyUsed());
      case "pending":
        // En attente, valide, et pourtant non consommee : l'adresse du compte
        // ne correspond pas (cas attendu), ou bien elle correspond et c'est le
        // compte qui a disparu ou change entre la session et l'appel (D-108).
        return lookup.email === params.sessionEmail.toLowerCase()
          ? fail(unauthenticated())
          : fail(invitationEmailMismatch());
    }
  });
}
