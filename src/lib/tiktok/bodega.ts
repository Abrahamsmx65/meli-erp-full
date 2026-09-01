/**
 * El saldo físico del almacén de TikTok sale de INDUSTHER, no de capturas.
 *
 * El 3PL dio de alta una bodega propia para TikTok en su sistema, y su API
 * la reporta igual que a las demás: en cajas, con corrida o talla única. Eso
 * es la verdad física — nadie más cuenta esos pares — y el ERP la toma tal
 * cual. Lo que el ERP AGREGA es lo que el 3PL no sabe: qué pedidos de TikTok
 * están pagados sin salir (apartado) y qué envíos se confirmaron después de
 * la última foto (salidas).
 *
 * La foto entra al kardex como un AJUSTE fechado en el momento de la foto:
 * pisa el saldo a esa hora, y las salidas posteriores se le restan encima.
 * Así una venta confirmada a las 13:50 con foto de las 14:00 no se descuenta
 * dos veces (la foto ya la trae), y una confirmada a las 14:05 sí se resta
 * hasta que la siguiente foto la absorba.
 */
import { canonizar } from "../importar/sku";
import type { CajaConstruida } from "../importar/cajas";
import { saldosDesdeMovimientos, type Movimiento } from "./kardex";

/** Cómo se reconoce la bodega de TikTok en Industher: "Tik Tok", "TIKTOK", "TikTok Shop"… */
export function esAlmacenTikTok(nombre: string | null | undefined): boolean {
  const c = canonizar(String(nombre ?? "")).replace(/-/g, "");
  return c === "TIKTOK" || c.startsWith("TIKTOK");
}

/**
 * Pares FÍSICOS por SKU a partir de las cajas de la bodega de TikTok.
 *
 * Se cuentan las cajas físicas (disponibles + apartadas), no solo las
 * disponibles: en esta bodega "apartada" no significa "para un envío a
 * Full", y lo que TikTok tiene apartado el ERP ya lo resta por su lado
 * con los pedidos pagados. Restarlo dos veces dejaría de ofrecer pares
 * que sí están en el estante.
 */
export function paresPorSkuDesdeCajas(cajas: CajaConstruida[]): Map<string, number> {
  const pares = new Map<string, number>();
  for (const caja of cajas) {
    const fisicas = (caja.cajasDisponibles ?? 0) + (caja.cajasApartadas ?? 0);
    if (fisicas <= 0) continue;
    for (const it of caja.detalle ?? []) {
      if (!it.sku || it.piezas <= 0) continue;
      pares.set(it.sku, (pares.get(it.sku) ?? 0) + it.piezas * fisicas);
    }
  }
  return pares;
}

export interface AjusteDesdeFoto {
  sku: string;
  tipo: "ajuste";
  cantidad: number;
  referencia: string;
  motivo: string;
  fecha: string;
}

/**
 * Qué ajustes hay que registrar para que el kardex, A LA HORA DE LA FOTO,
 * diga lo mismo que Industher.
 *
 * Solo se escribe un ajuste donde haya diferencia: escribir 300 renglones
 * idénticos cada hora enterraría las ventas en la bitácora. La comparación
 * es contra el saldo QUE HABÍA a la hora de la foto (movimientos hasta esa
 * fecha), no contra el de ahora: una salida registrada después de la foto
 * tiene que seguir restando después del ajuste, no borrar la diferencia.
 *
 * Un SKU que el kardex tenía y la bodega ya no reporta baja a 0: si no está
 * en la foto, no está en el estante.
 */
export function ajustesDesdeFoto(
  paresEnBodega: Map<string, number>,
  movimientos: Movimiento[],
  fechaFoto: string,
): AjusteDesdeFoto[] {
  const hastaLaFoto = movimientos.filter((m) => (m.fecha ?? "") <= fechaFoto);
  const saldosEntonces = saldosDesdeMovimientos(hastaLaFoto);
  const referencia = `industher:${fechaFoto}`;

  const skus = new Set<string>([...paresEnBodega.keys(), ...saldosEntonces.keys()]);
  const ajustes: AjusteDesdeFoto[] = [];

  for (const sku of skus) {
    const enBodega = paresEnBodega.get(sku) ?? 0;
    const enKardex = saldosEntonces.get(sku) ?? 0;
    if (enBodega === enKardex) continue;
    ajustes.push({
      sku,
      tipo: "ajuste",
      cantidad: enBodega,
      referencia,
      motivo: "Foto de la bodega TikTok en Industher",
      fecha: fechaFoto,
    });
  }

  return ajustes.sort((a, b) => a.sku.localeCompare(b.sku, "es"));
}
