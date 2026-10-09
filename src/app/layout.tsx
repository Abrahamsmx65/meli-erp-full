import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import "./globals.css";
import { Armazon } from "@/components/armazon";
import { clienteServidor } from "@/lib/supabase/server";
import { rolDeSesion, type Rol } from "@/lib/acceso/roles";

// Autohospedadas por next/font (sin @import remoto bloqueante, sin CLS).
// Geist para todo el texto y los números (cifras tabulares); Bricolage
// Grotesque solo en los títulos de pantalla. Rediseño del 9-oct-2026.
const geist = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist" });
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
  variable: "--font-bricolage",
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
    <html lang="es" className={`${geist.variable} ${bricolage.variable}`}>
      <body>
        <Armazon rol={rol}>{children}</Armazon>
      </body>
    </html>
  );
}
