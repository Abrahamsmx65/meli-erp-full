import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { Armazon } from "@/components/armazon";
import { clienteServidor } from "@/lib/supabase/server";
import { rolDeSesion, type Rol } from "@/lib/acceso/roles";

// Autohospedadas por next/font (sin @import remoto bloqueante, sin CLS).
// DM Sans para todo: texto, números (cifras tabulares) y títulos. La serif
// Fraunces de los títulos se quitó el 16-nov-2026 (rediseño «blanco limpio»:
// una sola letra, una descarga menos en cada primera visita).
const texto = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-texto" });

export const metadata: Metadata = {
  title: "GETAC",
  description:
    "Inventario, envíos a Mercado Envíos Full, pedidos a China y corridas, en un solo lugar.",
};

// La barra del navegador del teléfono toma la crema del menú (`--sidebar`).
export const viewport: Viewport = { themeColor: "#ffffff" };

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
    <html lang="es" className={texto.variable}>
      <body>
        <Armazon rol={rol}>{children}</Armazon>
      </body>
    </html>
  );
}
