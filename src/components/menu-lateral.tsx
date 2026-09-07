"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Barcode,
  Boxes,
  ChevronDown,
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
  Sparkles,
  Tags,
  Truck,
  Upload,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

/**
 * Menú lateral blanco, como el del panel de vendedor de Mercado Libre:
 * secciones DESPLEGABLES (se abren y cierran con un clic; se recuerda cuáles
 * quedaron abiertas), entradas compactas (ícono + nombre; la explicación va
 * en el tooltip) y la activa en azul con fondo azul claro. La entrada que se
 * acaba de picar muestra un circulito mientras llega la página.
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
      { href: "/pedidos/cargar", texto: "Cargar pedidos", icono: Upload, ayuda: "Proformas, pedidos cargados y los que faltan" },
      { href: "/pedidos/nuevos", texto: "Productos nuevos", icono: Sparkles, ayuda: "Lo pedido que nunca ha tenido stock: fotos en MELI y Amazon" },
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

const LLAVE_ABIERTOS = "menu-secciones-abiertas";

/** Qué secciones están abiertas, recordado en el navegador. */
function leerAbiertos(): Record<string, boolean> | null {
  try {
    const raw = window.localStorage.getItem(LLAVE_ABIERTOS);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : null;
  } catch {
    return null;
  }
}

function guardarAbiertos(v: Record<string, boolean>) {
  try {
    window.localStorage.setItem(LLAVE_ABIERTOS, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: se olvida al recargar, nada más */
  }
}

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

  const grupoActivo = GRUPOS.find((g) => g.entradas.some((e) => activo(e.href)))?.titulo ?? null;

  // Al arrancar, todas abiertas (el servidor no sabe qué recordó el
  // navegador); en cuanto monta se aplica lo recordado. La sección de la
  // página actual siempre queda abierta, para que se vea dónde estás.
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [listo, setListo] = useState(false);
  useEffect(() => {
    const guardado = leerAbiertos();
    setAbiertos((prev) => ({ ...(guardado ?? prev) }));
    setListo(true);
  }, []);
  useEffect(() => {
    if (!listo || !grupoActivo) return;
    setAbiertos((prev) => {
      if (prev[grupoActivo] !== false) return prev;
      const v = { ...prev, [grupoActivo]: true };
      guardarAbiertos(v);
      return v;
    });
  }, [listo, grupoActivo]);

  const estaAbierto = (titulo: string) => !listo || abiertos[titulo] !== false;

  function alternar(titulo: string) {
    setAbiertos((prev) => {
      const v = { ...prev, [titulo]: !estaAbierto(titulo) };
      guardarAbiertos(v);
      return v;
    });
  }

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
        {GRUPOS.map((g) => {
          const titulo = g.titulo ?? "principal";
          const desplegado = estaAbierto(titulo);
          const contieneActivo = titulo === grupoActivo;
          const idLista = `menu-${titulo.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
          return (
            <div key={titulo} className="mb-1 px-3">
              {g.titulo ? (
                <button
                  type="button"
                  onClick={() => alternar(titulo)}
                  aria-expanded={desplegado}
                  aria-controls={idLista}
                  className="seccion-menu flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[11px] font-semibold"
                  style={{ color: contieneActivo && !desplegado ? "var(--acento)" : "var(--ink-muted)" }}
                >
                  <span className="flex items-center gap-1.5">
                    {g.titulo}
                    {contieneActivo && !desplegado ? (
                      <span
                        aria-hidden="true"
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--acento)" }}
                      />
                    ) : null}
                  </span>
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    aria-hidden="true"
                    className="transition-transform duration-200"
                    style={{ transform: desplegado ? "rotate(0deg)" : "rotate(-90deg)" }}
                  />
                </button>
              ) : null}

              <ul
                id={idLista}
                hidden={!desplegado}
                className="flex flex-col gap-px pb-2"
              >
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
                        <Cargandito />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

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

/**
 * Circulito en la entrada que se acaba de picar, mientras el servidor arma
 * la página. Va DENTRO del Link: `useLinkStatus` solo sabe del Link que lo
 * envuelve.
 */
function Cargandito() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="girando shrink-0 text-[14px]" aria-label="Cargando" role="status" />;
}
