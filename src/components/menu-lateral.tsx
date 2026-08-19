"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

/**
 * Menú lateral.
 *
 * El sistema dejó de ser "un planeador de envíos" para ser varias cosas, y la
 * navegación tiene que reflejarlo. Envíos a Full es ahora UNA sección, no la
 * app entera.
 */

interface Entrada {
  href: string;
  texto: string;
  icono: string;
  /** una línea de qué hace, para quien entra por primera vez */
  ayuda?: string;
}

interface Grupo {
  titulo: string | null;
  entradas: Entrada[];
}

const GRUPOS: Grupo[] = [
  {
    titulo: null,
    entradas: [{ href: "/", texto: "Resumen", icono: "◈", ayuda: "Cómo va todo hoy" }],
  },
  {
    titulo: "Inventario",
    entradas: [
      { href: "/inventario", texto: "Bodega", icono: "▦", ayuda: "Cajas y existencias por SKU" },
    ],
  },
  {
    titulo: "Mercado Libre",
    entradas: [
      { href: "/ventas", texto: "Ventas", icono: "◷", ayuda: "En vivo y por modelo" },
      { href: "/envios", texto: "Envíos a Full", icono: "▶", ayuda: "Qué cajas mandar" },
      { href: "/etiquetas", texto: "Etiquetas", icono: "▭", ayuda: "Imprimir etiquetas" },
    ],
  },
  {
    titulo: "Amazon",
    entradas: [
      { href: "/amazon", texto: "Amazon y FBA", icono: "▲", ayuda: "Ventas, stock y envíos a FBA" },
    ],
  },
  {
    titulo: "Abastecimiento",
    entradas: [
      { href: "/pedidos", texto: "Planificación China", icono: "⛴", ayuda: "Qué pedir y qué viene en camino" },
      { href: "/corridas", texto: "Corridas", icono: "≡", ayuda: "Tallas por caja" },
    ],
  },
  {
    titulo: "Sistema",
    entradas: [
      { href: "/pendientes", texto: "Pendientes", icono: "!", ayuda: "Lo que falta resolver" },
      { href: "/sincronizar", texto: "Sincronizar", icono: "↻", ayuda: "Traer datos de Mercado Libre" },
      { href: "/ajustes", texto: "Ajustes", icono: "⚙", ayuda: "Parámetros y conexión" },
    ],
  },
];

export function MenuLateral({ pendientes }: { pendientes?: number }) {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);

  const activo = (href: string) =>
    href === "/" ? ruta === "/" : ruta.startsWith(href);

  return (
    <>
      {/* Barra superior solo en pantallas chicas */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-3 lg:hidden"
        style={{ background: "var(--surface-1)", borderColor: "var(--borde)" }}
      >
        <button
          onClick={() => setAbierto((v) => !v)}
          aria-label="Abrir menú"
          aria-expanded={abierto}
          className="rounded-md border px-2 py-1 text-sm"
          style={{ borderColor: "var(--borde)" }}
        >
          ☰
        </button>
        <span className="text-sm font-semibold">GETAC</span>
      </div>

      <nav
        aria-label="Secciones"
        className={`${
          abierto ? "block" : "hidden"
        } fixed inset-y-0 left-0 z-40 w-60 overflow-y-auto border-r px-3 py-4 lg:sticky lg:top-0 lg:block lg:h-screen`}
        style={{ background: "var(--surface-1)", borderColor: "var(--borde)" }}
      >
        <div className="mb-5 px-2">
          <div className="text-sm font-semibold">GETAC</div>
          <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
            Control de inventario
          </div>
        </div>

        {GRUPOS.map((g) => (
          <div key={g.titulo ?? "principal"} className="mb-4">
            {g.titulo ? (
              <div
                className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--ink-muted)" }}
              >
                {g.titulo}
              </div>
            ) : null}

            <ul className="flex flex-col gap-0.5">
              {g.entradas.map((e) => {
                const act = activo(e.href);
                return (
                  <li key={e.href}>
                    <Link
                      href={e.href}
                      onClick={() => setAbierto(false)}
                      aria-current={act ? "page" : undefined}
                      className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors"
                      style={{
                        background: act ? "var(--acento-suave)" : "transparent",
                        color: act ? "var(--acento)" : "var(--ink-1)",
                        fontWeight: act ? 600 : 400,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="mt-0.5 w-4 shrink-0 text-center text-xs"
                        style={{ color: act ? "var(--acento)" : "var(--ink-muted)" }}
                      >
                        {e.icono}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm">
                          {e.texto}
                          {e.href === "/pendientes" && pendientes ? (
                            <span
                              className="cifra rounded-full px-1.5 text-[10px] font-semibold"
                              style={{
                                background: "var(--estado-alerta)",
                                color: "#0b0b0b",
                              }}
                            >
                              {pendientes > 99 ? "99+" : pendientes}
                            </span>
                          ) : null}
                        </span>
                        {e.ayuda ? (
                          <span
                            className="block text-[11px] leading-tight"
                            style={{ color: "var(--ink-muted)" }}
                          >
                            {e.ayuda}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {abierto ? (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          style={{ background: "rgba(0,0,0,.35)" }}
          onClick={() => setAbierto(false)}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
