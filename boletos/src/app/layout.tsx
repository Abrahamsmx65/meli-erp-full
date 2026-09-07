import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jalá le Zibug 2026 · Boletos",
  description: "Unamos nuestras Tefilot para encontrar pareja. Aparta tu Kit de Jalá y paga por transferencia.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#7a1f3d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
