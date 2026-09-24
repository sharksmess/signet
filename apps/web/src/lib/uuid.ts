/**
 * Generateur UUIDv7 cote applicatif, algorithmiquement identique a
 * `signet.uuidv7()` (packages/db/migrations/0001_roles_schema_context.sql) :
 * 48 bits d'horodatage unix en millisecondes, nibble de version (0111), deux
 * bits de variant (10), reste aleatoire (`crypto.randomBytes`).
 *
 * Utilise par la configuration better-auth (`advanced.database.generateId`,
 * ERD "Notes d'implementation") : better-auth genere ses propres identifiants
 * cote Node avant l'INSERT, il ne peut pas s'appuyer sur le DEFAULT SQL.
 * Aucune dependance nouvelle : `node:crypto` est du socle Node, pas un paquet
 * ajoute au projet.
 */
import { randomBytes } from "node:crypto";

export function uuidv7(): string {
  const unixTimeMs = BigInt(Date.now());
  const random = randomBytes(10);

  const bytes = Buffer.alloc(16);
  bytes[0] = Number((unixTimeMs >> 40n) & 0xffn);
  bytes[1] = Number((unixTimeMs >> 32n) & 0xffn);
  bytes[2] = Number((unixTimeMs >> 24n) & 0xffn);
  bytes[3] = Number((unixTimeMs >> 16n) & 0xffn);
  bytes[4] = Number((unixTimeMs >> 8n) & 0xffn);
  bytes[5] = Number(unixTimeMs & 0xffn);

  // Octet 6 : nibble haut = version 0111, nibble bas = alea.
  bytes[6] = 0x70 | ((random[0] ?? 0) & 0x0f);
  bytes[7] = random[1] ?? 0;

  // Octet 8 : deux bits hauts = variant 10, six bits bas = alea.
  bytes[8] = 0x80 | ((random[2] ?? 0) & 0x3f);
  bytes[9] = random[3] ?? 0;
  bytes[10] = random[4] ?? 0;
  bytes[11] = random[5] ?? 0;
  bytes[12] = random[6] ?? 0;
  bytes[13] = random[7] ?? 0;
  bytes[14] = random[8] ?? 0;
  bytes[15] = random[9] ?? 0;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
