import type { Metadata } from "next";
import "./globals.css";
import { Armazon } from "@/components/armazon";

export const metadata: Metadata = {
  title: "GETAC · Control de inventario",
  description:
    "Inventario, envíos a Mercado Envíos Full, pedidos a China y corridas, en un solo lugar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Armazon>{children}</Armazon>
      </body>
    </html>
  );
}
