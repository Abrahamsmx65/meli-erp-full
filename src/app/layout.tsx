import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import { Armazon } from "@/components/armazon";
import { clienteServidor } from "@/lib/supabase/server";
import { rolDeSesion, type Rol } from "@/lib/acceso/roles";

// Autohospedadas por next/font (sin @import remoto bloqueante, sin CLS).
// Marca GETAC (9-oct-2026): DM Sans para el texto y los números (cálida,
// con cifras tabulares) y Fraunces, una serif suave, solo en los títulos:
// combina con el trazo de pincel del logo «since 1981».
const texto = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-texto" });
const titulo = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-titulo",
});

export const metadata: Metadata = {
  title: "GETAC",
  description:
    "Inventario, envíos a Mercado Envíos Full, pedidos a China y corridas, en un solo lugar.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // El rol sale del JWT de la cookie, sin viaje a Supabase: el menú de
  // quien solo es de TikTok no debe ni nombrar el resto del sistema.
  let rol: Rol = "dueño";
  try {
    const supabase = await clienteServidor();
    const { data } = await supabase.auth.getSession();
    rol = rolDeSesion(data.session?.user);
  } catch {
    rol = "dueño";
  }
  return (
    <html lang="es" className={`${texto.variable} ${titulo.variable}`}>
      <body>
        <Armazon rol={rol}>{children}</Armazon>
      </body>
    </html>
  );
}
