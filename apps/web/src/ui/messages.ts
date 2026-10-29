/**
 * Table des messages fixes (tranche 012, consigne point 7, AC14, D-147).
 *
 * Le texte affiche apres un refus appartient a une liste FERMEE : pour un code
 * d'erreur d'un contrat, le texte fixe de la route (recopie de `lib/errors.ts`
 * et des constantes des routes, sans alteration) ; sinon un texte fixe propre
 * au formulaire. Jamais la valeur soumise, jamais le message brut d'une
 * reponse s'il n'est pas dans la liste.
 *
 * Fonction pure, sans dependance : utilisee par les formulaires clients et
 * testee sans navigateur.
 */

export type FormId = "sign-in" | "sign-up" | "create-organization" | "create-collection" | "invite" | "add-link" | "accept";

export const MESSAGES = {
  generic: "Une erreur est survenue. Reessayer.",
  sessionExpired: "Session expiree.",
  throttled: "Trop de tentatives. Reessayer dans quelques minutes.",
  signInFailed: "Adresse ou mot de passe incorrect.",
  accountExists: "Un compte existe deja pour cette adresse.",
  signUpRefused: "Adresse e-mail invalide, ou mot de passe trop court (8 caracteres minimum).",
  organizationNotFound: "Organisation introuvable.",
  organizationNameInvalid: "Nom d'organisation invalide : 1 a 120 caracteres, espaces de bord exclus.",
  collectionNameInvalid: "Nom de collection invalide : 1 a 100 caracteres, espaces de bord exclus.",
  collectionNameTaken: "Une collection de cette organisation porte deja ce nom.",
  inviteEmailInvalid: "Adresse e-mail invalide.",
  invitationAlreadyPending: "Une invitation est deja en attente pour cette adresse.",
  alreadyMember: "Cette adresse est deja celle d'un membre de l'organisation.",
  serviceUnavailable: "Service momentanement indisponible. Reessayer plus tard.",
  insufficientRole: "Role insuffisant pour cette action.",
  urlInvalid:
    "URL invalide : schema http ou https en minuscules, nom d'hote obligatoire, sans identifiants, espaces ni caracteres de controle, 8 a 2048 caracteres.",
  titleInvalid: "Titre invalide : 1 a 200 caracteres, espaces de bord exclus, sans caractere nul.",
  linkInvalid: "URL ou titre invalide.",
  freeTierQuotaExceeded:
    "Le quota de liens du palier Free est atteint : aucun lien n'a ete ajoute. Passer au palier Pro pour en ajouter d'autres.",
  collectionNotFound: "Collection introuvable.",
  invitationNotFound: "Invitation introuvable.",
  invitationExpired: "Cette invitation a expire. Demander une nouvelle invitation a l'organisation.",
  invitationAlreadyUsed: "Cette invitation a deja ete utilisee.",
  invitationEmailMismatch: "Cette invitation est adressee a une autre adresse e-mail que celle du compte connecte.",
  alreadyMemberOnAcceptance: "Le compte connecte est deja membre de cette organisation.",
  invitationLinkInvalid: "Lien d'invitation invalide.",
  invitationLinkIncomplete: "Lien d'invitation incomplet",
  creationFailed: "Votre compte est cree, mais l'organisation n'a pas pu l'etre. Creez-la ci-dessous.",
  /** Seul texte de succes affiche par un formulaire : les autres ecritures relisent la page (L-3). */
  invitationSent: "Invitation enregistree : l'e-mail part dans quelques instants.",
} as const;

export const FIXED_MESSAGES: readonly string[] = Object.values(MESSAGES);

interface ErrorBody {
  code: string | undefined;
  message: string | undefined;
}

function readBody(body: unknown): ErrorBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { code: undefined, message: undefined };
  const code = "code" in body && typeof body.code === "string" ? body.code : undefined;
  const message = "message" in body && typeof body.message === "string" ? body.message : undefined;
  return { code, message };
}

/** Codes de better-auth pour un compte deja existant (`@better-auth/core`, `error/codes`). */
const ACCOUNT_EXISTS_CODES: readonly string[] = ["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"];

function signIn(status: number): string {
  if (status === 401) return MESSAGES.signInFailed;
  if (status === 429) return MESSAGES.throttled;
  return MESSAGES.generic;
}

function signUp(status: number, code: string | undefined): string {
  if (status === 429) return MESSAGES.throttled;
  if (status !== 400 && status !== 422) return MESSAGES.generic;
  if (code !== undefined && ACCOUNT_EXISTS_CODES.includes(code)) return MESSAGES.accountExists;
  return MESSAGES.signUpRefused;
}

/** Statuts communs aux formulaires prives ; `undefined` : a traiter par le formulaire. */
function privateCommon(status: number, code: string | undefined): string | undefined {
  if (status === 401) return MESSAGES.sessionExpired;
  if (status === 404 && code === "ORGANIZATION_NOT_FOUND") return MESSAGES.organizationNotFound;
  return undefined;
}

function createCollection(status: number, code: string | undefined): string {
  if (status === 422) return MESSAGES.collectionNameInvalid;
  if (status === 409 && code === "COLLECTION_NAME_TAKEN") return MESSAGES.collectionNameTaken;
  return MESSAGES.generic;
}

function invite(status: number, code: string | undefined): string {
  if (status === 422) return MESSAGES.inviteEmailInvalid;
  if (status === 409 && code === "INVITATION_ALREADY_PENDING") return MESSAGES.invitationAlreadyPending;
  if (status === 409 && code === "ALREADY_MEMBER") return MESSAGES.alreadyMember;
  if (status === 503 && code === "SERVICE_UNAVAILABLE") return MESSAGES.serviceUnavailable;
  if (status === 403 && code === "INSUFFICIENT_ROLE") return MESSAGES.insufficientRole;
  return MESSAGES.generic;
}

function addLink(status: number, code: string | undefined, message: string | undefined): string {
  if (status === 422) {
    if (message === MESSAGES.urlInvalid) return MESSAGES.urlInvalid;
    if (message === MESSAGES.titleInvalid) return MESSAGES.titleInvalid;
    return MESSAGES.linkInvalid;
  }
  if (status === 409 && code === "FREE_TIER_QUOTA_EXCEEDED") return MESSAGES.freeTierQuotaExceeded;
  if (status === 404 && code === "COLLECTION_NOT_FOUND") return MESSAGES.collectionNotFound;
  return MESSAGES.generic;
}

function accept(status: number, code: string | undefined): string {
  if (status === 401) return MESSAGES.sessionExpired;
  if (status === 422) return MESSAGES.invitationLinkInvalid;
  if (status === 404 && code === "INVITATION_NOT_FOUND") return MESSAGES.invitationNotFound;
  if (status === 410 && code === "INVITATION_EXPIRED") return MESSAGES.invitationExpired;
  if (status === 409 && code === "INVITATION_ALREADY_USED") return MESSAGES.invitationAlreadyUsed;
  if (status === 403 && code === "INVITATION_EMAIL_MISMATCH") return MESSAGES.invitationEmailMismatch;
  if (status === 409 && code === "ALREADY_MEMBER") return MESSAGES.alreadyMemberOnAcceptance;
  return MESSAGES.generic;
}

/**
 * Texte fixe a afficher pour un refus. `status` 0 : erreur reseau ; `body` :
 * corps JSON decode, texte, ou `undefined`. Rend toujours un element de
 * `FIXED_MESSAGES`.
 */
export function chooseMessage(form: FormId, status: number, body: unknown): string {
  if (status === 0) return MESSAGES.generic;
  const { code, message } = readBody(body);
  switch (form) {
    case "sign-in":
      return signIn(status);
    case "sign-up":
      return signUp(status, code);
    case "accept":
      return accept(status, code);
    case "create-organization":
      return privateCommon(status, code) ?? (status === 422 ? MESSAGES.organizationNameInvalid : MESSAGES.generic);
    case "create-collection":
      return privateCommon(status, code) ?? createCollection(status, code);
    case "invite":
      return privateCommon(status, code) ?? invite(status, code);
    case "add-link":
      return privateCommon(status, code) ?? addLink(status, code, message);
  }
}
