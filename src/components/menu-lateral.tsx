"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Barcode,
  Boxes,
  Clapperboard,
  Container,
  Images,
  LayoutList,
  LogOut,
  Megaphone,
  PackageCheck,
  Printer,
  ReceiptText,
  RefreshCw,
  Scale,
  Settings,
  Ship,
  ShoppingCart,
  Smartphone,
  Tags,
  Truck,
  Upload,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

/**
 * Menú lateral blanco, como el del panel de vendedor de Mercado Libre:
 * secciones con etiqueta gris, entradas compactas (ícono + nombre; la
 * explicación va en el tooltip) y la activa en azul con fondo azul claro.
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
      { href: "/costos-envio", texto: "Costos de envío", icono: Scale, ayuda: "Publicaciones mal medidas que cobran de más" },
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
      { href: "/amazon/contenido", texto: "Contenido", icono: Images, ayuda: "Categorías, imágenes y A+ por modelo" },
      { href: "/amazon", texto: "Envíos a FBA", icono: PackageCheck, ayuda: "Stock FBA y qué cajas mandar" },
    ],
  },
  {
    titulo: "TikTok Shop",
    entradas: [
      { href: "/tiktok/ventas", texto: "Ventas TikTok", icono: ShoppingCart, ayuda: "Pedidos y qué hay que empacar" },
      { href: "/tiktok/despacho", texto: "Despacho", icono: Printer, ayuda: "Cortes, etiquetas y lista de empaque" },
      { href: "/tiktok", texto: "Almacén TikTok", icono: PackageCheck, ayuda: "Kardex y disponible publicado" },
      { href: "/tiktok/desfases", texto: "Desfases", icono: Scale, ayuda: "TikTok vs kardex vs Industher" },
      { href: "/tiktok/conteo", texto: "Conteo cíclico", icono: Barcode, ayuda: "Contar con escáner y ajustar el kardex" },
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
    titulo: "YAPANIZCEL · Fundas",
    entradas: [
      { href: "/yapanizcel/ventas", texto: "Ventas fundas", icono: Smartphone, ayuda: "Ventas, costos y ganancia" },
      { href: "/yapanizcel/inventario", texto: "Bodega fundas", icono: Warehouse, ayuda: "Existencias del sheet, amarradas a MELI" },
      { href: "/yapanizcel/skus", texto: "SKUs", icono: Tags, ayuda: "Amarrar bodega con Mercado Libre" },
      { href: "/yapanizcel/listados", texto: "Listados fundas", icono: LayoutList, ayuda: "Atributos de las publicaciones, por diseño" },
      { href: "/yapanizcel/envios", texto: "Envíos a Full", icono: Truck, ayuda: "Qué mandar, en decenas cerradas" },
      { href: "/yapanizcel/pedidos", texto: "Pedidos a China", icono: Ship, ayuda: "Por diseño, y lo que viene en camino" },
      { href: "/yapanizcel/ajustes", texto: "Ajustes fundas", icono: Settings, ayuda: "Conexión, costos y parámetros" },
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

export function MenuLateral({
  pendientes,
  abierto,
  cerrar,
}: {
  pendientes?: number;
  /** cajón abierto en pantallas chicas */
  abierto: boolean;
  cerrar: () => void;
}) {
  const ruta = usePathname();

  // Gana la entrada MÁS específica: /amazon/ventas no debe encender /amazon.
  const todos = GRUPOS.flatMap((g) => g.entradas.map((e) => e.href));

  const activo = (href: string) => {
    if (href === "/") return ruta === "/";
    if (!ruta.startsWith(href)) return false;
    return !todos.some((otro) => otro !== href && otro.startsWith(href) && ruta.startsWith(otro));
  };

  return (
    <>
      <nav
        aria-label="Secciones"
        className={`${
          abierto ? "translate-x-0" : "-translate-x-full"
        } fixed top-14 bottom-0 left-0 z-30 w-64 overflow-y-auto pt-3 pb-6 transition-transform duration-200 lg:sticky lg:z-0 lg:h-[calc(100vh-3.5rem)] lg:w-60 lg:shrink-0 lg:translate-x-0 lg:pt-4`}
        style={{
          background: "var(--sidebar)",
          borderRight: "1px solid var(--sidebar-borde)",
          color: "var(--sidebar-texto)",
        }}
      >
        {GRUPOS.map((g) => (
          <div key={g.titulo ?? "principal"} className="mb-3 px-3">
            {g.titulo ? (
              <div
                className="mb-1 px-2.5 pt-1 text-[11px] font-semibold"
                style={{ color: "var(--ink-muted)" }}
              >
                {g.titulo}
              </div>
            ) : null}

            <ul className="flex flex-col gap-px">
              {g.entradas.map((e) => {
                const act = activo(e.href);
                const Icono = e.icono;
                return (
                  <li key={e.href}>
                    <Link
                      href={e.href}
                      onClick={cerrar}
                      title={e.ayuda}
                      aria-current={act ? "page" : undefined}
                      className="entrada-menu flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors"
                      style={{
                        background: act ? "var(--sidebar-activo)" : "transparent",
                        color: act ? "var(--acento)" : "var(--sidebar-texto)",
                        fontWeight: act ? 600 : 500,
                        boxShadow: act ? "inset 3px 0 0 var(--acento)" : "none",
                      }}
                    >
                      <Icono
                        size={16}
                        strokeWidth={act ? 2.2 : 1.8}
                        aria-hidden="true"
                        className="shrink-0"
                        style={{ color: act ? "var(--acento)" : "var(--ink-2)" }}
                      />
                      <span className="min-w-0 flex-1 truncate">{e.texto}</span>
                      {e.href === "/pendientes" && pendientes ? (
                        <span className="insignia">{pendientes > 99 ? "99+" : pendientes}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="mx-3 mt-1 border-t pt-3 md:hidden" style={{ borderColor: "var(--sidebar-borde)" }}>
          <a
            href="/api/salir"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium"
            style={{ color: "var(--sidebar-texto)" }}
          >
            <LogOut size={16} strokeWidth={1.8} className="shrink-0" style={{ color: "var(--ink-2)" }} />
            Cerrar sesión
          </a>
        </div>
      </nav>

      {abierto ? (
        <div
          className="fixed inset-0 top-14 z-20 lg:hidden"
          style={{ background: "rgba(0,0,0,.45)" }}
          onClick={cerrar}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
