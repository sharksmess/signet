/**
 * Gabarit commun (tranche 012) : langue francaise, titre de page FIXE (aucune
 * valeur libre dans `<title>`), aucune donnee lue.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signet",
};

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <header className="banner">Signet</header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}
