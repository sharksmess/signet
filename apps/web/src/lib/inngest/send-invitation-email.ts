/**
 * Envoi de l'e-mail d'invitation (tranche 003 ; ADR-0006, ADR-0017).
 *
 * Declenchee par `signet/invitation.created`, mis en file par la route
 * d'emission avant son COMMIT. Tout ce qu'il faut est dans l'evenement : la
 * fonction n'ouvre AUCUNE connexion a la base et n'importe aucun module d'acces
 * a la base (AC15), donc aucun contexte tenant a poser (ADR-0006).
 *
 * Un seul pas, `envoyer-email` : il ouvre le jeton scelle, compose le message
 * et le remet a l'expediteur. Le jeton en clair n'existe que dans ce pas et
 * n'est jamais RETOURNE : Inngest memorise les valeurs de retour des pas (AC3).
 * Le pas retourne une issue sans secret ; une fois `sent` memorise, une
 * nouvelle execution n'envoie rien de plus (AC4 c).
 *
 * Issues :
 * - fournisseur en erreur, muet, reponse perdue : le pas leve, Inngest rejoue
 *   (AC4 a, b). Le rejeu rouvre le MEME jeton scelle : meme lien, meme cle
 *   d'idempotence (identifiant de l'invitation, AC4 d) ;
 * - jeton scelle inouvrable (altere, tronque, autre identifiant, autre cle) ou
 *   donnees mal formees : `NonRetriableError`, aucun envoi (AC3) ;
 * - aucun fournisseur configure : `NonRetriableError` nommee
 *   `EMAIL_PROVIDER_NOT_CONFIGURED` (AC14) ;
 * - `INVITATION_TOKEN_KEY` absente ou mal formee : erreur qui nomme la
 *   variable (AC16), rejouable (corrigee par un redeploiement, l'envoi reprend).
 *
 * Journaux : identifiant de l'invitation et nom de l'erreur seulement ; jamais
 * l'adresse, le jeton, le `sealedToken`, le message ni la cle. `onFailure`
 * (abandon apres les relances) : niveau erreur, meme contenu.
 *
 * Construite au premier usage (D-079), comme `getProcessStripeEvent`.
 */
import { NonRetriableError } from "inngest";
import { getServerEnv, invitationTokenKey } from "../env";
import { EmailProviderNotConfiguredError, EMAIL_PROVIDER_NOT_CONFIGURED, getEmailSender } from "../email/sender";
import { acceptLink, invitationMessage } from "../invitations/email";
import { openSealedSecret, secretToLinkToken } from "../invitations/token";
import { getInngest, INVITATION_CREATED_EVENT, invitationCreatedEventData } from "./client";

type SendOutcome = { kind: "sent" } | { kind: "unopenable" } | { kind: "provider-not-configured" };

function invitationIdOf(data: unknown): string {
  if (typeof data === "object" && data !== null && "invitationId" in data && typeof data.invitationId === "string") {
    // Identifiant affiche seulement s'il a la forme d'un UUID : jamais un texte arbitraire de la file.
    return /^[0-9a-fA-F-]{36}$/.test(data.invitationId) ? data.invitationId : "inconnu (mal forme)";
  }
  return "inconnu";
}

/**
 * Invitation abandonnee par Inngest (patron `reportAbandonedEvent`, ADR-0016) :
 * appelee apres les relances ou sur un refus non rejouable. Consequence tant
 * que le renvoi est au backlog : l'adresse reste bloquee jusqu'a l'expiration.
 * Exportee pour etre testee directement.
 */
export function reportAbandonedInvitation(originalEvent: { data?: unknown }, runId: string, error: { name?: string }): void {
  console.error(
    `[invitations] envoi de l'invitation ${invitationIdOf(originalEvent.data)} ABANDONNE apres les tentatives d'Inngest (execution ${runId}, erreur ${error.name ?? "inconnue"}) : e-mail non remis, l'invitation expirera sans renvoi`,
  );
}

function createSendInvitationEmail() {
  return getInngest().createFunction(
    {
      id: "send-invitation-email",
      triggers: { event: INVITATION_CREATED_EVENT },
      onFailure: ({ event, error }) => {
        reportAbandonedInvitation(event.data.event, event.data.run_id, error);
      },
    },
    async ({ event, step }) => {
      const parsed = invitationCreatedEventData.safeParse(event.data);
      if (!parsed.success) {
        console.error(`[invitations] evenement d'invitation ${invitationIdOf(event.data)} mal forme : ignore sans nouvelle tentative`);
        throw new NonRetriableError("evenement d'invitation mal forme");
      }
      const data = parsed.data;

      let key: Buffer;
      try {
        key = invitationTokenKey();
      } catch (error) {
        const reason = error instanceof Error ? error.message : "INVITATION_TOKEN_KEY refusee";
        console.error(`[invitations] invitation ${data.invitationId} : envoi impossible, ${reason}`);
        throw error;
      }

      const outcome = await step.run("envoyer-email", async (): Promise<SendOutcome> => {
        const opened = openSealedSecret(data.sealedToken, data.invitationId, key);
        if (!opened.ok) return { kind: "unopenable" };
        const message = invitationMessage({
          to: data.email,
          organizationName: data.organizationName,
          link: acceptLink(getServerEnv().APP_URL, secretToLinkToken(opened.secret)),
        });
        try {
          await getEmailSender().send(message, data.invitationId);
        } catch (error) {
          if (error instanceof EmailProviderNotConfiguredError) return { kind: "provider-not-configured" };
          throw error;
        }
        return { kind: "sent" };
      });

      if (outcome.kind === "unopenable") {
        console.error(
          `[invitations] invitation ${data.invitationId} : jeton scelle inouvrable (altere, autre identifiant ou autre cle), envoi abandonne sans nouvelle tentative`,
        );
        throw new NonRetriableError("jeton scelle inouvrable");
      }
      if (outcome.kind === "provider-not-configured") {
        console.error(
          `[invitations] invitation ${data.invitationId} : ${EMAIL_PROVIDER_NOT_CONFIGURED}, aucun fournisseur d'e-mails, envoi abandonne sans nouvelle tentative`,
        );
        throw new NonRetriableError(`${EMAIL_PROVIDER_NOT_CONFIGURED} : aucun fournisseur d'e-mails n'est configure`);
      }
      return { invitationId: data.invitationId, result: outcome.kind };
    },
  );
}

let sendInvitationEmail: ReturnType<typeof createSendInvitationEmail> | null = null;

/** Fonction Inngest d'envoi, construite au premier usage avec le client (D-079). */
export function getSendInvitationEmail(): ReturnType<typeof createSendInvitationEmail> {
  sendInvitationEmail ??= createSendInvitationEmail();
  return sendInvitationEmail;
}
