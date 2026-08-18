import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Planeador de envíos a Full",
  description:
    "Calcula qué cajas mandar a Mercado Envíos Full con demanda corregida por agotamientos.",
};

const NAV = [
  { href: "/", texto: "Plan de envío" },
  { href: "/skus", texto: "SKUs" },
  { href: "/pendientes", texto: "Pendientes" },
  { href: "/importar", texto: "Importar" },
  { href: "/ajustes", texto: "Ajustes" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="min-h-screen">
          <header
            className="sticky top-0 z-20 border-b"
            style={{ background: "var(--surface-1)", borderColor: "var(--borde)" }}
          >
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
              <Link href="/" className="text-sm font-semibold">
                Envíos a Full
              </Link>
              <nav className="flex flex-wrap items-center gap-1 text-sm">
                {NAV.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="rounded-md px-2.5 py-1 transition-colors hover:bg-[color-mix(in_oklab,var(--ink-1)_8%,transparent)]"
                    style={{ color: "var(--ink-2)" }}
                  >
                    {n.texto}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-[1400px] px-5 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
