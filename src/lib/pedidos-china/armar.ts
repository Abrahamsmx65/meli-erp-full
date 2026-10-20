/**
 * Arma el BORRADOR de un modelo a partir de la lista del dueño y de la
 * historia de pedidos (motor puro, con pruebas en `armar.test.ts`).
 *
 * Lo que la lista no dice sale del último pedido del modelo:
 *   - la FÁBRICA (cada modelo siempre se ha pedido a la misma; el 11-oct-2026
 *     los 13 modelos repetidos tenían una sola fábrica cada uno),
 *   - la MONEDA (la de esa fábrica),
 *   - el PRECIO por color y talla, SOLO de pedidos a esa misma fábrica
 *     (dueño: «el precio es diferente con cada fábrica»): mismo color y
 *     talla → mismo color → cualquier color de esa talla → el modelo,
 *   - los PARES POR CAJA que no se escribieron, la corrida «misma», la
 *     descripción y las MEDIDAS de la caja (del packing list de un
 *     contenedor anterior con cajas del mismo número de pares).
 *
 * Un modelo NUEVO (sin historia) queda con lo que falta en null y avisado:
 * fábrica, precio y descripción se capturan en el borrador. Nada se estima.
 */
import type { Moneda } from "../importar/proforma";
import { canonizar } from "../importar/sku";
import type { RenglonPI } from "./excel";
import { perfilDeClave, perfilDeProveedor, type PerfilFabrica } from "./fabricas";
import type { ModeloLista } from "./lista";

/** Un renglón de un pedido anterior del modelo. */
export interface LineaHistoria {
  pedido: string;
  proveedor: string | null;
  moneda: Moneda | null;
  modelo: string;
  color: string;
  /** "" = caja de corrida */
  talla: string;
  /** corrida: pares por talla en una caja; unitalla: pares TOTALES de la talla */
  tallas: Record<string, number>;
  paresPorCaja: number;
  precio: number | null;
  preciosTalla: Record<string, number> | null;
  descripcion: string | null;
  medidas: { largoCm: number; anchoCm: number; altoCm: number } | null;
  cbmCaja: number | null;
}

/** Un renglón del borrador: lo que va a ir en el Excel, sin modelo ni descripción. */
export interface LineaBorrador extends Omit<RenglonPI, "modelo" | "descripcion"> {
  /** de qué pedido salió el precio (o null si se capturó / falta) */
  precioDe: string | null;
  /**
   * Solo en un borrador de FAMILIA (varios modelos que se piden juntos,
   * GT117…GT122): el modelo real del renglón. En un borrador de un solo
   * modelo no viene y manda el modelo del borrador.
   */
  modelo?: string | null;
}

export interface BorradorArmado {
  modelo: string;
  fabrica: string | null;
  proveedor: string | null;
  moneda: Moneda | null;
  descripcion: string;
  lineas: LineaBorrador[];
  /** el modelo nunca se ha pedido */
  nuevo: boolean;
  avisos: string[];
}

/** Colores que la fábrica y el dueño escriben distinto y son el mismo. */
const SINONIMOS: string[][] = [
  ["BLK", "BLACK", "NEGRO"],
  ["WHT", "WHITE", "BLANCO"],
  ["BRN", "BROWN", "CAFE"],
  ["DK BROWN", "DARK BROWN", "DKBROWN", "DK.BROWN"],
  ["LT BROWN", "LIGHT BROWN", "LTBROWN"],
  ["M BROWN", "MEDIUM BROWN", "MBROWN"],
  ["GRY", "GREY", "GRAY", "GRIS"],
  ["NVY", "NAVY", "AZUL MARINO"],
  ["BEIGE", "BEIGUE"],
  ["CREAM", "CREMA"],
  ["PINK", "ROSA"],
  ["RED", "ROJO"],
  ["KHAKI", "KAKI"],
  ["TOFFEE", "TOFFE"],
];

function claveColor(c: string): string {
  return canonizar(c).replace(/-/g, "");
}

const SINONIMO = new Map<string, number>();
SINONIMOS.forEach((g, i) => g.forEach((c) => SINONIMO.set(claveColor(c), i)));

export function mismoColor(a: string, b: string): boolean {
  const ka = claveColor(a);
  const kb = claveColor(b);
  if (ka === kb) return true;
  const ga = SINONIMO.get(ka);
  return ga != null && ga === SINONIMO.get(kb);
}

function clavePerfil(p: PerfilFabrica | null): string | null {
  return p?.clave ?? null;
}

function porPedidoDesc(a: LineaHistoria, b: LineaHistoria): number {
  return b.pedido.localeCompare(a.pedido, "en", { numeric: true });
}

function precioEnLinea(l: LineaHistoria, talla: string | null): number | null {
  if (talla && l.preciosTalla?.[talla] != null) return l.preciosTalla[talla];
  return l.precio;
}

function tieneTalla(l: LineaHistoria, talla: string): boolean {
  return l.talla ? l.talla === talla : (l.tallas[talla] ?? 0) > 0;
}

/** Precio de un par de ese color y talla en la historia de ESA fábrica. */
export function precioDeHistoria(
  hist: LineaHistoria[],
  color: string,
  talla: string,
): { precio: number; pedido: string } | null {
  const conPrecio = hist.filter((l) => precioEnLinea(l, talla) != null);
  const pasos: ((l: LineaHistoria) => boolean)[] = [
    (l) => mismoColor(l.color, color) && tieneTalla(l, talla),
    (l) => mismoColor(l.color, color),
    (l) => tieneTalla(l, talla),
    () => true,
  ];
  for (const paso of pasos) {
    const l = conPrecio.find(paso);
    if (l) return { precio: precioEnLinea(l, tieneTalla(l, talla) ? talla : null)!, pedido: l.pedido };
  }
  return null;
}

/**
 * @param fabricaElegida clave del perfil si el dueño cambió la fábrica en
 *   el borrador (los precios de otra fábrica ya no sirven).
 */
export function armarBorrador(lista: ModeloLista, historiaTodo: LineaHistoria[], fabricaElegida?: string | null): BorradorArmado {
  const avisos = [...lista.avisos];
  const modeloC = canonizar(lista.modelo);
  const historia = historiaTodo.filter((l) => canonizar(l.modelo) === modeloC).sort(porPedidoDesc);
  const nuevo = historia.length === 0;

  const ultima = historia[0];
  const perfil = fabricaElegida ? perfilDeClave(fabricaElegida) : perfilDeProveedor(ultima?.proveedor);
  const deLaFabrica = historia.filter((l) => clavePerfil(perfilDeProveedor(l.proveedor)) === clavePerfil(perfil));
  const moneda = perfil?.moneda ?? deLaFabrica.find((l) => l.moneda)?.moneda ?? null;

  if (nuevo) avisos.push(`${lista.modelo} nunca se ha pedido: elige la fábrica y captura el precio y la descripción.`);
  else if (!perfil) avisos.push(`El último pedido de ${lista.modelo} no dice de qué fábrica es: elígela.`);
  else if (!deLaFabrica.length) avisos.push(`${lista.modelo} nunca se le ha pedido a ${perfil.nombre}: captura el precio.`);
  if (perfil && !moneda) avisos.push(`No se sabe en qué moneda cobra ${perfil.nombre}: elígela.`);

  const descripcion =
    historia.map((l) => (l.descripcion ?? "").replace(/\s*\(caja de una sola talla\)\s*$/i, "").trim()).find(Boolean) ?? "";

  const lineas: LineaBorrador[] = [];
  for (const c of lista.colores) {
    // El color se escribe como lo escribió la fábrica la última vez (BLK →
    // BLACK), así el packing list amarra contra el pedido.
    const previo = historia.find((l) => mismoColor(l.color, c.color));
    const color = (previo?.color ?? c.color).toUpperCase();
    const delColor = historia.filter((l) => mismoColor(l.color, color));

    for (const r of c.renglones) {
      // Medidas: de una caja anterior del modelo con los mismos pares.
      const conMedida = (pares: number) =>
        delColor.find((l) => l.paresPorCaja === pares && (l.medidas || l.cbmCaja)) ??
        historia.find((l) => l.paresPorCaja === pares && (l.medidas || l.cbmCaja));

      if (r.unitalla) {
        const t = r.unitalla;
        const porCaja =
          r.paresPorCaja ??
          delColor.find((l) => l.talla === t)?.paresPorCaja ??
          delColor.find((l) => l.talla)?.paresPorCaja ??
          historia.find((l) => l.talla)?.paresPorCaja ??
          null;
        if (!porCaja) avisos.push(`${color} talla ${t}: falta cuántos pares trae la caja (escribe «CTNS OF 12»).`);
        const p = precioDeHistoria(deLaFabrica, color, t);
        const m = porCaja ? conMedida(porCaja) : undefined;
        lineas.push({
          color,
          unitalla: t,
          corrida: {},
          paresPorCaja: porCaja ?? 0,
          cajas: r.cajas,
          precio: p?.precio ?? null,
          preciosTalla: null,
          medidas: m?.medidas ?? null,
          cbmCaja: m?.cbmCaja ?? null,
          precioDe: p?.pedido ?? null,
        });
        continue;
      }

      let corrida = r.corrida;
      if (!corrida) {
        const anterior = delColor.find((l) => !l.talla) ?? historia.find((l) => !l.talla);
        if (anterior) {
          corrida = { ...anterior.tallas };
          if (!delColor.find((l) => !l.talla)) {
            avisos.push(`${color}: no hay corrida anterior de ese color; se usó la de ${anterior.color} (${anterior.pedido}).`);
          }
        } else {
          avisos.push(`${color}: «misma corrida» pero ${lista.modelo} nunca se ha pedido en corrida. Escribe las tallas.`);
          continue;
        }
      }
      const porCaja = Object.values(corrida).reduce((a, b) => a + b, 0);
      if (r.paresPorCaja && r.paresPorCaja !== porCaja) {
        avisos.push(`${color}: la corrida suma ${porCaja} pares pero escribiste cajas de ${r.paresPorCaja}. Se usa la corrida.`);
      }
      const precios: Record<string, number> = {};
      let precioDe: string | null = null;
      let faltaPrecio = false;
      for (const t of Object.keys(corrida)) {
        const p = precioDeHistoria(deLaFabrica, color, t);
        if (p) {
          precios[t] = p.precio;
          precioDe ??= p.pedido;
        } else faltaPrecio = true;
      }
      const distintos = new Set(Object.values(precios));
      const m = conMedida(porCaja);
      lineas.push({
        color,
        unitalla: null,
        corrida,
        paresPorCaja: porCaja,
        cajas: r.cajas,
        precio: faltaPrecio || !distintos.size ? null : Math.min(...distintos),
        preciosTalla: !faltaPrecio && distintos.size > 1 ? precios : null,
        medidas: m?.medidas ?? null,
        cbmCaja: m?.cbmCaja ?? null,
        precioDe,
      });
    }
  }

  if (!nuevo && lineas.some((l) => l.precio == null)) {
    avisos.push("Hay renglones sin precio de esa fábrica: captúralo antes de confirmar.");
  }

  return {
    modelo: lista.modelo,
    fabrica: perfil?.clave ?? null,
    proveedor: perfil?.nombre ?? null,
    moneda,
    descripcion,
    lineas,
    nuevo,
    avisos,
  };
}

/** Lo que falta para poder confirmar el borrador (vacío = listo). */
/**
 * Un borrador de FAMILIA: varios modelos que la fábrica hace como un solo
 * zapato y se piden en UN pedido (GT117…GT122). Cada modelo se arma como
 * siempre con su propia historia y sus renglones llevan `modelo`; la
 * fábrica es la del primero que la tenga y los demás se arman con ESA (los
 * precios de otra fábrica no sirven). Nuevo solo si todos lo son.
 */
export function armarBorradorFamilia(
  nombre: string,
  listas: ModeloLista[],
  historiaTodo: LineaHistoria[],
  fabricaElegida?: string | null,
): BorradorArmado {
  const primeros = listas.map((l) => armarBorrador(l, historiaTodo, fabricaElegida));
  const fabrica = fabricaElegida ?? primeros.find((b) => b.fabrica)?.fabrica ?? null;
  const armados = fabrica ? listas.map((l) => armarBorrador(l, historiaTodo, fabrica)) : primeros;

  const lineas: LineaBorrador[] = [];
  const avisos: string[] = [];
  for (const b of armados) {
    for (const l of b.lineas) lineas.push({ ...l, modelo: b.modelo.toUpperCase() });
    for (const a of b.avisos) avisos.push(a.startsWith(b.modelo) ? a : `${b.modelo}: ${a}`);
  }
  const distintas = new Set(primeros.map((b) => b.fabrica).filter(Boolean));
  if (distintas.size > 1) {
    avisos.push(`Los modelos de ${nombre} se han pedido a fábricas distintas; se usa la de ${armados.find((b) => b.fabrica)?.modelo ?? listas[0].modelo}.`);
  }
  const con = armados.find((b) => b.fabrica) ?? armados[0];
  return {
    modelo: nombre.toUpperCase(),
    fabrica: con?.fabrica ?? null,
    proveedor: con?.proveedor ?? null,
    moneda: con?.moneda ?? armados.find((b) => b.moneda)?.moneda ?? null,
    descripcion: armados.map((b) => b.descripcion).find(Boolean) ?? "",
    lineas,
    nuevo: armados.every((b) => b.nuevo),
    avisos: [...new Set(avisos)],
  };
}

export function faltantesDeBorrador(b: {
  fabrica: string | null;
  moneda: Moneda | null;
  lineas: LineaBorrador[];
}): string[] {
  const f: string[] = [];
  if (!b.fabrica) f.push("la fábrica");
  if (!b.moneda) f.push("la moneda");
  if (!b.lineas.length) f.push("renglones con cajas");
  if (b.lineas.some((l) => l.precio == null && !l.preciosTalla)) f.push("el precio de algún renglón");
  if (b.lineas.some((l) => !(l.paresPorCaja > 0))) f.push("los pares por caja de algún renglón");
  if (b.lineas.some((l) => !(l.cajas > 0))) f.push("las cajas de algún renglón");
  return f;
}

/** Totales del borrador: cajas, pares, importe y CBM (si se sabe la caja). */
export function totalesDeBorrador(lineas: LineaBorrador[]): { cajas: number; pares: number; importe: number | null; cbm: number | null; cajasSinMedida: number } {
  let cajas = 0;
  let pares = 0;
  let importe = 0;
  let conImporte = true;
  let cbm = 0;
  let cajasSinMedida = 0;
  for (const l of lineas) {
    cajas += l.cajas;
    pares += l.cajas * l.paresPorCaja;
    if (l.preciosTalla && !l.unitalla) {
      for (const [t, n] of Object.entries(l.corrida)) {
        const p = l.preciosTalla[t] ?? l.precio;
        if (p == null) conImporte = false;
        else importe += p * n * l.cajas;
      }
    } else if (l.precio == null) conImporte = false;
    else importe += l.precio * l.cajas * l.paresPorCaja;
    const porCaja = cbmDeCaja(l);
    if (porCaja == null) cajasSinMedida += l.cajas;
    else cbm += porCaja * l.cajas;
  }
  return {
    cajas,
    pares,
    importe: conImporte ? Math.round(importe * 100) / 100 : null,
    cbm: cajas > cajasSinMedida ? Math.round(cbm * 1000) / 1000 : null,
    cajasSinMedida,
  };
}

export function cbmDeCaja(l: { cbmCaja?: number | null; medidas?: { largoCm: number; anchoCm: number; altoCm: number } | null }): number | null {
  if (l.cbmCaja && l.cbmCaja > 0) return l.cbmCaja;
  if (l.medidas) return (l.medidas.largoCm * l.medidas.anchoCm * l.medidas.altoCm) / 1e6;
  return null;
}
