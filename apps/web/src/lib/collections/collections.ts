/**
 * Creation d'une collection (US-05.1, US-05.3 ; tranche 004).
 *
 * Arguments supposes deja valides par le contrat (`./contracts`) : UUID
 * d'organisation en forme canonique, nom sans espaces de bord, 1 a 100
 * caracteres. Tout se passe dans UNE transaction sous `signet_app`, contexte de
 * l'appelant pose par `withTenant` (RLS en seconde barriere, ADR-0011) :
 *
 * 1. appartenance, filtre explicite sur `organization_id` ET `user_id` :
 *    non-membre ou organisation inexistante -> 404 identique ; owner et member
 *    sont acceptes (aucun 403) ;
 * 2. `INSERT ... RETURNING` avec `organization_id` explicite, sous point de
 *    sauvegarde (patron D-092). Pas de lecture prealable « ce nom existe-t-il ? » :
 *    la decision est dans l'index unique `collection_org_name_ci_idx` (AC6).
 *    Un `23505` sur cet index annule l'insertion seule (`ROLLBACK TO
 *    SAVEPOINT`) : `withTenant` valide ensuite une transaction saine qui n'a
 *    rien ecrit, au lieu de tenter un `COMMIT` sur une transaction en echec.
 *
 * Toute autre erreur de la base est inattendue : journalisee par son seul code
 * (jamais le nom soumis), puis relevee sans detail (500 generique).
 */
import { withTenant } from "../db";
import { collectionNameTaken, fail, ok, organizationNotFound, type Result } from "../errors";

const SAVEPOINT = "collection_creation";
const NAME_INDEX = "collection_org_name_ci_idx";

export interface CollectionView {
  id: string;
  organizationId: string;
  name: string;
  /** ISO 8601 UTC. */
  createdAt: string;
}

interface PgError {
  code?: unknown;
  constraint?: unknown;
}

function pgErrorOf(error: unknown): PgError {
  return typeof error === "object" && error !== null ? error : {};
}

function isNameTaken(error: unknown): boolean {
  const pg = pgErrorOf(error);
  return pg.code === "23505" && pg.constraint === NAME_INDEX;
}

/** Journalise le seul code de l'erreur, puis releve une erreur sans detail. */
function unexpected(error: unknown): Error {
  const code = pgErrorOf(error).code;
  console.error(`[collections] creation : erreur inattendue de la base (code ${typeof code === "string" ? code : "absent"})`);
  return new Error("creation de collection : erreur inattendue");
}

export async function createCollection(params: {
  userId: string;
  /** Forme canonique (minuscules). */
  organizationId: string;
  /** Nom tel que produit par le contrat (sans espaces de bord). */
  name: string;
}): Promise<Result<CollectionView>> {
  const { userId, organizationId, name } = params;

  return withTenant({ userId, organizationId }, async (client) => {
    const membership = await client.query(
      `SELECT 1
         FROM member m
        WHERE m.organization_id = $1 AND m.user_id = $2`,
      [organizationId, userId],
    );
    if ((membership.rowCount ?? 0) === 0) return fail(organizationNotFound());

    await client.query(`SAVEPOINT ${SAVEPOINT}`);
    let created: { id: string; organization_id: string; name: string; created_at: Date } | undefined;
    try {
      const result = await client.query<{ id: string; organization_id: string; name: string; created_at: Date }>(
        `INSERT INTO collection (organization_id, name, created_by_user_id)
         VALUES ($1, $2, $3)
         RETURNING id, organization_id, name, created_at`,
        [organizationId, name, userId],
      );
      created = result.rows[0];
    } catch (error) {
      if (!isNameTaken(error)) throw unexpected(error);
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      return fail(collectionNameTaken());
    }
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    // Un INSERT ... RETURNING qui reussit rend toujours sa ligne.
    if (!created) throw new Error("INSERT INTO collection n'a retourne aucune ligne");

    return ok({
      id: created.id,
      organizationId: created.organization_id,
      name: created.name,
      createdAt: created.created_at.toISOString(),
    });
  });
}

/** Element de `listCollections.output` : exactement ces champs (tranche 009, AC1). */
export interface CollectionListItem {
  id: string;
  name: string;
  /** ISO 8601 UTC. */
  createdAt: string;
}

interface CollectionListRow {
  id: string;
  name: string;
  created_at: Date;
}

/**
 * Liste des collections d'une organisation (US-07.1, US-07.2 ; tranche 009).
 *
 * Lecture seule, dans UNE transaction sous `signet_app` (`withTenant`, RLS en
 * seconde barriere) :
 * 1. appartenance, filtre explicite sur `organization_id` ET `user_id` :
 *    non-membre ou organisation inexistante -> 404 identique ;
 * 2. `SELECT` avec `organization_id` explicite, de la plus recente a la plus
 *    ancienne, `id DESC` a horodatage egal (D-131 point 1). Aucune pagination
 *    (D-131 point 3).
 *
 * Valeurs rendues telles qu'enregistrees (D-131 point 4), reponse construite
 * champ par champ. Toute erreur de la base est inattendue : `withTenant`
 * annule la transaction, l'erreur est journalisee par son seul code (jamais un
 * identifiant ni un nom) puis relevee sans detail (500 generique).
 */
export async function listCollections(params: {
  userId: string;
  /** Forme canonique (minuscules). */
  organizationId: string;
}): Promise<Result<CollectionListItem[]>> {
  try {
    return await readCollections(params);
  } catch (error) {
    const code = pgErrorOf(error).code;
    console.error(`[collections] lecture : erreur inattendue de la base (code ${typeof code === "string" ? code : "absent"})`);
    throw new Error("lecture des collections : erreur inattendue");
  }
}

async function readCollections(params: {
  userId: string;
  organizationId: string;
}): Promise<Result<CollectionListItem[]>> {
  const { userId, organizationId } = params;

  return withTenant({ userId, organizationId }, async (client) => {
    const membership = await client.query(
      `SELECT 1
         FROM member m
        WHERE m.organization_id = $1 AND m.user_id = $2`,
      [organizationId, userId],
    );
    if ((membership.rowCount ?? 0) === 0) return fail(organizationNotFound());

    const result = await client.query<CollectionListRow>(
      `SELECT c.id, c.name, c.created_at
         FROM collection c
        WHERE c.organization_id = $1
        ORDER BY c.created_at DESC, c.id DESC`,
      [organizationId],
    );

    return ok(
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at.toISOString(),
      })),
    );
  });
}
