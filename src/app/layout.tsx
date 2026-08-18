import type { Metadata } from "next";
import "./globals.css";
import { MenuLateral } from "@/components/menu-lateral";
import { EstadoConexion } from "@/components/estado-conexion";

export const metadata: Metadata = {
  title: "GETAC · Control de inventario",
  description:
    "Inventario, envíos a Mercado Envíos Full, pedidos a China y corridas, en un solo lugar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="flex min-h-screen flex-col lg:flex-row">
          <MenuLateral />
          <div className="min-w-0 flex-1">
            <EstadoConexion />
            <main className="mx-auto max-w-[1400px] px-5 py-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
