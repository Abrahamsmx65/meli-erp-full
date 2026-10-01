import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Archivo, Figtree, JetBrains_Mono } from "next/font/google";
import { CarritoProvider } from "@/components/carrito";
import { ContadorCarrito } from "@/components/contador-carrito";
import "./globals.css";

const display = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--f-display", display: "swap" });
const texto = Figtree({ subsets: ["latin"], variable: "--f-texto", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--f-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "GETAC · Calzado", template: "%s · GETAC" },
  description: "Calzado GETAC con envío a todo México. Paga con tarjeta, OXXO o transferencia con Mercado Pago.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#15171c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" className={`${display.variable} ${texto.variable} ${mono.variable}`}>
      <body>
        <CarritoProvider>
          <header className="barra">
            <div className="contenedor barra-in">
              <Link href="/" className="marca" aria-label="GETAC, inicio">
                GETAC
              </Link>
              <nav className="barra-nav" aria-label="Principal">
                <Link href="/">Catálogo</Link>
                <Link href="/cuenta">Mi cuenta</Link>
                <ContadorCarrito />
              </nav>
            </div>
          </header>
          <main>{children}</main>
          <footer className="pie-pagina">
            <div className="contenedor">
              GETAC · Calzado mexicano. Pagos seguros con Mercado Pago (tarjeta, meses, OXXO y SPEI). Envíos a todo México.
            </div>
          </footer>
        </CarritoProvider>
      </body>
    </html>
  );
}
