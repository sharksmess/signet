// Extrait a integrer dans vitest.config.ts du projet.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/_factory/global-setup.ts"],
    // Une base et un serveur partages : les fichiers s'executent l'un apres l'autre.
    // Les tests d'un fichier restent independants entre eux. Passer a une base et
    // un serveur par worker quand la suite depasse ~2 minutes (ADR).
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 180_000,
  },
});
