/**
 * Crochet de demarrage de Next (D-070 ; AC13, A2).
 *
 * Valide l'environnement du serveur (`lib/env.ts`) avant la premiere requete
 * et arrete le processus s'il est invalide : variable de facturation absente
 * ou mal formee, `STRIPE_API_BASE_URL` hors `APP_ENV=test`, mode developpement
 * d'Inngest en production, `INNGEST_SIGNING_KEY` absente hors mode
 * developpement. Preuve : `tests/billing/startup.test.ts`.
 *
 * L'arret (`process.exit`) vit dans `lib/env.ts`, importe seulement sous le
 * runtime Node : Next n'embarque pas ce module dans le bundle Edge, ou
 * `process.exit` n'existe pas. Next n'appelle pas ce crochet pendant `next build`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertServerEnvOrExit } = await import("./lib/env");
    assertServerEnvOrExit(process.env);
  }
}
