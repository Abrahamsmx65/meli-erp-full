"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  BadgePercent,
  Barcode,
  BookOpen,
  Boxes,
  Calculator,
  CalendarRange,
  ChevronDown,
  CircleDollarSign,
  Clapperboard,
  ClipboardList,
  CloudUpload,
  Container,
  FilePlus2,
  Files,
  FileSpreadsheet,
  Handshake,
  Hourglass,
  House,
  Images,
  Landmark,
  LayoutGrid,
  LayoutList,
  Link2,
  LogOut,
  Megaphone,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  PartyPopper,
  PieChart,
  Printer,
  ReceiptText,
  RefreshCw,
  Rocket,
  Rows3,
  Ruler,
  Scale,
  ScanBarcode,
  Search,
  Settings,
  Ship,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Stethoscope,
  Store,
  Tag,
  Tags,
  Target,
  Truck,
  Undo2,
  Upload,
  Wallet,
  Warehouse,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { entradaVisible, type Rol } from "@/lib/acceso/roles";
import { Logo } from "@/components/logo";

/**
 * Menú lateral: riel crema de altura completa con el logo de GETAC arriba:
 * secciones DESPLEGABLES (todas cerradas salvo la de la pantalla actual; lo
 * que se abre o cierra a mano se recuerda), entradas compactas (ícono ÚNICO
 * + nombre corto; el nombre con su sección y la explicación van en el
 * tooltip), al pie Buscar (⌘K) y Cerrar sesión, y la activa resaltada en
 * arena con una raya café a la izquierda. La entrada que se acaba de picar
 * muestra un circulito mientras llega la página.
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
      { href: "/cortes/anio", texto: "Año del negocio", icono: CalendarRange, ayuda: "Mayo a abril: el estado de resultados del año, mes por mes y en total" },
      { href: "/cortes/wrapped", texto: "GETAC Wrapped", icono: PartyPopper, ayuda: "Tu año del negocio en tarjetas, como el Wrapped de Spotify" },
      { href: "/gastos", texto: "Gastos", icono: Wallet, ayuda: "Nómina, fletes, renta y 3PL: fijos cada mes y sueltos" },
      { href: "/finanzas/costeo", texto: "Costeo", icono: Calculator, ayuda: "Costo real por par de cada contenedor" },
      { href: "/finanzas/numeros", texto: "Números", icono: CircleDollarSign, ayuda: "Precios por modelo en MELI, Amazon y TikTok" },
      { href: "/finanzas/calculadora", texto: "Calculadora fiscal", icono: Scale, ayuda: "Precio de compra entre Industher y Komerline, por producto y por contenedor" },
      { href: "/finanzas/cuenta", texto: "Cuenta del año", icono: Landmark, ayuda: "Mayo a abril: transferencias, contenedores, Joanne, Shein y socios" },
    ],
  },
  {
    titulo: "Inventario",
    entradas: [
      { href: "/inventario", texto: "Existencias", icono: Warehouse, ayuda: "Cajas y existencias por SKU" },
      { href: "/productos", texto: "Catálogo y costos", icono: BookOpen, ayuda: "Categoría y costo por color" },
      { href: "/skus", texto: "Catálogo de SKUs", icono: FileSpreadsheet, ayuda: "Catálogos de MELI, fundas y Amazon en Excel" },
    ],
  },
  {
    titulo: "Mercado Libre",
    entradas: [
      { href: "/ventas", texto: "Ventas", icono: Activity, ayuda: "En vivo y por modelo" },
      { href: "/listados", texto: "Publicaciones", icono: LayoutList, ayuda: "Variantes y atributos por agrupador" },
      { href: "/publicidad", texto: "Publicidad", icono: Megaphone, ayuda: "Costo de ads por unidad vendida" },
      { href: "/ventas/ofertas", texto: "Ofertas MELI", icono: BadgePercent, ayuda: "Ofertas con aporte de MELI que cumplen el PV normal de Números" },
      { href: "/envios", texto: "Reabasto a Full", icono: Truck, ayuda: "Qué cajas mandar" },
      { href: "/costos-envio", texto: "Auditoría de envíos", icono: Ruler, ayuda: "Publicaciones mal medidas que cobran de más" },
      { href: "/etiquetas", texto: "Etiquetas", icono: Barcode, ayuda: "Imprimir etiquetas" },
      { href: "/videos", texto: "Videos de producto", icono: Clapperboard, ayuda: "Videos de producto con IA" },
      { href: "/fiscal", texto: "Datos fiscales", icono: ReceiptText, ayuda: "SAT e IVA de publicaciones sin datos" },
    ],
  },
  {
    titulo: "Amazon",
    entradas: [
      { href: "/amazon/ventas", texto: "Ventas", icono: ShoppingCart, ayuda: "En vivo y por modelo" },
      { href: "/amazon/publicidad", texto: "Publicidad", icono: Target, ayuda: "Costo de ads por unidad vendida" },
      { href: "/amazon/contenido", texto: "Contenido de marca", icono: Images, ayuda: "Categorías, imágenes y A+ por modelo" },
      { href: "/amazon", texto: "Reabasto a FBA", icono: PackageCheck, ayuda: "Stock FBA y qué cajas mandar" },
    ],
  },
  {
    titulo: "TikTok Shop",
    entradas: [
      { href: "/tiktok/ventas", texto: "Ventas", icono: ShoppingBag, ayuda: "Pedidos y qué hay que empacar" },
      { href: "/tiktok/despacho", texto: "Despacho de pedidos", icono: Printer, ayuda: "Cortes, etiquetas y lista de empaque" },
      { href: "/tiktok/tienda", texto: "Tienda en línea", icono: Store, ayuda: "Pedidos de la página de GETAC: mismo inventario que TikTok" },
      { href: "/tiktok/devoluciones", texto: "Devoluciones", icono: Undo2, ayuda: "Recibir lo que regresa el cliente: reembolso y si vuelve al stock" },
      { href: "/tiktok/externos", texto: "Productos de David", icono: Handshake, ayuda: "Lo que David vende en la tienda: su stock, sus publicaciones y sus cortes aparte" },
      { href: "/tiktok/promociones", texto: "Ofertas relámpago", icono: Zap, ayuda: "Crear la relámpago de 3 días con los precios de la estrategia y ver las que TikTok tiene" },
      { href: "/tiktok/catalogo", texto: "Catálogo para creadores", icono: LayoutGrid, ayuda: "Qué modelos se ven, su categoría y pares en bodega y en el mar" },
      { href: "/tiktok/pedidos", texto: "Reabasto de almacén", icono: ClipboardList, ayuda: "Qué reponerle a la bodega de TikTok desde Industher y EnvioPack" },
      { href: "/tiktok", texto: "Inventario TikTok", icono: PackageOpen, ayuda: "Kardex y disponible publicado" },
      { href: "/tiktok/desfases", texto: "Cuadre de inventario", icono: Scale, ayuda: "TikTok vs kardex vs Industher" },
      { href: "/tiktok/conteo", texto: "Conteo cíclico", icono: ScanBarcode, ayuda: "Contar con escáner y ajustar el kardex" },
      { href: "/tiktok/nuevos", texto: "Publicar productos", icono: CloudUpload, ayuda: "Publicar en TikTok lo que ya está en Amazon" },
      { href: "/tiktok/precios", texto: "Estrategia de precios", icono: Tags, ayuda: "El precio en TikTok que deja lo mismo que MELI, en tres niveles" },
    ],
  },
  {
    titulo: "Abastecimiento",
    entradas: [
      { href: "/pedidos", texto: "Planeación de compras", icono: ShoppingBasket, ayuda: "Qué pedir y qué viene en camino" },
      { href: "/pedidos/nuevo", texto: "Nuevo pedido", icono: FilePlus2, ayuda: "Pega la lista, revisa el borrador y se manda a la fábrica en su formato" },
      { href: "/pedidos/pendientes", texto: "Pendientes por enviar", icono: Hourglass, ayuda: "Lo pedido que aún no está en un contenedor: dinero y CBM" },
      { href: "/pedidos/cargar", texto: "Órdenes de compra", icono: Files, ayuda: "Proformas, pedidos cargados y los que faltan" },
      { href: "/pedidos/nuevos", texto: "Lanzamientos", icono: Rocket, ayuda: "Lo pedido que nunca ha tenido stock: fotos en MELI y Amazon" },
      { href: "/contenedores", texto: "Contenedores", icono: Container, ayuda: "ETA, llegada y packing list" },
      { href: "/corridas", texto: "Corridas por caja", icono: Boxes, ayuda: "Tallas por caja" },
    ],
  },
  {
    titulo: "YAPANIZCEL · Fundas",
    entradas: [
      { href: "/yapanizcel/ventas", texto: "Ventas", icono: Smartphone, ayuda: "Ventas, costos y ganancia" },
      { href: "/yapanizcel/inventario", texto: "Existencias", icono: Archive, ayuda: "Existencias del sheet, amarradas a MELI" },
      { href: "/yapanizcel/skus", texto: "Amarre de SKUs", icono: Link2, ayuda: "Amarrar bodega con Mercado Libre" },
      { href: "/yapanizcel/listados", texto: "Publicaciones", icono: Rows3, ayuda: "Atributos de las publicaciones, por diseño" },
      { href: "/yapanizcel/envios", texto: "Reabasto a Full", icono: PackagePlus, ayuda: "Qué mandar, en decenas cerradas" },
      { href: "/yapanizcel/etiquetas", texto: "Etiquetas", icono: Tag, ayuda: "Imprimir etiquetas de Full de las fundas" },
      { href: "/yapanizcel/pedidos", texto: "Compras a China", icono: Ship, ayuda: "Por diseño, y lo que viene en camino" },
      { href: "/yapanizcel/ajustes", texto: "Configuración", icono: SlidersHorizontal, ayuda: "Conexión, costos y parámetros" },
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

// Llave nueva (19-oct-2026): con la v1 todas las secciones nacían abiertas y
// lo guardado ahí ya no significa lo mismo.
const LLAVE_ABIERTOS = "menu-secciones-v2";

/**
 * Nombre corto de la sección para cuando la entrada sale FUERA de su grupo
 * (la paleta ⌘K, el tooltip): «Ventas · Amazon», «Configuración · Fundas».
 */
const GRUPO_CORTO: Record<string, string> = {
  "Mercado Libre": "MELI",
  "TikTok Shop": "TikTok",
  "YAPANIZCEL · Fundas": "Fundas",
};

/** Los nombres que se repiten en el menú: dentro del grupo basta el corto. */
const REPETIDOS = (() => {
  const cuenta = new Map<string, number>();
  for (const g of GRUPOS) for (const e of g.entradas) cuenta.set(e.texto, (cuenta.get(e.texto) ?? 0) + 1);
  return new Set([...cuenta].filter(([, n]) => n > 1).map(([t]) => t));
})();

export interface EntradaMenu {
  href: string;
  texto: string;
  /** «Ventas · Amazon» si el nombre se repite en otra sección; si no, el texto */
  completo: string;
  /** sección del menú tal cual («Mercado Libre»); «GETAC» para Inicio */
  grupo: string;
  grupoCorto: string;
  icono: LucideIcon;
  ayuda?: string;
}

/** Todas las entradas que ve un rol, en el orden del menú (la paleta las usa). */
export function entradasDelMenu(rol: Rol = "dueño"): EntradaMenu[] {
  return GRUPOS.flatMap((g) => {
    const grupo = g.titulo ?? "GETAC";
    const grupoCorto = GRUPO_CORTO[grupo] ?? grupo;
    return g.entradas
      .filter((e) => entradaVisible(rol, e.href))
      .map((e) => ({
        href: e.href,
        texto: e.texto,
        completo: REPETIDOS.has(e.texto) ? `${e.texto} · ${grupoCorto}` : e.texto,
        grupo,
        grupoCorto,
        icono: e.icono,
        ayuda: e.ayuda,
      }));
  });
}

/** La entrada más específica que corresponde a una ruta (/amazon/ventas no enciende /amazon). */
export function entradaDeRuta<T extends { href: string }>(ruta: string, entradas: T[]): T | null {
  const candidatas = entradas.filter((e) => (e.href === "/" ? ruta === "/" : ruta === e.href || ruta.startsWith(`${e.href}/`)));
  return candidatas.sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

/** Sección y pantalla de una ruta («Amazon › Contenido»); la ceja de cada pantalla sale de aquí. */
export function ubicacion(ruta: string, rol: Rol = "dueño"): { grupo: string; pagina: string } | null {
  const mejor = entradaDeRuta(ruta, entradasDelMenu(rol));
  return mejor ? { grupo: mejor.grupo, pagina: mejor.texto } : null;
}

/** Qué secciones abrió o cerró el usuario a mano, recordado en el navegador. */
function leerAbiertos(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(LLAVE_ABIERTOS);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function guardarAbiertos(v: Record<string, boolean>) {
  try {
    window.localStorage.setItem(LLAVE_ABIERTOS, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: se olvida al recargar, nada más */
  }
}

/** Abre la paleta de búsqueda (⌘K) desde cualquier botón. */
export function abrirPaleta() {
  window.dispatchEvent(new Event("getac:abrir-paleta"));
}

/** «⌘K» en Mac, «Ctrl K» en lo demás; se decide ya montado (el servidor no sabe). */
export function useAtajoPaleta(): string {
  const [atajo, setAtajo] = useState("Ctrl K");
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
    if (mac) setAtajo("⌘K");
  }, []);
  return atajo;
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
  const atajo = useAtajoPaleta();

  // Gana la entrada MÁS específica: /amazon/ventas no debe encender /amazon.
  // Cada rol ve solo las entradas que puede abrir; un grupo sin ninguna desaparece.
  const entradas = entradasDelMenu(rol);
  const actual = entradaDeRuta(ruta, entradas);
  const grupos = GRUPOS.map((g) => ({
    titulo: g.titulo,
    entradas: entradas.filter((e) => e.grupo === (g.titulo ?? "GETAC")),
  })).filter((g) => g.entradas.length);

  const grupoActivo = actual && actual.grupo !== "GETAC" ? actual.grupo : null;

  // Todas las secciones nacen CERRADAS salvo la de la pantalla actual (que
  // el servidor sí conoce, así que no brinca al hidratar). Lo que el usuario
  // abre o cierra a mano se recuerda y se aplica en cuanto monta.
  const [manual, setManual] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setManual(leerAbiertos());
  }, []);

  // Al llegar a una sección que se había cerrado a mano, se vuelve a abrir:
  // siempre se ve dónde estás.
  useEffect(() => {
    if (!grupoActivo) return;
    setManual((prev) => {
      if (prev[grupoActivo] !== false) return prev;
      const v = { ...prev };
      delete v[grupoActivo];
      guardarAbiertos(v);
      return v;
    });
  }, [grupoActivo]);

  const estaAbierto = (titulo: string) => manual[titulo] ?? titulo === grupoActivo;

  function alternar(titulo: string) {
    setManual((prev) => {
      const v = { ...prev, [titulo]: !(prev[titulo] ?? titulo === grupoActivo) };
      guardarAbiertos(v);
      return v;
    });
  }

  return (
    <>
      <nav
        id="menu-lateral"
        aria-label="Secciones"
        className={`${
          abierto
            ? "visible translate-x-0 shadow-[0_8px_32px_rgba(42,32,25,0.18)] duration-[280ms]"
            : "invisible -translate-x-full duration-200"
        } no-imprimir fixed inset-y-0 left-0 z-40 flex w-[17rem] max-w-[85vw] flex-col transition-[transform,visibility] ease-[var(--ease-drawer,cubic-bezier(0.32,0.72,0,1))] motion-reduce:transition-none lg:visible lg:sticky lg:top-0 lg:z-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:translate-x-0 lg:shadow-none`}
        style={{ background: "var(--sidebar)", color: "var(--sidebar-texto)", borderRight: "1px solid var(--sidebar-borde)" }}
      >
        <div className="flex h-[72px] shrink-0 items-center px-5" style={{ borderBottom: "1px solid var(--sidebar-borde)" }}>
          <Logo alto={42} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 pb-3">
          {grupos.map((g) => {
            const titulo = g.titulo ?? "principal";
            const desplegado = g.titulo ? estaAbierto(titulo) : true;
            const contieneActivo = titulo === grupoActivo;
            const idLista = `menu-${titulo.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
            return (
              <div key={titulo} className="mb-0.5 px-3">
                {g.titulo ? (
                  <button
                    type="button"
                    onClick={() => alternar(titulo)}
                    aria-expanded={desplegado}
                    aria-controls={idLista}
                    className="seccion-menu flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[11px] font-semibold uppercase"
                    style={{ color: contieneActivo ? "var(--ink-1)" : "var(--ink-2)", letterSpacing: "0.07em" }}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{g.titulo}</span>
                      {contieneActivo && !desplegado ? (
                        <span
                          aria-hidden="true"
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: "var(--sidebar-acento)" }}
                        />
                      ) : null}
                    </span>
                    <ChevronDown
                      size={14}
                      strokeWidth={2}
                      aria-hidden="true"
                      className="shrink-0 transition-transform duration-200 ease-[var(--ease-out,cubic-bezier(0.23,1,0.32,1))] motion-reduce:transition-none"
                      style={{ transform: desplegado ? "rotate(0deg)" : "rotate(-90deg)", color: "var(--sidebar-tenue)" }}
                    />
                  </button>
                ) : null}

                <ul id={idLista} hidden={!desplegado} className="flex flex-col gap-px pb-2">
                  {g.entradas.map((e) => {
                    const act = actual?.href === e.href;
                    const Icono = e.icono;
                    const tooltip = e.completo !== e.texto ? (e.ayuda ? `${e.completo}: ${e.ayuda}` : e.completo) : e.ayuda;
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
                          title={tooltip}
                          aria-label={e.completo !== e.texto ? e.completo : undefined}
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

        {/* Pie del riel: buscar (⌘K) y salir. Antes vivían en una barra blanca
            arriba que solo repetía la ceja de la pantalla (19-oct-2026). */}
        <div className="shrink-0 px-3 pt-2 pb-3" style={{ borderTop: "1px solid var(--sidebar-borde)" }}>
          <button
            type="button"
            onClick={() => {
              cerrar();
              abrirPaleta();
            }}
            className="entrada-menu flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-[13px] font-medium"
            style={{ color: "var(--sidebar-texto)" }}
          >
            <Search size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0" style={{ color: "var(--sidebar-tenue)" }} />
            <span className="flex-1">Buscar</span>
            <kbd
              className="hidden rounded border px-1.5 py-px font-sans text-[11px] font-medium lg:inline"
              style={{ borderColor: "var(--sidebar-borde)", color: "var(--ink-2)", background: "var(--surface-1)" }}
            >
              {atajo}
            </kbd>
          </button>
          <a
            href="/api/salir"
            className="entrada-menu flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium"
            style={{ color: "var(--sidebar-texto)" }}
          >
            <LogOut size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0" style={{ color: "var(--sidebar-tenue)" }} />
            Cerrar sesión
          </a>
        </div>
      </nav>

      {/* Velo del cajón: siempre montado para que entre y salga con fundido. */}
      <div
        className={`${
          abierto ? "opacity-100" : "pointer-events-none opacity-0"
        } no-imprimir fixed inset-0 z-30 transition-opacity duration-200 ease-[var(--ease-out,cubic-bezier(0.23,1,0.32,1))] motion-reduce:transition-none lg:hidden`}
        style={{ background: "rgba(42,32,25,.4)" }}
        onClick={cerrar}
        aria-hidden="true"
      />
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
