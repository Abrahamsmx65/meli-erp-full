/**
 * Piezas de pantalla comunes a TODO el ERP (rediseño del 9-oct-2026).
 *
 * Antes cada pantalla armaba a mano su título (~6 formas), sus subtítulos
 * (~10 estilos), su recuadro de aviso (25 copias del ámbar) y su «Conecta
 * Mercado Libre» (32 copias, 4 redacciones). Ahora todas usan estas piezas y
 * se ven igual:
 *
 *   <Pagina>
 *     <Encabezado ceja="Mercado Libre" titulo="Ventas" descripcion="…"
 *                 acciones={…} frescura={generadoEn}
 *                 ayuda={<p>La regla larga…</p>} />
 *     <Cifras>…<Ficha/>…</Cifras>
 *     <Seccion titulo="Por modelo" acciones={…}>…tabla…</Seccion>
 *   </Pagina>
 *
 * Reglas (9-oct-2026): sin explicaciones en pantalla. `descripcion` del
 * encabezado y `ayuda` ya no se pintan; quedan en el código como nota. Son componentes
 * de servidor: `<details>` se abre sin JavaScript.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { CejaDeRuta } from "./ceja-ruta";
import { RefrescoAlTerminar } from "./refresco-al-terminar";
import { seEstaRefrescando } from "@/lib/servicios/marca-refresco";

export function Pagina({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`pagina ${className}`}>
      {children}
      {seEstaRefrescando() ? <RefrescoAlTerminar /> : null}
    </div>
  );
}

export function Encabezado({
  titulo,
  ceja,
  cejaFija,
  descripcion,
  acciones,
  frescura,
  refrescando,
  ayuda,
  ayudaTitulo = "¿Cómo se calcula?",
}: {
  titulo: ReactNode;
  /** Respaldo de la ceja: por omisión sale de la sección del menú. */
  ceja?: string;
  /** La ceja dada manda sobre la del menú (Inicio pone la fecha). */
  cejaFija?: boolean;
  /**
   * Ya NO se pinta (dueño, 9-oct-2026: «quitar todas las explicaciones»):
   * el título y la ubicación bastan. Se queda en el código como nota.
   */
  descripcion?: ReactNode;
  /** Botones y descargas, a la derecha. */
  acciones?: ReactNode;
  /** ISO de cuándo se calcularon los datos que se enseñan. */
  frescura?: string | null;
  refrescando?: boolean;
  /** Explicación larga: plegada. */
  ayuda?: ReactNode;
  ayudaTitulo?: string;
}) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <CejaDeRuta respaldo={ceja} fija={cejaFija} />
          <h1 className="titulo-pagina">{titulo}</h1>
        </div>
        {acciones || frescura ? (
          <div className="flex flex-wrap items-center gap-2">
            {frescura ? <Frescura generadoEn={frescura} refrescando={refrescando} /> : null}
            {acciones}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/**
 * Explicación de una regla. Ya NO se pinta (dueño, 9-oct-2026: «quitar todas
 * las explicaciones»): el texto se queda en el código como documentación de
 * la regla, al lado de donde se usa.
 */
export function Ayuda(_: { titulo?: string; children: ReactNode }) {
  return null;
}

/** «Hace X min» en una sola regla para toda la app. */
export function haceCuanto(iso: string | null | undefined, ahora = Date.now()): string {
  if (!iso) return "nunca";
  const min = Math.max(0, Math.floor((ahora - Date.parse(iso)) / 60_000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
  return `hace ${Math.floor(min / 1440)} d`;
}

export function Frescura({
  generadoEn,
  refrescando,
}: {
  generadoEn?: string | null;
  refrescando?: boolean;
}) {
  if (!generadoEn) return null;
  return (
    <span
      className="frescura"
      data-refrescando={refrescando ? "true" : undefined}
      title={refrescando ? "Se está actualizando en el fondo" : "Se actualiza solo en el fondo"}
    >
      Datos {haceCuanto(generadoEn)}
    </span>
  );
}

/** Rejilla fija de fichas de cifra (2 en teléfono; 4, 5 o 6 en escritorio). */
export function Cifras({ children, columnas = 4 }: { children: ReactNode; columnas?: 3 | 4 | 5 | 6 }) {
  return (
    <div className="cifras" style={{ ["--cifras-col" as string]: columnas }}>
      {children}
    </div>
  );
}

/** Un bloque con título. Por omisión es tarjeta; `suelta` lo deja sin fondo. */
export function Seccion({
  titulo,
  descripcion,
  acciones,
  children,
  suelta,
  sinRelleno,
  id,
  ayuda,
}: {
  titulo?: ReactNode;
  descripcion?: ReactNode;
  /** Explicación de la sección, plegada bajo la cabeza. */
  ayuda?: ReactNode;
  acciones?: ReactNode;
  children: ReactNode;
  /** Sin tarjeta: para agrupar fichas o tablas que ya traen su tarjeta. */
  suelta?: boolean;
  /** Tarjeta sin relleno interior (tablas de borde a borde). */
  sinRelleno?: boolean;
  id?: string;
}) {
  const cabeza =
    titulo || acciones ? (
      <div className={suelta ? "mb-3 flex flex-wrap items-center justify-between gap-2" : "seccion-cabeza"}>
        <div className="min-w-0">
          {titulo ? <h2 className="seccion-titulo">{titulo}</h2> : null}
          {descripcion ? <p className="texto-2 mt-0.5 text-[13px]">{descripcion}</p> : null}
        </div>
        {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : null}
      </div>
    ) : null;
  // `ayuda` ya no se pinta (ver `Ayuda`).
  const plegada = null;

  if (suelta) {
    return (
      <section id={id}>
        {cabeza}
        {plegada}
        {children}
      </section>
    );
  }
  return (
    <section id={id} className="tarjeta overflow-hidden">
      {cabeza}
      {plegada}
      <div className={sinRelleno ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export type TonoAviso = "info" | "bien" | "alerta" | "critico";

const ICONO: Record<TonoAviso, string> = { info: "ℹ", bien: "✓", alerta: "▲", critico: "●" };

/** Recuadro de aviso. Cuatro tonos; siempre con ícono (el color no va solo). */
export function Aviso({
  tono = "info",
  titulo,
  children,
  className = "",
}: {
  tono?: TonoAviso;
  titulo?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`aviso aviso-${tono} ${className}`} role={tono === "critico" ? "alert" : undefined}>
      <span aria-hidden="true" className="mt-px shrink-0 text-[13px] leading-5">
        {ICONO[tono]}
      </span>
      <div className="min-w-0">
        {titulo ? <div className="font-semibold">{titulo}</div> : null}
        {children ? <div className={titulo ? "mt-0.5" : ""}>{children}</div> : null}
      </div>
    </div>
  );
}

const CONEXIONES = {
  meli: {
    titulo: "Conecta Mercado Libre",
    texto: "Esta pantalla usa los datos de tu cuenta de Mercado Libre.",
    href: "/ajustes",
    boton: "Ir a Ajustes",
  },
  amazon: {
    titulo: "Conecta Amazon",
    texto: "Esta pantalla usa los datos de tu cuenta de Seller Central.",
    href: "/ajustes",
    boton: "Ir a Ajustes",
  },
  tiktok: {
    titulo: "Conecta TikTok Shop",
    texto: "Esta pantalla usa los datos de tu tienda de TikTok.",
    href: "/ajustes",
    boton: "Ir a Ajustes",
  },
  yapanizcel: {
    titulo: "Conecta la cuenta de YAPANIZCEL",
    texto: "Es otra cuenta de Mercado Libre; se conecta una sola vez.",
    href: "/yapanizcel/ajustes",
    boton: "Ir a Ajustes de fundas",
  },
} as const;

/** «Conecta primero»: el mismo bloque en todas las pantallas. */
export function SinCuenta({
  servicio = "meli",
  titulo,
  children,
}: {
  servicio?: keyof typeof CONEXIONES;
  titulo?: string;
  /** Instrucción extra, si la conexión tiene un paso propio. */
  children?: ReactNode;
}) {
  const c = CONEXIONES[servicio];
  return (
    <Pagina>
      {titulo ? <Encabezado titulo={titulo} /> : null}
      <div className="tarjeta mx-auto w-full max-w-md p-8 text-center">
        <h2 className="titulo-seccion">{c.titulo}</h2>
        <p className="texto-2 mt-2 text-sm">{c.texto}</p>
        {children ? <div className="texto-2 mt-2 text-left text-[13px]">{children}</div> : null}
        <Link href={c.href} className="boton boton-primario mt-4">
          {c.boton}
        </Link>
      </div>
    </Pagina>
  );
}

/** Contenedor de tabla con desplazamiento y estado vacío. */
export function Tabla({
  children,
  alta,
  vacia,
  textoVacio = "No hay nada que enseñar con estos filtros.",
}: {
  children: ReactNode;
  /** Limita la altura (70 % de la pantalla) con encabezado fijo. */
  alta?: boolean;
  vacia?: boolean;
  textoVacio?: string;
}) {
  if (vacia) return <div className="vacio">{textoVacio}</div>;
  return <div className={`tabla-caja${alta ? " alta" : ""}`}>{children}</div>;
}

export function Vacio({ children }: { children: ReactNode }) {
  return <div className="vacio">{children}</div>;
}
