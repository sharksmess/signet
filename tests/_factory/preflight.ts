// Controle prealable du composant natif de Next (SWC) — usine 1.5.
// Vecu (Signet, 2026-10-02 puis 07) : Smart App Control (Windows 11) bloquait le
// binaire natif de Next. Le build echouait avec un message obscur, et l'on a
// d'abord cru a un probleme de version. Ce controle nomme la cause en une phrase.
import { createRequire } from "node:module";
import path from "node:path";

/** Paquet natif SWC de Next pour cette plateforme ; null si on ne sait pas le nommer surement. */
export function swcPackageName(platform: string = process.platform, arch: string = process.arch): string | null {
  if (platform === "win32") return `@next/swc-win32-${arch}-msvc`;
  if (platform === "darwin") return `@next/swc-darwin-${arch}`;
  return null; // Linux : variantes gnu/musl, et aucun blocage de ce type connu
}

/** Message lisible pour un echec de chargement du composant natif. */
export function explainNativeLoadError(pkg: string, err: unknown): string {
  const e = err as { code?: string; message?: string } | undefined;
  const text = String(e?.message ?? err);
  if (/contr[oô]le d.application|application control|blocked this file/i.test(text)) {
    return (
      `Windows bloque le composant natif ${pkg} (Smart App Control ou strategie de controle d'application). ` +
      `Next ne peut pas construire l'application : aucun test ne peut tourner. ` +
      `C'est une decision humaine (WINDOWS.md de l'usine, section Smart App Control) : un agent ne contourne jamais une protection du systeme.`
    );
  }
  return (
    `Le composant natif ${pkg} ne se charge pas (${e?.code ?? "erreur"}). ` +
    `Relance pnpm install ; si le probleme persiste, il vient de l'installation, pas du code.`
  );
}

/** null si tout va bien (ou si l'on ne peut rien verifier) ; sinon la phrase d'erreur. */
export function checkNextNativeBinding(appDir: string): string | null {
  const pkg = swcPackageName();
  if (!pkg) return null;
  const fromApp = createRequire(path.join(appDir, "package.json"));
  let nextPkg: string;
  try {
    nextPkg = fromApp.resolve("next/package.json");
  } catch {
    return null; // projet sans Next
  }
  const fromNext = createRequire(nextPkg);
  let binding: string;
  try {
    binding = fromNext.resolve(pkg);
  } catch {
    return null; // composant absent pour cette plateforme : Next gere lui-meme ce cas
  }
  try {
    fromNext(binding);
    return null;
  } catch (err) {
    return explainNativeLoadError(pkg, err);
  }
}
