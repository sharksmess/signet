/**
 * Emission d'une invitation (US-02.1, US-02.2 ; tranche 003, ADR-0017).
 *
 * Arguments supposes deja valides par le contrat (`lib/invitations/contracts.ts`)
 * et l'e-mail normalise (minuscules). Tout se passe dans UNE transaction sous
 * `signet_app`, contexte de l'appelant pose par `withTenant` (RLS en seconde
 * barriere, ADR-0011), dans cet ordre (notes d'implementation de la tranche) :
 *
 * 1. appartenance et role, filtre explicite sur `organization_id` : non-membre
 *    ou organisation inexistante -> 404 identique ; member -> 403 ;
 * 2. adresse deja membre (owner compris) -> 409 ALREADY_MEMBER (D-086 Q-2) ;
 * 3. secret de 32 octets, empreinte (D-090) ;
 * 4. `signet.create_invitation` (purge de la ligne expiree, INSERT) ; une
 *    invitation encore valide -> 23505 -> 409 INVITATION_ALREADY_PENDING ;
 * 5. scellement du secret avec l'identifiant retourne ;
 * 6. mise en file AVANT le COMMIT (D-086 Q-3) : refus ou silence de la file ->
 *    annulation de l'emission et 503 SERVICE_UNAVAILABLE, rien n'est cree.
 *
 * Les etapes 4 a 6 sont encadrees par un point de sauvegarde : un refus attendu
 * (23505, file indisponible) annule l'emission sans lever, puis `withTenant`
 * valide une transaction qui n'a rien ecrit. Cas residuel (file qui accepte
 * l'evenement puis COMMIT en echec, ou file qui l'accepte apres le delai) :
 * e-mail au lien inerte, sans danger (ADR-0017).
 *
 * Le secret n'existe en clair que dans cette fonction ; il n'est ni journalise,
 * ni renvoye, ni ecrit en base.
 */
import { withTenant } from "../db";
import { invitationTokenKey } from "../env";
import {
  alreadyMember,
  fail,
  insufficientRole,
  invitationAlreadyPending,
  ok,
  organizationNotFound,
  serviceUnavailable,
  type Result,
} from "../errors";
import { INVITATION_CREATED_EVENT, sendEventWithDeadline, type InvitationCreatedEventData } from "../inngest/client";
import { newInvitationSecret, sealSecret } from "./token";

/** Au-dela, la route abandonne et repond 503 (« en quelques secondes », D-065 regle 3). */
const QUEUE_DEADLINE_MS = 5_000;
const SAVEPOINT = "invitation_emission";

export interface InvitationView {
  id: string;
  organizationId: string;
  email: string;
  expiresAt: string;
}

interface PgError {
  code?: unknown;
  constraint?: unknown;
}

function isPendingDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const pg: PgError = error;
  return pg.code === "23505" && pg.constraint === "invitation_pending_idx";
}

export async function createInvitation(params: {
  userId: string;
  organizationId: string;
  /** Forme normalisee (minuscules, sans espaces de bord). */
  email: string;
}): Promise<Result<InvitationView>> {
  // Lue avant toute ecriture : une cle absente ou mal formee (invariant de
  // deploiement) fait echouer l'appel sans rien creer.
  const key = invitationTokenKey();
  const { userId, organizationId, email } = params;

  return withTenant({ userId, organizationId }, async (client) => {
    const membership = await client.query<{ role: string; name: string }>(
      `SELECT m.role, o.name
         FROM member m JOIN organization o ON o.id = m.organization_id
        WHERE m.organization_id = $1 AND m.user_id = $2`,
      [organizationId, userId],
    );
    const caller = membership.rows[0];
    if (!caller) return fail(organizationNotFound());
    if (caller.role !== "owner") return fail(insufficientRole());

    const existingMember = await client.query(
      `SELECT 1
         FROM member m JOIN app_user u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND lower(u.email) = $2
        LIMIT 1`,
      [organizationId, email],
    );
    if ((existingMember.rowCount ?? 0) > 0) return fail(alreadyMember());

    const { secret, tokenHash } = newInvitationSecret();

    await client.query(`SAVEPOINT ${SAVEPOINT}`);
    let created: { id: string; email: string; expires_at: Date } | undefined;
    try {
      const result = await client.query<{ id: string; email: string; expires_at: Date }>(
        `SELECT id, email, expires_at
           FROM signet.create_invitation($1::uuid, $2::text, $3::bytea)
          WHERE organization_id = $1::uuid`,
        [organizationId, email, tokenHash],
      );
      created = result.rows[0];
    } catch (error) {
      if (!isPendingDuplicate(error)) throw error;
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      return fail(invitationAlreadyPending());
    }
    // La fonction retourne toujours la ligne inseree, ou leve.
    if (!created) throw new Error("signet.create_invitation n'a retourne aucune ligne");

    const data: InvitationCreatedEventData = {
      invitationId: created.id,
      organizationId,
      email: created.email,
      organizationName: caller.name,
      sealedToken: sealSecret(secret, created.id, key),
    };
    const queued = await sendEventWithDeadline({ id: created.id, name: INVITATION_CREATED_EVENT, data }, QUEUE_DEADLINE_MS);
    if (!queued) {
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      console.error(`[invitations] mise en file impossible pour l'invitation ${created.id} : emission annulee (503)`);
      return fail(serviceUnavailable());
    }

    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return ok({
      id: created.id,
      organizationId,
      email: created.email,
      expiresAt: created.expires_at.toISOString(),
    });
  });
}
