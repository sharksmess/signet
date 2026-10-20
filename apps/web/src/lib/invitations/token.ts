/**
 * Jeton d'invitation (ADR-0003, ADR-0017 ; D-086 Q-1, P-1 ; D-090).
 *
 * - Secret : 32 octets aleatoires (`randomBytes`). Le lien porte leur encodage
 *   base64url (43 caracteres) dans le fragment `#token=` (P-1).
 * - Empreinte : `sha256(32 octets du secret)`, avant encodage (D-090). Seule
 *   l'empreinte est ecrite en base.
 * - Scellement, pour transporter le secret jusqu'a la fonction d'envoi dans
 *   l'evenement Inngest sans jamais l'y ecrire en clair : AES-256-GCM,
 *   base64url(iv 12 octets aleatoires || chiffre || etiquette 16 octets),
 *   donnees authentifiees = identifiant de l'invitation en UTF-8. Un
 *   `sealedToken` altere, tronque, presente avec un autre identifiant ou ouvert
 *   avec une autre cle ne s'ouvre pas.
 *
 * Module pur (`node:crypto` seulement) : importe par la route ET par la
 * fonction d'envoi, il n'atteint aucun module d'acces a la base (AC15).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const TOKEN_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGORITHM = "aes-256-gcm";

export interface InvitationSecret {
  /** Les 32 octets du secret ; n'existe que le temps de l'empreinte et du scellement. */
  secret: Buffer;
  /** `sha256(secret)`, 32 octets, seule valeur persistee. */
  tokenHash: Buffer;
}

export function newInvitationSecret(): InvitationSecret {
  const secret = randomBytes(TOKEN_BYTES);
  return { secret, tokenHash: createHash("sha256").update(secret).digest() };
}

export function sealSecret(secret: Buffer, invitationId: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(invitationId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64url");
}

export type OpenedSecret = { ok: true; secret: Buffer } | { ok: false; reason: string };

/**
 * Ouvre un `sealedToken`. Echec = valeur de retour (entree externe : contenu
 * d'un evenement de file), avec une raison qui ne cite ni le jeton, ni le
 * `sealedToken`, ni la cle.
 */
export function openSealedSecret(sealedToken: string, invitationId: string, key: Buffer): OpenedSecret {
  const raw = Buffer.from(sealedToken, "base64url");
  if (raw.length !== IV_BYTES + TOKEN_BYTES + TAG_BYTES) return { ok: false, reason: "longueur inattendue" };
  const iv = raw.subarray(0, IV_BYTES);
  const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(invitationId, "utf8"));
    decipher.setAuthTag(tag);
    const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { ok: true, secret };
  } catch {
    // Etiquette refusee : alteration, autre identifiant ou autre cle.
    return { ok: false, reason: "authentification refusee" };
  }
}

/** Forme du secret dans le lien : base64url sans remplissage, 43 caracteres. */
export function secretToLinkToken(secret: Buffer): string {
  return secret.toString("base64url");
}
