import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    // Ces tests partagent UNE base Postgres reelle, jamais mockee (regle du
    // projet). Chaque fichier appelle resetDatabase() (TRUNCATE global) dans
    // son propre beforeAll/beforeEach et certains font des assertions
    // globales (countOrganizationsDirect() compte toutes les lignes de la
    // table, sans filtre par test). Le parallelisme par defaut de vitest
    // (fichiers executes en parallele, tests d'un meme fichier en sequence)
    // rend ces deux choses incompatibles entre fichiers : le TRUNCATE ou une
    // creation d'un fichier peut retomber en plein milieu d'une assertion
    // d'un autre, cote a cote sur la meme base. Desactive ici, pas de cause a
    // effet cachee. Les tests d'un meme fichier restent sequentiels.
    fileParallelism: false,
  },
});
