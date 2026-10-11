"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  House,
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
  PieChart,
  Printer,
  ReceiptText,
  RefreshCw,
  Scale,
  Settings,
  Ship,
  Stethoscope,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  LayoutGrid,
  Tags,
  Truck,
  Upload,
  Warehouse,
  ClipboardList,
  type LucideIcon,
  Undo2,
  Wallet,
  Calculator,
} from "lucide-react";
import { entradaVisible, type Rol } from "@/lib/acceso/roles";
import { Logo } from "@/components/logo";

/**
 * Menú lateral: riel crema de altura completa con el logo de GETAC arriba:
 * secciones DESPLEGABLES (se abren y cierran con un clic; se recuerda cuáles
 * quedaron abiertas), entradas compactas (ícono + nombre; la explicación va
 * en el tooltip) y la activa resaltada en arena con una raya café a la izquierda. La entrada que se
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
    titulo: null,
    entradas: [{ href: "/", texto: "Inicio", icono: House, ayuda: "Lo que pasa hoy y lo que toca hacer" }],
  },
  {
    titulo: "Negocio",
    entradas: [
      { href: "/cortes", texto: "Estado de resultados", icono: PieChart, ayuda: "Calzado + fundas + Amazon: ganancia real del mes" },
      { href: "/gastos", texto: "Gastos", icono: Wallet, ayuda: "Nómina, fletes, renta y 3PL: fijos cada mes y sueltos" },
      { href: "/finanzas/costeo", texto: "Costeo", icono: Calculator, ayuda: "Costo real por par de cada contenedor" },
    ],
  },
  {
    titulo: "Inventario",
    entradas: [
      { href: "/inventario", texto: "Existencias", icono: Warehouse, ayuda: "Cajas y existencias por SKU" },
      { href: "/productos", texto: "Catálogo y costos", icono: Tags, ayuda: "Categoría y costo por color" },
      { href: "/skus", texto: "Catálogo de SKUs", icono: Barcode, ayuda: "Catálogos de MELI, fundas y Amazon en Excel" },
    ],
  },
  {
    titulo: "Mercado Libre",
    entradas: [
      { href: "/ventas", texto: "Ventas", icono: Activity, ayuda: "En vivo y por modelo" },
      { href: "/listados", texto: "Publicaciones", icono: LayoutList, ayuda: "Variantes y atributos por agrupador" },
      { href: "/publicidad", texto: "Publicidad", icono: Megaphone, ayuda: "Costo de ads por unidad vendida" },
      { href: "/envios", texto: "Reabasto a Full", icono: Truck, ayuda: "Qué cajas mandar" },
      { href: "/costos-envio", texto: "Auditoría de envíos", icono: Scale, ayuda: "Publicaciones mal medidas que cobran de más" },
      { href: "/etiquetas", texto: "Etiquetas", icono: Barcode, ayuda: "Imprimir etiquetas" },
      { href: "/videos", texto: "Videos de producto", icono: Clapperboard, ayuda: "Videos de producto con IA" },
      { href: "/fiscal", texto: "Datos fiscales", icono: ReceiptText, ayuda: "SAT e IVA de publicaciones sin datos" },
    ],
  },
  {
    titulo: "Amazon",
    entradas: [
      { href: "/amazon/ventas", texto: "Ventas", icono: ShoppingCart, ayuda: "En vivo y por modelo" },
      { href: "/amazon/publicidad", texto: "Publicidad", icono: Megaphone, ayuda: "Costo de ads por unidad vendida" },
      { href: "/amazon/contenido", texto: "Contenido de marca", icono: Images, ayuda: "Categorías, imágenes y A+ por modelo" },
      { href: "/amazon", texto: "Reabasto a FBA", icono: PackageCheck, ayuda: "Stock FBA y qué cajas mandar" },
    ],
  },
  {
    titulo: "TikTok Shop",
    entradas: [
      { href: "/tiktok/ventas", texto: "Ventas", icono: ShoppingCart, ayuda: "Pedidos y qué hay que empacar" },
      { href: "/tiktok/despacho", texto: "Despacho de pedidos", icono: Printer, ayuda: "Cortes, etiquetas y lista de empaque" },
      { href: "/tiktok/tienda", texto: "Tienda en línea", icono: Store, ayuda: "Pedidos de la página de GETAC: mismo inventario que TikTok" },
      { href: "/tiktok/devoluciones", texto: "Devoluciones", icono: Undo2, ayuda: "Recibir lo que regresa el cliente: reembolso y si vuelve al stock" },
      { href: "/tiktok/catalogo", texto: "Catálogo para creadores", icono: LayoutGrid, ayuda: "Qué modelos se ven, su categoría y pares en bodega y en el mar" },
      { href: "/tiktok/pedidos", texto: "Reabasto de almacén", icono: ClipboardList, ayuda: "Qué reponerle a la bodega de TikTok desde Industher y EnvioPack" },
      { href: "/tiktok", texto: "Inventario TikTok", icono: PackageCheck, ayuda: "Kardex y disponible publicado" },
      { href: "/tiktok/desfases", texto: "Cuadre de inventario", icono: Scale, ayuda: "TikTok vs kardex vs Industher" },
      { href: "/tiktok/conteo", texto: "Conteo cíclico", icono: Barcode, ayuda: "Contar con escáner y ajustar el kardex" },
      { href: "/tiktok/nuevos", texto: "Publicar productos", icono: Sparkles, ayuda: "Publicar en TikTok lo que ya está en Amazon" },
      { href: "/tiktok/precios", texto: "Estrategia de precios", icono: Tags, ayuda: "El precio en TikTok que deja lo mismo que MELI, en tres niveles" },
    ],
  },
  {
    titulo: "Abastecimiento",
    entradas: [
      { href: "/pedidos", texto: "Planeación de compras", icono: Ship, ayuda: "Qué pedir y qué viene en camino" },
      { href: "/pedidos/cargar", texto: "Órdenes de compra", icono: Upload, ayuda: "Proformas, pedidos cargados y los que faltan" },
      { href: "/pedidos/nuevos", texto: "Lanzamientos", icono: Sparkles, ayuda: "Lo pedido que nunca ha tenido stock: fotos en MELI y Amazon" },
      { href: "/contenedores", texto: "Contenedores", icono: Container, ayuda: "ETA, llegada y packing list" },
      { href: "/corridas", texto: "Corridas por caja", icono: Boxes, ayuda: "Tallas por caja" },
    ],
  },
  {
    titulo: "YAPANIZCEL · Fundas",
    entradas: [
      { href: "/yapanizcel/ventas", texto: "Ventas", icono: Smartphone, ayuda: "Ventas, costos y ganancia" },
      { href: "/yapanizcel/inventario", texto: "Existencias", icono: Warehouse, ayuda: "Existencias del sheet, amarradas a MELI" },
      { href: "/yapanizcel/skus", texto: "Amarre de SKUs", icono: Tags, ayuda: "Amarrar bodega con Mercado Libre" },
      { href: "/yapanizcel/listados", texto: "Publicaciones", icono: LayoutList, ayuda: "Atributos de las publicaciones, por diseño" },
      { href: "/yapanizcel/envios", texto: "Reabasto a Full", icono: Truck, ayuda: "Qué mandar, en decenas cerradas" },
      { href: "/yapanizcel/etiquetas", texto: "Etiquetas", icono: Barcode, ayuda: "Imprimir etiquetas de Full de las fundas" },
      { href: "/yapanizcel/pedidos", texto: "Compras a China", icono: Ship, ayuda: "Por diseño, y lo que viene en camino" },
      { href: "/yapanizcel/ajustes", texto: "Configuración", icono: Settings, ayuda: "Conexión, costos y parámetros" },
    ],
  },
  {
    titulo: "Sistema",
    entradas: [
      { href: "/salud", texto: "Diagnóstico", icono: Stethoscope, ayuda: "Qué está mal o incompleto, en un solo lugar" },
      { href: "/pendientes", texto: "Pendientes", icono: AlertTriangle, ayuda: "Lo que falta resolver" },
      { href: "/importar", texto: "Importar datos", icono: Upload, ayuda: "Bodega desde Industher y corridas del sheet" },
      { href: "/sincronizar", texto: "Sincronización", icono: RefreshCw, ayuda: "Traer datos de Mercado Libre" },
      { href: "/ajustes", texto: "Configuración", icono: Settings, ayuda: "Parámetros y conexión" },
    ],
  },
];

const LLAVE_ABIERTOS = "menu-secciones-abiertas";

/** Sección y pantalla de una ruta, para la barra superior («Amazon › Contenido»). */
export function ubicacion(ruta: string, rol: Rol = "dueño"): { grupo: string; pagina: string } | null {
  const entradas = GRUPOS.flatMap((g) =>
    g.entradas.filter((e) => entradaVisible(rol, e.href)).map((e) => ({ ...e, grupo: g.titulo ?? "GETAC" })),
  );
  const candidatas = entradas.filter((e) => (e.href === "/" ? ruta === "/" : ruta === e.href || ruta.startsWith(`${e.href}/`)));
  const mejor = candidatas.sort((a, b) => b.href.length - a.href.length)[0];
  return mejor ? { grupo: mejor.grupo, pagina: mejor.texto } : null;
}

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
  rol = "dueño",
}: {
  pendientes?: number;
  /** quien solo es de TikTok ve nada más esa sección */
  rol?: Rol;
  /** cajón abierto en pantallas chicas */
  abierto: boolean;
  cerrar: () => void;
}) {
  const ruta = usePathname();
  const router = useRouter();

  // Gana la entrada MÁS específica: /amazon/ventas no debe encender /amazon.
  // Cada rol ve solo las entradas que puede abrir; un grupo sin ninguna desaparece.
  const grupos = GRUPOS.map((g) => ({ ...g, entradas: g.entradas.filter((e) => entradaVisible(rol, e.href)) })).filter((g) => g.entradas.length);
  const todos = grupos.flatMap((g) => g.entradas.map((e) => e.href));

  const activo = (href: string) => {
    if (href === "/") return ruta === "/";
    if (!ruta.startsWith(href)) return false;
    return !todos.some((otro) => otro !== href && otro.startsWith(href) && ruta.startsWith(otro));
  };

  const grupoActivo = grupos.find((g) => g.entradas.some((e) => activo(e.href)))?.titulo ?? null;

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
        } no-imprimir fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-y-auto pb-6 transition-transform duration-200 lg:sticky lg:top-0 lg:z-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:translate-x-0`}
        style={{ background: "var(--sidebar)", color: "var(--sidebar-texto)", borderRight: "1px solid var(--sidebar-borde)" }}
      >
        <div className="flex h-[72px] shrink-0 items-center px-5" style={{ borderBottom: "1px solid var(--sidebar-borde)" }}>
          <Logo alto={42} />
        </div>
        <div className="flex-1 pt-3">
        {grupos.map((g) => {
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
                  className="seccion-menu flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[10.5px] font-semibold uppercase"
                  style={{ color: contieneActivo && !desplegado ? "var(--ink-1)" : "var(--sidebar-tenue)", letterSpacing: "0.06em" }}
                >
                  <span className="flex items-center gap-1.5">
                    {g.titulo}
                    {contieneActivo && !desplegado ? (
                      <span
                        aria-hidden="true"
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--sidebar-acento)" }}
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
                        // Sin pre-carga automática: el riel deja ~50 enlaces a la
                        // vista y el navegador los pedía TODOS al abrir cualquier
                        // pantalla; el clic real esperaba detrás (9-oct-2026). Se
                        // pre-carga solo la que el cursor señala.
                        prefetch={false}
                        onMouseEnter={() => router.prefetch(e.href)}
                        onFocus={() => router.prefetch(e.href)}
                        onClick={cerrar}
                        title={e.ayuda}
                        aria-current={act ? "page" : undefined}
                        className="entrada-menu flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors"
                        style={{
                          background: act ? "var(--sidebar-activo)" : "transparent",
                          color: act ? "var(--ink-1)" : "var(--sidebar-texto)",
                          fontWeight: act ? 600 : 500,
                          boxShadow: act ? "inset 2px 0 0 var(--sidebar-acento)" : "none",
                        }}
                      >
                        <Icono
                          size={16}
                          strokeWidth={act ? 2.2 : 1.8}
                          aria-hidden="true"
                          className="shrink-0"
                          style={{ color: act ? "var(--sidebar-acento)" : "var(--sidebar-tenue)" }}
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

        </div>

        <div className="mx-3 mt-1 border-t pt-3 md:hidden" style={{ borderColor: "var(--sidebar-borde)" }}>
          <a
            href="/api/salir"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium"
            style={{ color: "var(--sidebar-texto)" }}
          >
            <LogOut size={16} strokeWidth={1.8} className="shrink-0" style={{ color: "var(--sidebar-tenue)" }} />
            Cerrar sesión
          </a>
        </div>
      </nav>

      {abierto ? (
        <div
          className="fixed inset-0 z-30 lg:hidden"
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
