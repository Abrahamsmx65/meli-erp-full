import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Armazon } from "@/components/armazon";

// Autohospedada por next/font: sin @import remoto bloqueante, sin CLS de
// fuente y con display swap. Los mismos pesos que se usaban de Google Fonts.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "GETAC · Control de inventario",
  description:
    "Inventario, envíos a Mercado Envíos Full, pedidos a China y corridas, en un solo lugar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      <body>
        <Armazon>{children}</Armazon>
      </body>
    </html>
  );
}
