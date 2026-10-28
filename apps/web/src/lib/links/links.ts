/**
 * Ajout d'un lien a une collection (US-06.1, US-06.3, US-06.4 ; tranche 005).
 *
 * Arguments supposes deja valides par le contrat (`./contracts`) : UUID
 * d'organisation et de collection en forme canonique, URL et titre sans
 * espaces de bord. Tout se passe dans UNE transaction sous `signet_app`,
 * contexte de l'appelant pose par `withTenant` (`READ COMMITTED`, RLS en
 * seconde barriere, ADR-0011) :
 *
 * 1. appartenance, filtre explicite sur `organization_id` ET `user_id` :
 *    non-membre ou organisation inexistante -> 404 identique ; owner et member
 *    sont acceptes (aucun 403) ;
 * 2. UNE seule instruction `INSERT INTO link ... SELECT ... FROM collection c
 *    WHERE c.id = $collection AND c.organization_id = $org RETURNING ...` :
 *    l'existence de la collection dans l'organisation et l'insertion ne sont
 *    pas deux etapes. Zero ligne -> 404 `COLLECTION_NOT_FOUND` (collection
 *    inexistante ou d'une autre organisation, meme corps).
 *
 * Le quota n'est JAMAIS lu ici : le trigger `signet.link_usage_on_insert()`
 * incremente le compteur sous verrou de ligne dans la meme instruction et
 * leve `SG001` au-dela du plafond (ADR-0002). L'instruction se fait sous point
 * de sauvegarde (patron D-092/D-116) : un refus traduit par
 * `linkErrorFromSqlState` annule l'insertion seule (`ROLLBACK TO SAVEPOINT`),
 * puis `withTenant` valide une transaction saine qui n'a rien ecrit, au lieu
 * de tenter un `COMMIT` sur une transaction en echec.
 *
 * Toute autre erreur de la base est inattendue : journalisee par son seul code
 * (jamais l'URL, le titre ni un identifiant), puis relevee sans detail (500
 * generique).
 */
import { withTenant } from "../db";
import { collectionNotFound, fail, ok, organizationNotFound, type Result } from "../errors";
import { linkErrorFromSqlState } from "./errors";

const SAVEPOINT = "link_addition";

export interface LinkView {
  id: string;
  collectionId: string;
  url: string;
  title: string;
  addedBy: string;
  /** ISO 8601 UTC, horloge de la base. */
  createdAt: string;
}

interface InsertedLinkRow {
  id: string;
  collection_id: string;
  url: string;
  title: string;
  added_by_user_id: string;
  created_at: Date;
}

function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/** Journalise le seul code de l'erreur, puis releve une erreur sans detail. */
function unexpected(error: unknown): Error {
  const code = sqlStateOf(error);
  console.error(`[links] ajout : erreur inattendue de la base (code ${code ?? "absent"})`);
  return new Error("ajout de lien : erreur inattendue");
}

export async function addLink(params: {
  userId: string;
  /** Forme canonique (minuscules). */
  organizationId: string;
  /** Forme canonique (minuscules). */
  collectionId: string;
  /** URL telle que produite par le contrat (sans espaces de bord, jamais reecrite). */
  url: string;
  /** Titre tel que produit par le contrat (sans espaces de bord). */
  title: string;
}): Promise<Result<LinkView>> {
  const { userId, organizationId, collectionId, url, title } = params;

  return withTenant({ userId, organizationId }, async (client) => {
    const membership = await client.query(
      `SELECT 1
         FROM member m
        WHERE m.organization_id = $1 AND m.user_id = $2`,
      [organizationId, userId],
    );
    if ((membership.rowCount ?? 0) === 0) return fail(organizationNotFound());

    await client.query(`SAVEPOINT ${SAVEPOINT}`);
    let rows: InsertedLinkRow[];
    try {
      const result = await client.query<InsertedLinkRow>(
        `INSERT INTO link (organization_id, collection_id, url, title, added_by_user_id)
         SELECT $1::uuid, c.id, $3::text, $4::text, $5::uuid
           FROM collection c
          WHERE c.id = $2::uuid AND c.organization_id = $1::uuid
         RETURNING id, collection_id, url, title, added_by_user_id, created_at`,
        [organizationId, collectionId, url, title, userId],
      );
      rows = result.rows;
    } catch (error) {
      const refusal = linkErrorFromSqlState(sqlStateOf(error));
      if (!refusal) throw unexpected(error);
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      return fail(refusal);
    }
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);

    const [created] = rows;
    if (!created) return fail(collectionNotFound());
    // INSERT ... SELECT d'au plus une ligne : collection.id est la cle primaire.
    if (rows.length > 1) throw new Error("INSERT INTO link a retourne plus d'une ligne");

    return ok({
      id: created.id,
      collectionId: created.collection_id,
      url: created.url,
      title: created.title,
      addedBy: created.added_by_user_id,
      createdAt: created.created_at.toISOString(),
    });
  });
}

/** Element de `listLinks.output` : exactement ces champs (tranche 009, AC1). */
export interface LinkListItem {
  id: string;
  url: string;
  title: string;
  addedBy: string;
  /** ISO 8601 UTC, horloge de la base. */
  createdAt: string;
}

interface LinkListRow {
  id: string;
  url: string;
  title: string;
  added_by_user_id: string;
  created_at: Date;
}

/**
 * Liste des liens d'une collection (US-07.1, US-07.2 ; tranche 009).
 *
 * Lecture seule, dans UNE transaction sous `signet_app` (`withTenant`, RLS en
 * seconde barriere) :
 * 1. appartenance, filtre explicite sur `organization_id` ET `user_id` :
 *    non-membre ou organisation inexistante -> 404 `ORGANIZATION_NOT_FOUND` ;
 * 2. existence de la collection dans l'organisation du chemin
 *    (`c.id` ET `c.organization_id`) : zero ligne -> 404
 *    `COLLECTION_NOT_FOUND`, meme corps pour inexistante et etrangere ;
 * 3. `SELECT` avec `organization_id` et `collection_id` explicites, du plus
 *    recent au plus ancien, `id DESC` a horodatage egal (D-131 point 2, index
 *    `link_collection_recent_idx`). Aucune pagination (D-131 point 3).
 *
 * Deux instructions plutot qu'une jointure : « collection absente » et « liste
 * vide » se distinguent sans ambiguite. Valeurs rendues telles qu'enregistrees
 * (D-131 point 4), reponse construite champ par champ. Toute erreur de la base
 * est inattendue : journalisee par son seul code (jamais un identifiant, une
 * URL ni un titre), puis relevee sans detail (500 generique).
 */
export async function listLinks(params: {
  userId: string;
  /** Forme canonique (minuscules). */
  organizationId: string;
  /** Forme canonique (minuscules). */
  collectionId: string;
}): Promise<Result<LinkListItem[]>> {
  try {
    return await readLinks(params);
  } catch (error) {
    console.error(`[links] lecture : erreur inattendue de la base (code ${sqlStateOf(error) ?? "absent"})`);
    throw new Error("lecture des liens : erreur inattendue");
  }
}

async function readLinks(params: {
  userId: string;
  organizationId: string;
  collectionId: string;
}): Promise<Result<LinkListItem[]>> {
  const { userId, organizationId, collectionId } = params;

  return withTenant({ userId, organizationId }, async (client) => {
    const membership = await client.query(
      `SELECT 1
         FROM member m
        WHERE m.organization_id = $1 AND m.user_id = $2`,
      [organizationId, userId],
    );
    if ((membership.rowCount ?? 0) === 0) return fail(organizationNotFound());

    const collection = await client.query(
      `SELECT 1
         FROM collection c
        WHERE c.id = $2 AND c.organization_id = $1`,
      [organizationId, collectionId],
    );
    if ((collection.rowCount ?? 0) === 0) return fail(collectionNotFound());

    const result = await client.query<LinkListRow>(
      `SELECT l.id, l.url, l.title, l.added_by_user_id, l.created_at
         FROM link l
        WHERE l.organization_id = $1 AND l.collection_id = $2
        ORDER BY l.created_at DESC, l.id DESC`,
      [organizationId, collectionId],
    );

    return ok(
      result.rows.map((row) => ({
        id: row.id,
        url: row.url,
        title: row.title,
        addedBy: row.added_by_user_id,
        createdAt: row.created_at.toISOString(),
      })),
    );
  });
}
