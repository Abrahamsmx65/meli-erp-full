/**
 * Qué renglón del pedido ES el que el packing list escribió distinto.
 *
 * Caso típico (dueño, 7-oct-2026): «hay tres colores —negro, medium brown y
 * crema—; el crema y el negro se amarran y solo sobró el medium brown.
 * Entonces me lo sugieres y solo me pones ahí para confirmar que sí es».
 * La fábrica le cambia el nombre al color entre el pedido y el packing
 * list, no al modelo ni a las cajas: lo que sobra de un lado es lo que
 * sobra del otro. Puro, para probarse; la pantalla de Contenido lo enseña
 * y el dueño CONFIRMA. Nunca se aplica solo.
 */
import { canonizar, claveComparacion } from "../importar/sku";

export interface RenglonParaSugerir {
  pedidoLineaId: string;
  pedido: string;
  modelo: string;
  color: string;
  talla: string | null;
  /** cajas del pedido que todavía no van en ningún contenedor (contando lo ya puesto en este) */
  libres: number;
  /** cajas ya puestas en ESTE contenedor */
  enEste: number;
}

export interface PendienteParaSugerir {
  modelo: string;
  color: string;
  talla: string | null;
  cajas: number;
  /** el pedido que decía el packing list, si lo decía */
  pedido?: string | null;
}

export type Confianza = "eliminacion" | "parecido" | "ninguna";

export interface Sugerencia {
  /** el renglón que casi seguro es; null si no hay con qué */
  renglon: RenglonParaSugerir | null;
  confianza: Confianza;
  /** explicación corta para el dueño */
  porQue: string;
  /** las demás opciones, por si no es (con cajas libres, del mismo modelo) */
  otras: RenglonParaSugerir[];
}

/** Palabras del color ya con sinónimos (BLACK → BLK) para compararlas. */
function palabras(color: string): Set<string> {
  return new Set(claveComparacion(color || "").split("-").filter(Boolean));
}

function enMx(n: number): string {
  return Math.round(n).toLocaleString("es-MX");
}

export function sugerirRenglon(p: PendienteParaSugerir, renglones: RenglonParaSugerir[]): Sugerencia {
  const modelo = canonizar(p.modelo);
  const delModelo = renglones.filter((r) => canonizar(r.modelo) === modelo);
  // Si el packing list dijo el pedido y ese pedido tiene el modelo, solo
  // cuenta ese pedido; si no, cualquiera de los pedidos del contenedor.
  const pedido = p.pedido ? canonizar(p.pedido) : "";
  const delPedido = pedido ? delModelo.filter((r) => canonizar(r.pedido) === pedido) : [];
  const ambito = delPedido.length ? delPedido : delModelo;

  // Misma clase de caja: unitalla contra la misma talla (o la corrida como
  // segunda opción); corrida contra corrida.
  const mismaTalla = (r: RenglonParaSugerir) => (p.talla ? r.talla === p.talla : !r.talla);
  const conCajas = ambito.filter((r) => r.libres > 0);
  const candidatos = [...conCajas.filter(mismaTalla), ...conCajas.filter((r) => !mismaTalla(r))];
  if (!candidatos.length) {
    return { renglon: null, confianza: "ninguna", porQue: `Ningún pedido del contenedor tiene cajas libres de ${modelo}.`, otras: [] };
  }

  // POR ELIMINACIÓN: de ese pedido y modelo, los colores que YA entraron al
  // contenedor están resueltos; si queda UN solo color sin entrar, es ese.
  const sinEntrar = candidatos.filter((r) => r.enEste <= 0 && mismaTalla(r));
  if (sinEntrar.length === 1) {
    const r = sinEntrar[0];
    const yaEntraron = [...new Set(ambito.filter((x) => x.enEste > 0).map((x) => x.color))];
    const quien = `${r.pedido} ${canonizar(r.modelo)}`;
    const base = yaEntraron.length
      ? `Del ${quien} ya entraron ${yaEntraron.join(" y ")}; solo queda ${r.color} (${enMx(r.libres)} cajas sin barco)`
      : `El ${quien} solo tiene un color con cajas sin barco: ${r.color} (${enMx(r.libres)} cajas)`;
    const mismas = r.libres === p.cajas ? `, y son las mismas ${enMx(p.cajas)} cajas del packing list` : "";
    return { renglon: r, confianza: "eliminacion", porQue: `${base}${mismas}.`, otras: candidatos.filter((x) => x !== r) };
  }

  // SE PARECE: comparten alguna palabra del color ("M BROWN" y "LT BROWN").
  const suyas = palabras(p.color);
  const comunes = (r: RenglonParaSugerir) => [...palabras(r.color)].filter((w) => suyas.has(w)).length;
  const ordenados = [...candidatos].sort((a, b) => comunes(b) - comunes(a) || b.libres - a.libres);
  const mejor = ordenados[0];
  if (comunes(mejor) > 0 && (ordenados.length === 1 || comunes(mejor) > comunes(ordenados[1]))) {
    const palabra = [...palabras(mejor.color)].filter((w) => suyas.has(w)).join(" ");
    return {
      renglon: mejor,
      confianza: "parecido",
      porQue: `Se parece: «${p.color}» y «${mejor.color}» comparten «${palabra}» (${enMx(mejor.libres)} cajas sin barco).`,
      otras: ordenados.slice(1),
    };
  }

  return {
    renglon: null,
    confianza: "ninguna",
    porQue: `${enMx(ordenados.length)} colores de ${modelo} con cajas sin barco y ninguno se parece: elige tú.`,
    otras: ordenados,
  };
}
