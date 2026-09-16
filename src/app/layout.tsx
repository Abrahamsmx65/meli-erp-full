import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Armazon } from "@/components/armazon";
import { clienteServidor } from "@/lib/supabase/server";
import { rolDeSesion, type Rol } from "@/lib/acceso/roles";

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
    <html lang="es" className={inter.variable}>
      <body>
        <Armazon rol={rol}>{children}</Armazon>
      </body>
    </html>
  );
}
