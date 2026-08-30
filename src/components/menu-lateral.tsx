"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Barcode,
  Boxes,
  Clapperboard,
  Container,
  LayoutList,
  LogOut,
  Megaphone,
  Menu,
  Package,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  Settings,
  Ship,
  ShoppingCart,
  Tags,
  Truck,
  Upload,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * Menú lateral, con el lenguaje visual de la maqueta aprobada: barra oscura
 * fija, secciones etiquetadas y entrada activa marcada con la barra ámbar.
 *
 * El sistema dejó de ser "un planeador de envíos" para ser varias cosas, y la
 * navegación tiene que reflejarlo. Envíos a Full es ahora UNA sección, no la
 * app entera.
 */

interface Entrada {
  href: string;
  texto: string;
  icono: LucideIcon;
  /** una línea de qué hace, para quien entra por primera vez */
  ayuda?: string;
}

interface Grupo {
  titulo: string | null;
  entradas: Entrada[];
}

const GRUPOS: Grupo[] = [
  {
    titulo: "Inventario",
    entradas: [
      { href: "/inventario", texto: "Bodega", icono: Warehouse, ayuda: "Cajas y existencias por SKU" },
      { href: "/productos", texto: "Productos y costos", icono: Tags, ayuda: "Categoría y costo por color" },
    ],
  },
  {
    titulo: "Mercado Libre",
    entradas: [
      { href: "/ventas", texto: "Ventas", icono: Activity, ayuda: "En vivo y por modelo" },
      { href: "/listados", texto: "Listados", icono: LayoutList, ayuda: "Variantes y atributos por agrupador" },
      { href: "/publicidad", texto: "Publicidad", icono: Megaphone, ayuda: "Costo de ads por unidad vendida" },
      { href: "/envios", texto: "Envíos a Full", icono: Truck, ayuda: "Qué cajas mandar" },
      { href: "/etiquetas", texto: "Etiquetas", icono: Barcode, ayuda: "Imprimir etiquetas" },
      { href: "/videos", texto: "Videos", icono: Clapperboard, ayuda: "Videos de producto con IA" },
      { href: "/fiscal", texto: "Datos fiscales", icono: ReceiptText, ayuda: "SAT e IVA de publicaciones sin datos" },
    ],
  },
  {
    titulo: "Amazon",
    entradas: [
      { href: "/amazon/ventas", texto: "Ventas Amazon", icono: ShoppingCart, ayuda: "En vivo y por modelo" },
      { href: "/amazon/publicidad", texto: "Publicidad", icono: Megaphone, ayuda: "Costo de ads por unidad vendida" },
      { href: "/amazon", texto: "Envíos a FBA", icono: PackageCheck, ayuda: "Stock FBA y qué cajas mandar" },
    ],
  },
  {
    titulo: "TikTok Shop",
    entradas: [
      { href: "/tiktok/ventas", texto: "Ventas TikTok", icono: ShoppingCart, ayuda: "Pedidos y qué hay que empacar" },
      { href: "/tiktok", texto: "Almacén TikTok", icono: PackageCheck, ayuda: "Kardex y disponible publicado" },
    ],
  },
  {
    titulo: "Abastecimiento",
    entradas: [
      { href: "/pedidos", texto: "Planificación China", icono: Ship, ayuda: "Qué pedir y qué viene en camino" },
      { href: "/contenedores", texto: "Contenedores", icono: Container, ayuda: "ETA, llegada y packing list" },
      { href: "/corridas", texto: "Corridas", icono: Boxes, ayuda: "Tallas por caja" },
    ],
  },
  {
    titulo: "Sistema",
    entradas: [
      { href: "/pendientes", texto: "Pendientes", icono: AlertTriangle, ayuda: "Lo que falta resolver" },
      { href: "/importar", texto: "Importar", icono: Upload, ayuda: "Bodega desde Industher y corridas del sheet" },
      { href: "/sincronizar", texto: "Sincronizar", icono: RefreshCw, ayuda: "Traer datos de Mercado Libre" },
      { href: "/ajustes", texto: "Ajustes", icono: Settings, ayuda: "Parámetros y conexión" },
    ],
  },
];

export function MenuLateral({ pendientes }: { pendientes?: number }) {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);

  // Gana la entrada MÁS específica: /amazon/ventas no debe encender /amazon.
  const todos = GRUPOS.flatMap((g) => g.entradas.map((e) => e.href));
  const activo = (href: string) => {
    if (href === "/") return ruta === "/";
    if (!ruta.startsWith(href)) return false;
    return !todos.some((otro) => otro !== href && otro.startsWith(href) && ruta.startsWith(otro));
  };

  return (
    <>
      {/* Barra superior solo en pantallas chicas */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-3 lg:hidden"
        style={{ background: "var(--sidebar)", borderColor: "var(--sidebar-borde)", color: "var(--sidebar-texto)" }}
      >
        <button
          onClick={() => setAbierto((v) => !v)}
          aria-label="Abrir menú"
          aria-expanded={abierto}
          className="rounded-md border p-1.5"
          style={{ borderColor: "var(--sidebar-borde)" }}
        >
          <Menu size={16} />
        </button>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: "var(--ambar)", color: "hsl(198 28% 15%)" }}
        >
          <Package size={15} strokeWidth={2.5} />
        </span>
        <span className="text-sm font-extrabold tracking-tight">GETAC</span>
      </div>

      <nav
        aria-label="Secciones"
        className={`${
          abierto ? "block" : "hidden"
        } fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto px-3 py-5 lg:sticky lg:top-0 lg:block lg:h-screen`}
        style={{
          background: "var(--sidebar)",
          borderRight: "1px solid var(--sidebar-borde)",
          color: "var(--sidebar-texto)",
        }}
      >
        <div className="mb-6 flex items-center justify-between px-2">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: "var(--ambar)", color: "hsl(198 28% 15%)" }}
            >
              <Package size={19} strokeWidth={2.5} />
            </span>
            <span>
              <span className="block text-[15px] font-extrabold tracking-tight">GETAC</span>
              <span
                className="block text-[9px] font-bold uppercase tracking-[0.18em]"
                style={{ color: "color-mix(in oklab, var(--sidebar-texto) 55%, transparent)" }}
              >
                Control de inventario
              </span>
            </span>
          </div>
          <button
            onClick={() => setAbierto(false)}
            aria-label="Cerrar menú"
            className="rounded-md p-1 lg:hidden"
            style={{ color: "color-mix(in oklab, var(--sidebar-texto) 70%, transparent)" }}
          >
            <X size={16} />
          </button>
        </div>

        {GRUPOS.map((g) => (
          <div key={g.titulo ?? "principal"} className="mb-4">
            {g.titulo ? (
              <div
                className="mb-1.5 px-2 text-[9px] font-extrabold uppercase tracking-[0.14em]"
                style={{ color: "color-mix(in oklab, var(--sidebar-texto) 38%, transparent)" }}
              >
                {g.titulo}
              </div>
            ) : null}

            <ul className="flex flex-col gap-0.5">
              {g.entradas.map((e) => {
                const act = activo(e.href);
                const Icono = e.icono;
                return (
                  <li key={e.href}>
                    <Link
                      href={e.href}
                      onClick={() => setAbierto(false)}
                      aria-current={act ? "page" : undefined}
                      className="flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors"
                      style={{
                        background: act ? "var(--sidebar-activo)" : "transparent",
                        color: act
                          ? "var(--ambar)"
                          : "color-mix(in oklab, var(--sidebar-texto) 78%, transparent)",
                        fontWeight: act ? 700 : 500,
                        boxShadow: act ? "inset 3px 0 0 var(--ambar)" : "none",
                      }}
                    >
                      <Icono
                        size={15}
                        strokeWidth={1.9}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0"
                        style={{
                          color: act
                            ? "var(--ambar)"
                            : "color-mix(in oklab, var(--sidebar-texto) 55%, transparent)",
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[13px]">
                          {e.texto}
                          {e.href === "/pendientes" && pendientes ? (
                            <span
                              className="cifra rounded-full px-1.5 text-[10px] font-semibold"
                              style={{ background: "#c9564b", color: "#fff7eb" }}
                            >
                              {pendientes > 99 ? "99+" : pendientes}
                            </span>
                          ) : null}
                        </span>
                        {e.ayuda ? (
                          <span
                            className="block text-[10px] leading-tight"
                            style={{
                              color: "color-mix(in oklab, var(--sidebar-texto) 42%, transparent)",
                            }}
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

        <div className="mt-2 border-t pt-3" style={{ borderColor: "var(--sidebar-borde)" }}>
          <a
            href="/api/salir"
            className="flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors"
            style={{ color: "color-mix(in oklab, var(--sidebar-texto) 72%, transparent)" }}
          >
            <LogOut size={15} strokeWidth={1.9} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">Cerrar sesión</span>
              <span
                className="block text-[10px] leading-tight"
                style={{ color: "color-mix(in oklab, var(--sidebar-texto) 42%, transparent)" }}
              >
                Para entrar con otra cuenta de MELI
              </span>
            </span>
          </a>
        </div>
      </nav>

      {abierto ? (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          style={{ background: "rgba(0,0,0,.45)" }}
          onClick={() => setAbierto(false)}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
