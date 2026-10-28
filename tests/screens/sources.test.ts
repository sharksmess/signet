/**
 * Tranche 012 — verifications de SOURCE : AC8 (aucun dangerouslySetInnerHTML dans
 * apps/web/src) et AC11 (le module client de l'acceptation n'ecrit le jeton ni
 * dans une adresse, ni dans un stockage, ni dans un journal).
 *
 * Lecture des fichiers par `fs`, commentaires retires avant recherche (un
 * commentaire qui cite le motif interdit n'est pas un faux positif). Les
 * detecteurs sont eux-memes testes sur des echantillons positifs et negatifs :
 * un detecteur qui ne detecte rien ferait passer tout code.
 *
 * Ce ne sont pas des verifications de tranche (aucune comparaison a `main`) :
 * elles decrivent une propriete du code courant, vraie a chaque tranche suivante.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isClientModule, readSource, sourceFiles, stripComments, tokenLeaks, WEB_SRC } from "../helpers/screens-source";

const relative = (file: string): string => path.relative(WEB_SRC, file).split(path.sep).join("/");

describe("detecteurs : stripComments", () => {
  it("retire les commentaires de ligne et de bloc, garde le code et les chaines (dont les URL en https://)", () => {
    const source = [
      "// dangerouslySetInnerHTML dans un commentaire",
      "const a = 1; /* localStorage dans un bloc */ const b = 'https://exemple.invalid/x'; // console.log(token)",
      'const c = "// pas un commentaire";',
      "/** multi",
      " * ligne : sessionStorage",
      " */",
      "const d = `${a}//`;",
    ].join("\n");

    const code = stripComments(source);

    expect(code).not.toContain("dangerouslySetInnerHTML");
    expect(code).not.toContain("localStorage");
    expect(code).not.toContain("sessionStorage");
    expect(code).not.toContain("console.log");
    expect(code).toContain("'https://exemple.invalid/x'");
    expect(code).toContain('"// pas un commentaire"');
    expect(code.split("\n")).toHaveLength(source.split("\n").length);
  });

  it("garde une utilisation reelle du motif interdit", () => {
    expect(stripComments("<div dangerouslySetInnerHTML={{ __html: x }} />")).toContain("dangerouslySetInnerHTML");
  });
});

describe("detecteurs : tokenLeaks", () => {
  const BAD: readonly [string, string][] = [
    ["router.push avec le jeton", "router.push(`/organisations?token=${token}`)"],
    ["router.replace avec le jeton", "router.replace('/x/' + token)"],
    ["href avec le jeton", "<a href={`/connexion#token=${token}`}>x</a>"],
    ["window.location.href", "window.location.href = '/connexion?x=' + token;"],
    ["location.assign", "window.location.assign(`/x/${token}`)"],
    ["localStorage", "localStorage.setItem('t', token)"],
    ["sessionStorage", "sessionStorage.setItem('t', token)"],
    ["cookie", "document.cookie = `t=${token}`"],
    ["console", "console.error(token)"],
    ["parametre ?token=", "const url = `/api/x?token=${token}`;"],
    ["history avec le jeton", "history.replaceState(null, '', `#token=${token}`)"],
    ["URLSearchParams", "new URLSearchParams({ token })"],
  ];

  it.each(BAD)("detecte : %s", (_name, source) => {
    expect(tokenLeaks(source), source).not.toEqual([]);
  });

  const GOOD: readonly [string, string][] = [
    ["lecture du fragment", "const token = tokenFromFragment(window.location.hash);"],
    ["effacement du fragment", "window.history.replaceState(null, '', window.location.pathname + window.location.search);"],
    ["navigation vers l'organisation", "router.push(`/organisations/${organizationId}`);"],
    ["envoi dans le corps", "await fetch(request.path, { method: 'POST', body: request.body });"],
    ["commentaire qui cite le motif", "// jamais console.log(token) ni localStorage"],
    ["bloc de commentaire", "/* router.push(`?token=${token}`) */ const x = 1;"],
  ];

  it.each(GOOD)("ne signale pas : %s", (_name, source) => {
    expect(tokenLeaks(source), source).toEqual([]);
  });
});

describe("AC8 : aucun dangerouslySetInnerHTML dans apps/web/src", () => {
  it("AC8 : aucun fichier de apps/web/src n'emploie dangerouslySetInnerHTML (commentaires exclus)", () => {
    const files = sourceFiles();
    expect(files.length, "des fichiers sources sont trouves").toBeGreaterThan(5);

    const offenders = files.filter((file) => /dangerouslySetInnerHTML/.test(stripComments(readSource(file)))).map(relative);

    expect(offenders).toEqual([]);
  });

  it("AC8 : aucun usage de innerHTML / outerHTML / insertAdjacentHTML / document.write dans les composants", () => {
    const offenders = sourceFiles()
      .filter((file) => /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|\bdocument\s*\.\s*write\s*\(/.test(stripComments(readSource(file))))
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it("AC8 : le dossier de l'interface existe (apps/web/src/ui) : les pages et composants de la tranche sont presents", () => {
    const ui = sourceFiles().map(relative).filter((file) => file.startsWith("ui/"));

    expect(ui, "fichiers de apps/web/src/ui").not.toEqual([]);
    expect(sourceFiles().map(relative).some((file) => file.startsWith("app/") && /page\.tsx$/.test(file)), "au moins une page").toBe(true);
  });
});

describe("AC11 : le module client de l'acceptation ne fait pas sortir le jeton du fragment", () => {
  function acceptanceClientModules(): string[] {
    return sourceFiles().filter((file) => {
      const source = readSource(file);
      if (!isClientModule(source)) return false;
      return /\b(?:tokenFromFragment|buildAcceptRequest)\b/.test(stripComments(source));
    });
  }

  it("AC11 : un module client (\"use client\") lit le fragment et construit la requete d'acceptation", () => {
    const modules = acceptanceClientModules().map(relative);

    expect(modules, "aucun module client n'utilise tokenFromFragment ou buildAcceptRequest").not.toEqual([]);
  });

  it("AC11 : ce module n'ecrit le jeton ni dans une adresse (router, href, location, parametre), ni dans un stockage (localStorage, sessionStorage, cookie), ni dans un journal (console)", () => {
    const modules = acceptanceClientModules();
    expect(modules.length).toBeGreaterThan(0);

    for (const file of modules) {
      expect(tokenLeaks(readSource(file)), `${relative(file)} : fuites du jeton`).toEqual([]);
    }
  });

  it("AC11 : aucun module de apps/web/src n'ecrit un jeton dans un stockage ou un journal", () => {
    const offenders = sourceFiles().filter((file) => {
      const code = stripComments(readSource(file));
      return /\b(?:localStorage|sessionStorage)\b|\bdocument\s*\.\s*cookie\b/.test(code) && /token/i.test(code);
    });

    expect(offenders.map(relative)).toEqual([]);
  });
});
