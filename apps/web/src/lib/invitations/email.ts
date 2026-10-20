/**
 * Message d'invitation (US-02.3, tranche 003, D-086 P-1).
 *
 * - Texte brut seulement.
 * - Sujet FIXE : le nom de l'organisation, saisi par un owner, n'apparait que
 *   dans le corps, jamais dans le sujet ni dans un en-tete (pas d'injection
 *   d'en-tete). Les caracteres de controle du nom sont remplaces par des
 *   espaces (pas de fausse ligne fabriquee dans le corps).
 * - Lien : `APP_URL + /invitations/accept#token=<jeton>`. Le jeton est dans le
 *   FRAGMENT : jamais transmis au serveur, absent des journaux d'acces (P-1).
 *
 * Module pur, sans acces a la base (AC15).
 */
import type { EmailMessage } from "../email/sender";

export const INVITATION_SUBJECT = "Invitation a rejoindre une organisation sur Signet";

export function acceptLink(appUrl: string, linkToken: string): string {
  return `${appUrl.replace(/\/$/, "")}/invitations/accept#token=${linkToken}`;
}

function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

function printable(value: string): string {
  return Array.from(value, (char) => (isControl(char) ? " " : char))
    .join("")
    .trim();
}

export function invitationMessage(params: {
  to: string;
  organizationName: string;
  link: string;
}): EmailMessage {
  const text = [
    "Bonjour,",
    "",
    `Vous etes invite(e) a rejoindre l'organisation « ${printable(params.organizationName)} » sur Signet.`,
    "",
    "Pour accepter l'invitation, ouvrez ce lien (valable 7 jours, a usage unique) :",
    params.link,
    "",
    "Si vous n'attendiez pas cette invitation, ignorez ce message.",
    "",
  ].join("\n");
  return { to: params.to, subject: INVITATION_SUBJECT, text };
}
