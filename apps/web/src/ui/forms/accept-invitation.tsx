"use client";
/**
 * Acceptation d'une invitation (tranche 012, AC11, L-6, P-4).
 *
 * Le jeton est lu dans le FRAGMENT de l'adresse, dans le navigateur seulement
 * (le serveur ne le recoit jamais). Il ne sort du fragment que dans le CORPS de
 * `POST /api/invitations/accept`, sur clic explicite ; il n'est ecrit ni dans
 * une adresse, ni dans un stockage, ni dans un journal.
 *
 * Props : un booleen (session ouverte ou non). Sans session : formulaires de
 * connexion et d'inscription (sans organisation) incorpores ; apres succes, la
 * page est relue sans changer d'adresse (le fragment reste). Avec session :
 * bouton « Accepter l'invitation ». Apres acceptation : fragment efface de
 * l'historique, puis navigation vers la page de l'organisation.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { chooseMessage, MESSAGES } from "../messages";
import { buildAcceptRequest, isSuccess, sendRequest, tokenFromFragment } from "../requests";
import { FormMessage } from "./form-message";
import { SignInForm } from "./sign-in-form";
import { SignOutButton } from "./sign-out-button";
import { SignUpForm } from "./sign-up-form";
import { browserFetch, useSubmit } from "./use-submit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function subscribeToFragment(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function currentFragment(): string {
  return window.location.hash;
}

/** Cote serveur, le fragment n'existe pas : `null` = pas encore lu. */
function serverFragment(): string | null {
  return null;
}

function organizationIdOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("organizationId" in body)) return null;
  const id = body.organizationId;
  return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
}

export function AcceptInvitation(props: { signedIn: boolean }) {
  const router = useRouter();
  const submission = useSubmit();
  const fragment = useSyncExternalStore<string | null>(subscribeToFragment, currentFragment, serverFragment);
  const token = fragment === null ? null : tokenFromFragment(fragment);
  const incomplete = fragment !== null && token === null;

  function onAccept(): void {
    if (token === null) return;
    const request = buildAcceptRequest(token);
    void submission.run(async () => {
      const result = await sendRequest(browserFetch, request);
      if (!isSuccess(result.status)) {
        submission.fail(chooseMessage("accept", result.status, result.body), result.status, result.body);
        // 401 : session expiree, la page relue sert de nouveau les formulaires incorpores.
        if (result.status === 401) router.refresh();
        return;
      }
      const organizationId = organizationIdOf(result.body);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      if (organizationId === null) {
        submission.setMessage(MESSAGES.generic);
        return;
      }
      router.push(`/organisations/${organizationId}`);
    });
  }

  return (
    <div>
      {incomplete ? <p role="alert">{MESSAGES.invitationLinkIncomplete}</p> : null}
      {props.signedIn ? (
        <>
          {token !== null ? (
            <button type="button" onClick={onAccept} disabled={submission.pending}>
              Accepter l&apos;invitation
            </button>
          ) : null}
          <FormMessage message={submission.message} />
          {submission.failedStatus === 409 && submission.failedCode === "ALREADY_MEMBER" ? (
            <p>
              <Link href="/organisations">Mes organisations</Link>
            </p>
          ) : null}
          <SignOutButton after="refresh" />
        </>
      ) : (
        <>
          <FormMessage message={submission.message} />
          <SignInForm after="refresh" />
          <SignUpForm withOrganization={false} />
        </>
      )}
    </div>
  );
}
