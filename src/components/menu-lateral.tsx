"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  BadgePercent,
  PercentDiamond,
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
  Star,
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
  RadioTower,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { entradaVisible, type Rol } from "@/lib/acceso/roles";
import { Logo } from "@/components/logo";

/**
 * Menú lateral (rediseño del 16-nov-2026, «blanco limpio»; el ORDEN de las
 * secciones y de sus pantallas no cambia): riel blanco con el logo arriba y,
 * debajo, un BUSCADOR que filtra el menú mientras se escribe (Enter abre la
 * primera; ⌘K sigue abriendo la paleta). Luego Inicio, los FAVORITOS que el
 * usuario marque con la estrella (se recuerdan en el navegador) y las
 * secciones DESPLEGABLES (todas cerradas salvo la de la pantalla actual; lo
 * que se abre o cierra a mano se recuerda). Cada sección lleva SU ícono y
 * sus pantallas van solo con el nombre, colgadas de una línea guía: 60
 * íconos distintos eran ruido. La activa va en café sobre arena clara. La
 * entrada que se acaba de picar muestra un circulito mientras llega la
 * página.
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
  /** ícono de la sección (las entradas de adentro van solo con su nombre) */
  icono?: LucideIcon;
  entradas: Entrada[];
}

const GRUPOS: Grupo[] = [
  {
    titulo: null,
    entradas: [{ href: "/", texto: "Inicio", icono: House, ayuda: "Lo que pasa hoy y lo que toca hacer" }],
  },
  {
    titulo: "Negocio",
    icono: Landmark,
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
    icono: Warehouse,
    entradas: [
      { href: "/inventario", texto: "Existencias", icono: Warehouse, ayuda: "Cajas y existencias por SKU" },
      { href: "/productos", texto: "Catálogo y costos", icono: BookOpen, ayuda: "Categoría y costo por color" },
      { href: "/skus", texto: "Catálogo de SKUs", icono: FileSpreadsheet, ayuda: "Catálogos de MELI, fundas y Amazon en Excel" },
    ],
  },
  {
    titulo: "Mercado Libre",
    icono: Handshake,
    entradas: [
      { href: "/ventas", texto: "Ventas", icono: Activity, ayuda: "En vivo y por modelo" },
      { href: "/listados", texto: "Publicaciones", icono: LayoutList, ayuda: "Variantes y atributos por agrupador" },
      { href: "/listados/publicar", texto: "Publicar productos", icono: PackagePlus, ayuda: "Producto nuevo: título, colores, tallas y precio" },
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
    icono: ShoppingCart,
    entradas: [
      { href: "/amazon/ventas", texto: "Ventas", icono: ShoppingCart, ayuda: "En vivo y por modelo" },
      { href: "/amazon/publicidad", texto: "Publicidad", icono: Target, ayuda: "Costo de ads por unidad vendida" },
      { href: "/amazon/contenido", texto: "Contenido de marca", icono: Images, ayuda: "Categorías, imágenes y A+ por modelo" },
      { href: "/amazon", texto: "Reabasto a FBA", icono: PackageCheck, ayuda: "Stock FBA y qué cajas mandar" },
    ],
  },
  {
    titulo: "TikTok Shop",
    icono: ShoppingBag,
    entradas: [
      { href: "/tiktok/ventas", texto: "Ventas", icono: ShoppingBag, ayuda: "Pedidos y qué hay que empacar" },
      { href: "/tiktok/lives", texto: "Mis LIVE", icono: RadioTower, ayuda: "Cada LIVE propio: qué se vendió, espectadores, pedidos y ganancia" },
      { href: "/tiktok/despacho", texto: "Despacho de pedidos", icono: Printer, ayuda: "Cortes, etiquetas y lista de empaque" },
      { href: "/tiktok/tienda", texto: "Tienda en línea", icono: Store, ayuda: "Pedidos de la página de GETAC: mismo inventario que TikTok" },
      { href: "/tiktok/devoluciones", texto: "Devoluciones", icono: Undo2, ayuda: "Recibir lo que regresa el cliente: reembolso y si vuelve al stock" },
      { href: "/tiktok/externos", texto: "Productos de David", icono: Handshake, ayuda: "Lo que David vende en la tienda: su stock, sus publicaciones y sus cortes aparte" },
      { href: "/tiktok/saldos", texto: "Saldos", icono: PercentDiamond, ayuda: "Los saldos: otra bodega, su stock capturado aquí y sus cortes aparte; sus SKU empiezan con S-" },
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
    icono: Ship,
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
    icono: Smartphone,
    entradas: [
      { href: "/yapanizcel/ventas", texto: "Ventas", icono: Smartphone, ayuda: "Ventas, costos y ganancia" },
      { href: "/yapanizcel/inventario", texto: "Existencias", icono: Archive, ayuda: "Existencias del sheet, amarradas a MELI" },
      { href: "/yapanizcel/skus", texto: "Amarre de SKUs", icono: Link2, ayuda: "Amarrar bodega con Mercado Libre" },
      { href: "/yapanizcel/listados", texto: "Publicaciones", icono: Rows3, ayuda: "Atributos de las publicaciones, por diseño" },
      { href: "/yapanizcel/envios", texto: "Reabasto a Full", icono: PackagePlus, ayuda: "Qué mandar, en decenas cerradas" },
      { href: "/yapanizcel/etiquetas", texto: "Etiquetas", icono: Tag, ayuda: "Imprimir etiquetas de Full de las fundas" },
      { href: "/yapanizcel/ofertas", texto: "Ofertas", icono: BadgePercent, ayuda: "Relámpago, Buen Fin y ofertas con aporte con los precios del sheet" },
      { href: "/yapanizcel/pedidos", texto: "Compras a China", icono: Ship, ayuda: "Por diseño, y lo que viene en camino" },
      { href: "/yapanizcel/ajustes", texto: "Configuración", icono: SlidersHorizontal, ayuda: "Conexión, costos y parámetros" },
    ],
  },
  {
    titulo: "Sistema",
    icono: Settings,
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

/** Favoritos del usuario (hrefs), recordados en el navegador. */
const LLAVE_FAVORITOS = "menu-favoritos-v1";

function leerFavoritos(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(LLAVE_FAVORITOS) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function guardarFavoritos(v: string[]) {
  try {
    window.localStorage.setItem(LLAVE_FAVORITOS, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: se olvida al recargar, nada más */
  }
}

/** Minúsculas y sin acentos, para buscar «publi» y hallar «Publicación». */
function plano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Las entradas que casan con lo escrito, en el orden del menú: cada palabra
 * tiene que aparecer en el nombre, la sección o la descripción. Primero las
 * que casan por el NOMBRE.
 */
export function buscarEnMenu(consulta: string, entradas: EntradaMenu[]): EntradaMenu[] {
  const palabras = plano(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];
  const porNombre: EntradaMenu[] = [];
  const porResto: EntradaMenu[] = [];
  for (const e of entradas) {
    const nombre = plano(`${e.texto} ${e.grupo} ${e.grupoCorto}`);
    const todo = `${nombre} ${plano(e.ayuda ?? "")}`;
    if (palabras.every((p) => nombre.includes(p))) porNombre.push(e);
    else if (palabras.every((p) => todo.includes(p))) porResto.push(e);
  }
  return [...porNombre, ...porResto];
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
    icono: g.icono,
    entradas: entradas.filter((e) => e.grupo === (g.titulo ?? "GETAC")),
  })).filter((g) => g.entradas.length);

  const grupoActivo = actual && actual.grupo !== "GETAC" ? actual.grupo : null;

  // Todas las secciones nacen CERRADAS salvo la de la pantalla actual (que
  // el servidor sí conoce, así que no brinca al hidratar). Lo que el usuario
  // abre o cierra a mano se recuerda y se aplica en cuanto monta.
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [consulta, setConsulta] = useState("");
  useEffect(() => {
    setManual(leerAbiertos());
    setFavoritos(leerFavoritos());
  }, []);

  // Al navegar, el buscador se limpia: ya se llegó.
  useEffect(() => {
    setConsulta("");
  }, [ruta]);

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

  function alternarFavorito(href: string) {
    setFavoritos((prev) => {
      const v = prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href];
      guardarFavoritos(v);
      return v;
    });
  }

  const hallados = buscarEnMenu(consulta, entradas);
  const buscando = consulta.trim().length > 0;
  // En el orden en que se marcaron; uno que el rol ya no ve, no sale.
  const listaFavoritos = favoritos
    .map((h) => entradas.find((e) => e.href === h))
    .filter((e): e is EntradaMenu => Boolean(e));

  /** Un renglón del menú. `conIcono`: Inicio, favoritos y resultados de búsqueda. */
  function renglon(e: EntradaMenu, opciones: { conIcono?: boolean; nombre?: string; nota?: string } = {}) {
    const act = actual?.href === e.href;
    const Icono = e.icono;
    const esFavorito = favoritos.includes(e.href);
    const tooltip = e.completo !== e.texto ? (e.ayuda ? `${e.completo}: ${e.ayuda}` : e.completo) : e.ayuda;
    return (
      <li key={e.href} className="group/entrada relative">
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
          className={`entrada-menu flex items-center gap-2.5 rounded-md py-[6px] pr-8 text-[13px] transition-colors ${
            opciones.conIcono ? "pl-2.5" : "pl-3"
          }`}
          style={{
            background: act ? "var(--sidebar-activo)" : undefined,
            color: act ? "var(--acento-hover)" : "var(--sidebar-texto)",
            fontWeight: act ? 600 : 450,
          }}
        >
          {opciones.conIcono ? (
            <Icono
              size={16}
              strokeWidth={act ? 2.1 : 1.8}
              aria-hidden="true"
              className="shrink-0"
              style={{ color: act ? "var(--acento)" : "var(--sidebar-tenue)" }}
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate">
            {opciones.nombre ?? e.texto}
            {opciones.nota ? (
              <span className="ml-1.5 text-[11.5px] font-normal" style={{ color: "var(--sidebar-tenue)" }}>
                {opciones.nota}
              </span>
            ) : null}
          </span>
          {e.href === "/pendientes" && pendientes ? (
            <span className="insignia">{pendientes > 99 ? "99+" : pendientes}</span>
          ) : null}
          <Cargandito />
        </Link>
        {e.href !== "/" ? (
          <button
            type="button"
            onClick={() => alternarFavorito(e.href)}
            aria-pressed={esFavorito}
            aria-label={esFavorito ? `Quitar ${e.completo} de favoritos` : `Agregar ${e.completo} a favoritos`}
            title={esFavorito ? "Quitar de favoritos" : "Agregar a favoritos"}
            className={`estrella-menu absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded ${
              esFavorito ? "" : "opacity-0 group-hover/entrada:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-40"
            }`}
            style={{ color: esFavorito ? "var(--sidebar-acento)" : "var(--sidebar-tenue)" }}
          >
            <Star size={13} strokeWidth={2} aria-hidden="true" fill={esFavorito ? "currentColor" : "none"} />
          </button>
        ) : null}
      </li>
    );
  }

  return (
    <>
      <nav
        id="menu-lateral"
        aria-label="Secciones"
        className={`${
          abierto
            ? "visible translate-x-0 shadow-[0_8px_32px_rgba(28,25,23,0.18)] duration-[280ms]"
            : "invisible -translate-x-full duration-200"
        } no-imprimir fixed inset-y-0 left-0 z-40 flex w-[17rem] max-w-[85vw] flex-col transition-[transform,visibility] ease-[var(--ease-drawer,cubic-bezier(0.32,0.72,0,1))] motion-reduce:transition-none lg:visible lg:sticky lg:top-0 lg:z-0 lg:h-dvh lg:w-[15.5rem] lg:shrink-0 lg:translate-x-0 lg:shadow-none`}
        style={{ background: "var(--sidebar)", color: "var(--sidebar-texto)", borderRight: "1px solid var(--sidebar-borde)" }}
      >
        <div className="flex h-16 shrink-0 items-center px-5">
          <Logo alto={38} />
        </div>

        {/* Buscador: filtra el menú mientras se escribe. */}
        <div className="shrink-0 px-3 pb-2">
          <div className="relative">
            <Search
              size={15}
              strokeWidth={2}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
              style={{ color: "var(--sidebar-tenue)" }}
            />
            <input
              type="search"
              value={consulta}
              onChange={(ev) => setConsulta(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && hallados[0]) {
                  ev.preventDefault();
                  cerrar();
                  router.push(hallados[0].href);
                } else if (ev.key === "Escape") {
                  setConsulta("");
                }
              }}
              placeholder="Buscar pantalla…"
              aria-label="Buscar pantalla"
              aria-controls="menu-resultados"
              autoComplete="off"
              spellCheck={false}
              className="buscador-menu w-full"
            />
            {!buscando ? (
              <kbd
                className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border px-1.5 py-px font-sans text-[11px] font-medium lg:inline"
                style={{ borderColor: "var(--sidebar-borde)", color: "var(--sidebar-tenue)", background: "var(--surface-1)" }}
              >
                {atajo}
              </kbd>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-1 pb-3">
          {buscando ? (
            <div id="menu-resultados" aria-live="polite">
              {hallados.length ? (
                <ul className="flex flex-col gap-px">
                  {hallados.map((e) => renglon(e, { conIcono: true, nota: e.grupo === "GETAC" ? undefined : e.grupoCorto }))}
                </ul>
              ) : (
                <p className="px-2.5 py-3 text-[13px]" style={{ color: "var(--sidebar-tenue)" }}>
                  Ninguna pantalla con «{consulta.trim()}».
                </p>
              )}
            </div>
          ) : (
            <>
              {grupos.map((g, i) => {
                const titulo = g.titulo ?? "principal";
                const desplegado = g.titulo ? estaAbierto(titulo) : true;
                const contieneActivo = titulo === grupoActivo;
                const idLista = `menu-${titulo.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
                const IconoGrupo = g.icono;
                return (
                  <div key={titulo} className="mb-0.5">
                    {g.titulo ? (
                      <button
                        type="button"
                        onClick={() => alternar(titulo)}
                        aria-expanded={desplegado}
                        aria-controls={idLista}
                        className="seccion-menu flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-[13px] font-semibold"
                        style={{ color: contieneActivo ? "var(--ink-1)" : "var(--sidebar-texto)" }}
                      >
                        {IconoGrupo ? (
                          <IconoGrupo
                            size={16}
                            strokeWidth={contieneActivo ? 2.1 : 1.8}
                            aria-hidden="true"
                            className="shrink-0"
                            style={{ color: contieneActivo ? "var(--acento)" : "var(--sidebar-tenue)" }}
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{g.titulo}</span>
                        <ChevronDown
                          size={14}
                          strokeWidth={2}
                          aria-hidden="true"
                          className="shrink-0 transition-transform duration-200 ease-[var(--ease-out,cubic-bezier(0.23,1,0.32,1))] motion-reduce:transition-none"
                          style={{ transform: desplegado ? "rotate(0deg)" : "rotate(-90deg)", color: "var(--sidebar-tenue)" }}
                        />
                      </button>
                    ) : null}

                    <ul
                      id={idLista}
                      hidden={!desplegado}
                      className={g.titulo ? "lista-menu mt-px mb-1.5 flex flex-col gap-px" : "flex flex-col gap-px pb-1"}
                    >
                      {g.entradas.map((e) => renglon(e, { conIcono: !g.titulo }))}
                    </ul>

                    {/* Favoritos: justo debajo de Inicio, solo si hay alguno. */}
                    {i === 0 && !g.titulo && listaFavoritos.length ? (
                      <div className="mt-1 mb-2 pb-2" style={{ borderBottom: "1px solid var(--sidebar-borde)" }}>
                        <div className="px-2.5 pt-1 pb-1 text-[11px] font-semibold" style={{ color: "var(--sidebar-tenue)" }}>
                          Favoritos
                        </div>
                        <ul className="flex flex-col gap-px">
                          {listaFavoritos.map((e) => renglon(e, { conIcono: true, nombre: e.completo }))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Pie del riel: salir. */}
        <div className="shrink-0 px-3 pt-2 pb-3" style={{ borderTop: "1px solid var(--sidebar-borde)" }}>
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
        style={{ background: "rgba(28,25,23,.4)" }}
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
