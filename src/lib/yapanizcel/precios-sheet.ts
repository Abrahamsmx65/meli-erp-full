/**
 * Precios de las fundas para sus ofertas en MELI, de la pestaña FUNDAS del
 * sheet «Números» (dueño, 23-oct-2026: «precio por diseño puede tomar el
 * precio del sheet de Números de la sección fundas»). Motor puro.
 *
 * La pestaña trae tres bloques, cada uno con su renglón de encabezados:
 *   MODELO (fundas)  … PV MELI | 5% MAS PARA RELAMPAGO
 *   MICAS            … PV MELI CON RETENCION | PVP AMAZON + ADS | …
 *   FUNDAS TABLETA   … PV MELI RETENCION | 5% MAS PARA RELAMPAGO | …
 * Debajo de cada encabezado, un renglón por diseño (columna A: «462»,
 * «380 GRANDE»). El PV MELI es el precio de todos los días y de Buen Fin;
 * la relámpago, su columna «RELAMPAGO». Las micas no la tienen: se usa la
 * misma regla del sheet (PV × 1.055) y se declara.
 *
 * Un diseño en dos renglones (582 con dos costos, 380 GRANDE y CHICO) se
 * queda con el precio MÁS ALTO: la publicación no dice cuál de los dos es,
 * y un precio alto a lo más lo rechaza MELI; uno bajo vendería con pérdida.
 */
import type { Celda, Libro } from "../finanzas/sheets";

/** La regla del sheet para la relámpago: 5.5 % arriba del PV MELI. */
export const FACTOR_RELAMPAGO_FUNDAS = 1.055;

export interface PrecioFunda {
  diseno: string;
  /** PV MELI del sheet, tal cual */
  pvMeli: number;
  /** precio relámpago del sheet (o PV × 1.055 si su bloque no lo trae) */
  relampago: number;
  relampagoCalculado: boolean;
  /** el bloque del sheet: FUNDAS, MICAS, FUNDAS TABLETA */
  bloque: string;
  /** renglones del sheet que dieron este precio (más de uno = se tomó el más alto) */
  renglones: string[];
}

const txt = (c: Celda | undefined) => (c?.v == null ? "" : String(c.v).replace(/\s+/g, " ").trim());
const num = (c: Celda | undefined): number | null => {
  if (!c || c.v == null) return null;
  const n = typeof c.v === "number" ? c.v : Number(String(c.v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const redondear = (n: number) => Math.round(n * 100) / 100;

export function leerPreciosFundas(libro: Libro): { precios: PrecioFunda[]; avisos: string[] } {
  const avisos: string[] = [];
  const h = libro.get("FUNDAS");
  if (!h) return { precios: [], avisos: ["El sheet de Números no tiene la pestaña FUNDAS."] };

  const porDiseno = new Map<string, PrecioFunda>();
  let iPv = -1;
  let iRel = -1;
  let bloque = "";
  for (let r = 0; r < h.length; r++) {
    const fila = h[r] ?? [];
    const textos = fila.map((c) => txt(c).toUpperCase());
    const pv = textos.findIndex((t) => /^PV MELI/.test(t));
    if (pv >= 0) {
      iPv = pv;
      iRel = textos.findIndex((t) => /RELAMPAGO/.test(t));
      const a = textos[0] ?? "";
      bloque = a === "MODELO" || !a ? "FUNDAS" : a;
      continue;
    }
    if (iPv < 0) continue;
    const etiqueta = txt(fila[0]);
    const m = etiqueta.match(/^(\d{3,5})\b/);
    if (!m) continue;
    const pvMeli = num(fila[iPv]);
    if (pvMeli == null) continue;
    const delSheet = iRel >= 0 ? num(fila[iRel]) : null;
    const relampago = delSheet ?? pvMeli * FACTOR_RELAMPAGO_FUNDAS;
    const nuevo: PrecioFunda = {
      diseno: m[1],
      pvMeli: redondear(pvMeli),
      relampago: redondear(relampago),
      relampagoCalculado: delSheet == null,
      bloque,
      renglones: [etiqueta],
    };
    const previo = porDiseno.get(nuevo.diseno);
    if (!previo) {
      porDiseno.set(nuevo.diseno, nuevo);
      continue;
    }
    const renglones = [...previo.renglones, etiqueta];
    porDiseno.set(nuevo.diseno, nuevo.pvMeli > previo.pvMeli ? { ...nuevo, renglones } : { ...previo, renglones });
  }

  const precios = [...porDiseno.values()].sort((a, b) => a.diseno.localeCompare(b.diseno, "es", { numeric: true }));
  const repetidos = precios.filter((p) => p.renglones.length > 1);
  if (repetidos.length) {
    avisos.push(
      `Diseños en más de un renglón del sheet, se usa el precio más alto: ${repetidos.map((p) => `${p.diseno} (${p.renglones.join(", ")})`).join("; ")}.`,
    );
  }
  const calculados = precios.filter((p) => p.relampagoCalculado);
  if (calculados.length) {
    avisos.push(
      `Sin columna de relámpago en el sheet (${[...new Set(calculados.map((p) => p.bloque))].join(", ")}): su relámpago es el PV MELI × 1.055, la regla de las demás: ${calculados.map((p) => p.diseno).join(", ")}.`,
    );
  }
  if (!precios.length) avisos.push("La pestaña FUNDAS de Números no trae ningún diseño con PV MELI.");
  return { precios, avisos };
}
