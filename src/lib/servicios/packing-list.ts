/**
 * Del packing list de la fábrica al contenedor, sin capturar nada a mano.
 *
 * Dos pasos, como la proforma: primero se CASA cada renglón del archivo con
 * un renglón de pedido del ERP y se enseña exactamente qué va a pasar (qué
 * pedido, cuántas cajas caben, qué no se encontró); solo después se aplica.
 *
 * El amarre es pedido + modelo + color + talla. El pedido del archivo viene
 * con sufijo de embarque parcial ("IN10079-3"), que ya se le quitó al leer.
 * El color se compara aplastado ("M Brown" y "MBROWN" son el mismo). Si el
 * archivo no trae pedido (el packing del propio ERP), se busca el renglón
 * entre los pedidos vivos con cajas pendientes, del más viejo al más nuevo,
 * y se reparte si hace falta.
 */
import type { LineaPacking, MedidasCaja, PackingList } from "../importar/packing-list";
import { aUnaLetra, canonizar, claveAplastada, claveComparacion, colorPlano, construirSkuMeli } from "../importar/sku";
import { porTandas, traerTodo, type DB } from "../datos/repos";
import { asignarCajasAContenedor, type DatosContenedor } from "./contenedores";
import { invalidar } from "./cache";
import { invalidarInventario } from "./inventario";

export type EstadoCasado =
  | "ok"
  | "recorte"
  | "sin_pedido"
  | "sin_renglon"
  | "sin_espacio";

export { aUnaLetra } from "../importar/sku";
import { cargarAliasColores, colorEfectivo, type MapaAlias } from "./alias-color";

/**
 * Amarre A MANO del color (`alias-color.ts`): el packing list y el pedido
 * caen en el mismo renglón si, traducidos los dos al color de MELI que
 * eligió el dueño, dicen lo mismo ("BLK (NEGRO)" ligado a BLK contra el
 * "BLACK" del pedido). Solo si queda UN candidato; con dos no se adivina.
 */
export function colorPorAlias<T extends { modelo: string; color: string }>(
  alias: MapaAlias | null | undefined,
  modelo: string,
  color: string,
  candidatos: T[],
): T | null {
  if (!alias?.size) return null;
  const objetivo = claveColor(colorEfectivo(alias, modelo, color));
  const iguales = candidatos.filter((c) => claveColor(colorEfectivo(alias, c.modelo, c.color)) === objetivo);
  return iguales.length === 1 ? iguales[0] : null;
}

/**
 * El renglón del pedido cuyo color está a una letra del que trae el archivo.
 * Solo si hay UNO: un empate no se resuelve solo (misma regla que el amarre
 * de SKUs), se declara y el dueño decide.
 */
export function colorParecido<T extends { color: string }>(color: string, candidatos: T[]): T | null {
  const objetivo = colorPlano(color);
  const cerca = candidatos.filter((c) => aUnaLetra(colorPlano(c.color), objetivo));
  return cerca.length === 1 ? cerca[0] : null;
}

/**
 * Lo que NO entró completo, en texto para el dueño: el packing list de la
 * fábrica trae renglones que el pedido no tiene (la fábrica le cambió el
 * nombre al color) o que ya viajan en otro contenedor. Antes solo se
 * guardaba cuántos eran y el dueño no tenía cómo saber cuáles.
 */
export function problemasDelCasado(casado: PackingCasado): string[] {
  return casado.lineas
    .filter((l) => l.cajasAsignar < l.cajas)
    .map((l) => {
      const que = `${l.modelo}${l.color ? ` ${l.color}` : ""}${l.talla ? ` talla ${l.talla}` : ""}`;
      const faltan = l.cajas - l.cajasAsignar;
      return `${que}: ${faltan} de ${l.cajas} cajas no entraron. ${l.detalle ?? ""}`.trim();
    });
}

export interface LineaCasada {
  /** índices de las líneas del archivo que alimentan este renglón */
  filas: number[];
  pedidoArchivo: string | null;
  pedidoErp: string | null;
  modelo: string;
  color: string;
  talla: string | null;
  /** cajas que dice el archivo */
  cajas: number;
  pares: number;
  pedidoLineaId: string | null;
  cajasPedido: number;
  enOtros: number;
  enEste: number;
  /** cajas que de verdad se van a poner en este contenedor */
  cajasAsignar: number;
  estado: EstadoCasado;
  detalle: string | null;
  /** medidas de la caja (cm) y peso bruto por caja (kg), del archivo */
  medidas: MedidasCaja | null;
  pesoKg: number | null;
}

export interface PackingCasado {
  numero: string;
  contenedorExistente: boolean;
  lineas: LineaCasada[];
  totales: {
    cajasArchivo: number;
    cajasAsignar: number;
    renglonesOk: number;
    renglonesConProblema: number;
  };
  avisos: string[];
}

interface RenglonPedido {
  id: string;
  pedidoId: string;
  pedido: string;
  pedidoOrden: number;
  modelo: string;
  color: string;
  talla: string;
  cajas: number;
  paresPorCaja: number;
}

function claveColor(color: string): string {
  return claveAplastada(color || "");
}

/**
 * El color LAXO, segundo intento cuando el aplastado no amarra: sin la
 * anotación en español entre paréntesis que la fábrica empezó a poner
 * («BLK (NEGRO)», «NAVY (AZUL MARINO)», «CAMEL （camello）»), con los
 * sinónimos de `claveComparacion` (BLACK = BLK, el punto de «DK.BROWN» se
 * va) y los repetidos seguidos colapsados («BLK/BLK/RED» = «BLK-RED»).
 * Mismo criterio que `claveProductoLaxa` de Productos nuevos. 11-oct-2026:
 * por esto se quedaban fuera cientos de cajas en S264, S265, S268, S269 y
 * S270 con «ningún pedido vivo tiene GT134 BLK (NEGRO)».
 */
export function claveColorLaxa(color: string): string {
  const sinNota = String(color ?? "").replace(/[(（][^)）]*[)）]/g, " ");
  const tokens = claveComparacion(sinNota).split("-").filter(Boolean);
  const laxos: string[] = [];
  for (const t of tokens) if (laxos[laxos.length - 1] !== t) laxos.push(t);
  return laxos.join("");
}

function claveRenglonLaxa(pedido: string | null, modelo: string, color: string, talla: string | null): string {
  return `${pedido ? canonizar(pedido) : ""}|${canonizar(modelo)}|${claveColorLaxa(color)}|${talla ?? ""}`;
}

/**
 * Caja de corrida del packing list contra un pedido que el modelo + color
 * lo tiene POR TALLA (cajas de una sola talla, «Solid size»): el archivo no
 * dice qué tallas trae, así que SOLO se amarra si sus cajas son exactamente
 * las que les faltan a esas tallas (S269-2026: GT134 BLK 41 + 51 = 92, lo
 * que le faltaba al IN10159 en sus seis tallas). Si no cuadra exacto no se
 * adivina el reparto: queda pendiente y se dice por qué.
 */
export function repartoExactoPorTalla<T extends { id: string; talla: string }>(
  cajas: number,
  renglones: T[],
  libreDe: (r: T) => number,
): { renglon: T; cajas: number }[] | null {
  const porTalla = renglones.filter((r) => r.talla);
  if (!porTalla.length) return null;
  const libres = porTalla.map((r) => ({ renglon: r, cajas: Math.max(0, libreDe(r)) })).filter((x) => x.cajas > 0);
  const suma = libres.reduce((a, x) => a + x.cajas, 0);
  return suma > 0 && suma === cajas ? libres : null;
}

function claveRenglon(pedido: string | null, modelo: string, color: string, talla: string | null): string {
  return `${pedido ? canonizar(pedido) : ""}|${canonizar(modelo)}|${claveColor(color)}|${talla ?? ""}`;
}

/** Los renglones de los pedidos vivos de la cuenta, con lo ya embarcado. */
async function cargarRenglones(db: DB, accountId: string) {
  const { data: pedidos } = await db
    .from("pedidos")
    .select("id, pedido, estado, creado_en")
    .eq("account_id", accountId)
    .neq("estado", "cancelado")
    // Del más viejo al más nuevo: sin orden, «el pedido más viejo primero» dependía de la base.
    .order("creado_en", { ascending: true });

  const porPedidoId = new Map<string, { pedido: string; orden: number }>();
  const idPorPedido = new Map<string, string>();
  (pedidos ?? []).forEach((p, i) => {
    porPedidoId.set(p.id, { pedido: p.pedido, orden: i });
    idPorPedido.set(canonizar(p.pedido), p.id);
  });

  const ids = [...porPedidoId.keys()];
  // Paginado con traerTodo: con todos los pedidos vivos en el filtro, las
  // líneas pasan de 1,000 y PostgREST cortaría ahí sin avisar.
  const lineas = ids.length
    ? await traerTodo<any>(
        db,
        "pedido_lineas",
        "id, pedido_id, modelo, color, talla, cajas, pares_por_caja",
        (q) => q.in("pedido_id", ids),
      )
    : ([] as any[]);

  const renglones: RenglonPedido[] = (lineas ?? []).map((l: any) => {
    const p = porPedidoId.get(l.pedido_id)!;
    return {
      id: l.id,
      pedidoId: l.pedido_id,
      pedido: p.pedido,
      pedidoOrden: p.orden,
      modelo: l.modelo,
      color: l.color ?? "",
      talla: l.talla ?? "",
      cajas: l.cajas ?? 0,
      paresPorCaja: l.pares_por_caja ?? 0,
    };
  });

  // Lo embarcado por renglón, separado por contenedor. Las tandas ya
  // existían; ahora cada tanda además PAGINA (una línea repartida en varios
  // contenedores multiplica las filas y 500 ids pueden pasar de 1,000).
  const filasAsignadas = await porTandas(renglones.map((r) => r.id), 500, (tanda) =>
    traerTodo<{ pedido_linea_id: string; contenedor_id: string; cajas: number | null }>(
      db,
      "contenedor_lineas",
      "pedido_linea_id, contenedor_id, cajas",
      (q) => q.in("pedido_linea_id", tanda),
    ),
  );
  const asignado = new Map<string, { contenedorId: string; cajas: number }[]>();
  for (const a of filasAsignadas) {
    const lista = asignado.get(a.pedido_linea_id) ?? [];
    lista.push({ contenedorId: a.contenedor_id, cajas: a.cajas ?? 0 });
    asignado.set(a.pedido_linea_id, lista);
  }

  return { renglones, idPorPedido, asignado };
}

/**
 * Casa el packing list contra los pedidos del ERP para el contenedor
 * `numero` (que puede existir ya: entonces lo de este contenedor no cuenta
 * como "en otros" y se reemplaza, para que subir dos veces el mismo archivo
 * no duplique).
 */
export async function casarPackingList(
  db: DB,
  accountId: string,
  packing: PackingList,
  numeroCrudo: string | null | undefined,
): Promise<PackingCasado> {
  // Nuestro ID es la referencia del embarque (S259-2026); el número ISO del
  // contenedor (MIEU3920536) es el de la naviera y va aparte.
  const numero = (numeroCrudo || packing.referencia || packing.contenedor || "").trim().toUpperCase();
  const avisos = [...packing.avisos];

  const { data: existente } = numero
    ? await db
        .from("contenedores")
        .select("id")
        .eq("account_id", accountId)
        .eq("numero", numero)
        .maybeSingle()
    : { data: null };
  const contenedorId = existente?.id ?? null;

  const [{ renglones, idPorPedido, asignado }, alias] = await Promise.all([
    cargarRenglones(db, accountId),
    cargarAliasColores(db, accountId),
  ]);

  const enOtrosDe = (id: string) =>
    (asignado.get(id) ?? [])
      .filter((a) => a.contenedorId !== contenedorId)
      .reduce((s, a) => s + a.cajas, 0);
  const enEsteDe = (id: string) =>
    (asignado.get(id) ?? [])
      .filter((a) => a.contenedorId === contenedorId)
      .reduce((s, a) => s + a.cajas, 0);

  // Índices para encontrar el renglón del pedido.
  const porClave = new Map<string, RenglonPedido>();
  const porSku = new Map<string, RenglonPedido[]>();
  const porProducto = new Map<string, RenglonPedido[]>();
  // Segundo intento con el color laxo (sin «(NEGRO)», BLACK = BLK): con y sin pedido.
  const porClaveLaxa = new Map<string, RenglonPedido[]>();
  const porLaxaLibre = new Map<string, RenglonPedido[]>();
  // Por modelo en cualquier pedido vivo: para el dedazo cuando el archivo no trae pedido.
  const porModeloLibre = new Map<string, RenglonPedido[]>();
  const agregar = (m: Map<string, RenglonPedido[]>, k: string, r: RenglonPedido) => {
    const l = m.get(k) ?? [];
    l.push(r);
    m.set(k, l);
  };
  for (const r of renglones) {
    agregar(porClaveLaxa, claveRenglonLaxa(r.pedido, r.modelo, r.color, r.talla || null), r);
    agregar(porLaxaLibre, claveRenglonLaxa(null, r.modelo, r.color, r.talla || null), r);
    agregar(porModeloLibre, canonizar(r.modelo), r);
    porClave.set(claveRenglon(r.pedido, r.modelo, r.color, r.talla || null), r);
    const sku = claveComparacion(construirSkuMeli(r.modelo, r.color, r.talla));
    const lista = porSku.get(sku) ?? [];
    lista.push(r);
    porSku.set(sku, lista);
    // Sin el color: para rescatar un dedazo de la fábrica ("Toffe").
    const kProd = claveRenglon(r.pedido, r.modelo, "", r.talla || null);
    const hermanos = porProducto.get(kProd) ?? [];
    hermanos.push(r);
    porProducto.set(kProd, hermanos);
  }
  const buscarLibre = (modelo: string, color: string, talla: string | null, sku?: string) => {
    // Sin pedido en el archivo: los renglones de cualquier pedido vivo con
    // ese producto, del más viejo al más nuevo.
    const clave = sku ? claveComparacion(sku) : claveComparacion(construirSkuMeli(modelo, color, talla ?? ""));
    let candidatos = porSku.get(clave) ?? [];
    if (!candidatos.length && !sku) candidatos = porLaxaLibre.get(claveRenglonLaxa(null, modelo, color, talla)) ?? [];
    return candidatos
      .filter((r) => r.cajas - enOtrosDe(r.id) > 0)
      .sort((a, b) => a.pedidoOrden - b.pedidoOrden);
  };
  const libreDe = (r: RenglonPedido) => r.cajas - enOtrosDe(r.id) - (reclamado.get(r.id) ?? 0);
  /** El primero con hueco entre los renglones del color laxo (o el primero, para declarar que ya no cabe). */
  const elegirLaxo = (lista: RenglonPedido[] | undefined): RenglonPedido | null =>
    lista?.length ? (lista.find((r) => libreDe(r) > 0) ?? lista[0]) : null;

  // Un mismo producto repetido en el archivo (dos embarques parciales del
  // mismo pedido, por ejemplo) se suma antes de casar.
  const juntas = new Map<string, { lineas: LineaPacking[]; indices: number[] }>();
  packing.lineas.forEach((l, i) => {
    const k = l.sku
      ? `${l.pedido ?? ""}|sku:${claveComparacion(l.sku)}`
      : claveRenglon(l.pedido, l.modelo, l.color, l.talla);
    const g = juntas.get(k) ?? { lineas: [], indices: [] };
    g.lineas.push(l);
    g.indices.push(i);
    juntas.set(k, g);
  });

  const salida: LineaCasada[] = [];
  // Cajas ya reclamadas en esta corrida por renglón de pedido (para repartir
  // sin pedido y para no prometer dos veces el mismo hueco).
  const reclamado = new Map<string, number>();

  const armar = (
    base: LineaCasada,
    r: RenglonPedido | null,
    cajasQueQuieren: number,
  ): LineaCasada => {
    if (!r) return base;
    const enOtros = enOtrosDe(r.id);
    const ya = reclamado.get(r.id) ?? 0;
    const tope = Math.max(0, r.cajas - enOtros - ya);
    const asignar = Math.min(cajasQueQuieren, tope);
    reclamado.set(r.id, ya + asignar);
    const estado: EstadoCasado =
      asignar <= 0 ? "sin_espacio" : asignar < cajasQueQuieren ? "recorte" : "ok";
    return {
      ...base,
      pedidoErp: r.pedido,
      pedidoLineaId: r.id,
      cajasPedido: r.cajas,
      enOtros,
      enEste: enEsteDe(r.id),
      cajasAsignar: asignar,
      estado,
      detalle:
        estado === "ok"
          ? null
          : estado === "recorte"
            ? `El pedido tiene ${r.cajas} cajas y ${enOtros + ya} ya van en otro lado: solo caben ${asignar}.`
            : `Ese renglón del pedido ya está embarcado completo (${r.cajas} cajas).`,
    };
  };

  for (const g of juntas.values()) {
    const l = g.lineas[0];
    const cajas = g.lineas.reduce((a, x) => a + x.cajas, 0);
    const pares = g.lineas.reduce((a, x) => a + x.pares, 0);
    const base: LineaCasada = {
      filas: g.lineas.map((x) => x.fila),
      pedidoArchivo: l.pedidoCrudo,
      pedidoErp: null,
      modelo: l.sku ?? l.modelo,
      color: l.sku ? "" : l.color,
      talla: l.talla,
      cajas,
      pares,
      pedidoLineaId: null,
      cajasPedido: 0,
      enOtros: 0,
      enEste: 0,
      cajasAsignar: 0,
      estado: "sin_renglon",
      detalle: null,
      // Las medidas vienen por bloque de color; dos embarques parciales del
      // mismo producto traen la misma caja, así que vale el primero que las traiga.
      medidas: g.lineas.find((x) => x.medidas)?.medidas ?? null,
      pesoKg: g.lineas.find((x) => x.pesoKg)?.pesoKg ?? null,
    };

    // El pedido de la celda se arrastra hacia abajo en el archivo: si ese
    // pedido NO tiene el modelo, el renglón es de otro pedido (S265-2026:
    // GT148G quedó debajo de IN10079 y es del IN10136). Se busca entre los
    // pedidos vivos como si el archivo no trajera pedido, y se declara.
    const pedidoSinModelo =
      Boolean(l.pedido) &&
      !l.sku &&
      idPorPedido.has(canonizar(l.pedido!)) &&
      !renglones.some((x) => canonizar(x.pedido) === canonizar(l.pedido!) && canonizar(x.modelo) === canonizar(l.modelo));
    if (pedidoSinModelo) {
      avisos.push(`${l.modelo} ${l.color}: el pedido ${l.pedido} no tiene el modelo ${l.modelo}; se buscó en los demás pedidos vivos.`);
    }
    if (l.pedido && !pedidoSinModelo) {
      if (!idPorPedido.has(canonizar(l.pedido))) {
        salida.push({
          ...base,
          estado: "sin_pedido",
          detalle: `El pedido ${l.pedido} no está cargado en el ERP. Cárgalo primero en Cargar pedidos.`,
        });
        continue;
      }
      let r = l.sku
        ? (porSku.get(claveComparacion(l.sku)) ?? []).find((x) => canonizar(x.pedido) === canonizar(l.pedido!)) ?? null
        : porClave.get(claveRenglon(l.pedido, l.modelo, l.color, l.talla)) ?? null;
      // Caja de una sola talla que el pedido tiene como corrida: se cuelga
      // del renglón de corrida, avisando.
      if (!r && l.talla && !l.sku) {
        r = porClave.get(claveRenglon(l.pedido, l.modelo, l.color, null)) ?? null;
        if (r) {
          avisos.push(
            `${l.modelo} ${l.color} talla ${l.talla}: el pedido ${l.pedido} no tiene ese renglón por talla; se puso en el de corrida.`,
          );
        }
      }
      // El color sin la anotación («BLK (NEGRO)» = «BLK», BLACK = BLK, «DK.BROWN» = «DK BROWN»).
      if (!r && !l.sku) {
        r =
          elegirLaxo(porClaveLaxa.get(claveRenglonLaxa(l.pedido, l.modelo, l.color, l.talla))) ??
          (l.talla ? elegirLaxo(porClaveLaxa.get(claveRenglonLaxa(l.pedido, l.modelo, l.color, null))) : null);
      }
      // Caja de corrida contra un pedido que ese color lo tiene por talla: solo si cuadra exacto.
      if (!r && !l.sku && !l.talla) {
        const porTalla = renglones.filter(
          (x) =>
            canonizar(x.pedido) === canonizar(l.pedido!) &&
            canonizar(x.modelo) === canonizar(l.modelo) &&
            claveColorLaxa(x.color) === claveColorLaxa(l.color) &&
            x.talla,
        );
        const reparto = repartoExactoPorTalla(cajas, porTalla, libreDe);
        if (reparto) {
          for (const x of reparto) {
            salida.push(armar({ ...base, talla: x.renglon.talla, cajas: x.cajas, pares: l.paresPorCaja ? x.cajas * l.paresPorCaja : 0 }, x.renglon, x.cajas));
          }
          avisos.push(
            `${l.modelo} ${l.color}: el pedido ${l.pedido} lo tiene por talla; las ${cajas} cajas son justo las que le faltaban a sus ${reparto.length} tallas y se repartieron así.`,
          );
          continue;
        }
        if (porTalla.length) {
          const faltan = porTalla.reduce((a, x) => a + Math.max(0, libreDe(x)), 0);
          salida.push({
            ...base,
            pedidoErp: l.pedido,
            detalle: `El pedido ${l.pedido} tiene ${l.modelo} ${porTalla[0].color} por talla (le faltan ${faltan} cajas) y el packing list trae ${cajas} cajas sin decir de qué talla; elige el reparto a mano.`,
          });
          continue;
        }
      }
      // Dedazo en el color: se rescata solo si hay UN color parecido.
      if (!r && !l.sku) {
        const cerca =
          colorParecido(l.color, porProducto.get(claveRenglon(l.pedido, l.modelo, "", l.talla)) ?? []) ??
          (l.talla ? colorParecido(l.color, porProducto.get(claveRenglon(l.pedido, l.modelo, "", null)) ?? []) : null);
        if (cerca) {
          r = cerca;
          avisos.push(
            `${l.modelo} "${l.colorCrudo || l.color}": el pedido ${l.pedido} lo tiene como "${cerca.color}"; se amarró ahí (una letra de diferencia).`,
          );
        }
      }
      // Amarre a mano del color (lo que el dueño ligó en Cargar pedidos o
      // Contenedores): los dos lados traducidos a MELI dicen lo mismo.
      if (!r && !l.sku) {
        const porAlias =
          colorPorAlias(alias, l.modelo, l.color, porProducto.get(claveRenglon(l.pedido, l.modelo, "", l.talla)) ?? []) ??
          (l.talla
            ? colorPorAlias(alias, l.modelo, l.color, porProducto.get(claveRenglon(l.pedido, l.modelo, "", null)) ?? [])
            : null);
        if (porAlias) {
          r = porAlias;
          avisos.push(
            `${l.modelo} "${l.colorCrudo || l.color}": el pedido ${l.pedido} lo tiene como "${porAlias.color}"; se amarró por el amarre a mano del color.`,
          );
        }
      }
      if (!r) {
        salida.push({
          ...base,
          pedidoErp: l.pedido,
          detalle: `El pedido ${l.pedido} no tiene el renglón ${l.modelo} ${l.color}${l.talla ? ` talla ${l.talla}` : ""}.`,
        });
        continue;
      }
      salida.push(armar(base, r, cajas));
      continue;
    }

    // Sin pedido: repartir entre los pedidos vivos con hueco.
    let libres = buscarLibre(l.modelo, l.color, l.talla, l.sku);
    // Corrida contra un pedido vivo que ese color lo tiene por talla: solo si cuadra exacto con UN pedido.
    if (!libres.length && !l.sku && !l.talla) {
      const delModelo = (porModeloLibre.get(canonizar(l.modelo)) ?? []).filter(
        (x) => x.talla && claveColorLaxa(x.color) === claveColorLaxa(l.color),
      );
      const pedidos = [...new Set(delModelo.map((x) => x.pedido))];
      const repartos = pedidos
        .map((p) => ({ p, reparto: repartoExactoPorTalla(cajas, delModelo.filter((x) => x.pedido === p), libreDe) }))
        .filter((x) => x.reparto);
      if (repartos.length === 1) {
        for (const x of repartos[0].reparto!) {
          salida.push(armar({ ...base, talla: x.renglon.talla, cajas: x.cajas, pares: l.paresPorCaja ? x.cajas * l.paresPorCaja : 0 }, x.renglon, x.cajas));
        }
        avisos.push(
          `${l.modelo} ${l.color}: el pedido ${repartos[0].p} lo tiene por talla; las ${cajas} cajas son justo las que le faltaban y se repartieron así.`,
        );
        continue;
      }
      if (delModelo.some((x) => libreDe(x) > 0)) {
        const faltan = delModelo.reduce((a, x) => a + Math.max(0, libreDe(x)), 0);
        salida.push({
          ...base,
          detalle: `${pedidos.join(", ")} tiene ${l.modelo} ${delModelo[0].color} por talla (le faltan ${faltan} cajas) y el packing list trae ${cajas} cajas sin decir de qué talla; elige el reparto a mano.`,
        });
        continue;
      }
    }
    // Dedazo en el color sin pedido en el archivo: UN solo color del modelo a una letra, en pedidos vivos con hueco.
    if (!libres.length && !l.sku) {
      const conHueco = (porModeloLibre.get(canonizar(l.modelo)) ?? []).filter(
        (x) => (x.talla || null) === (l.talla || null) && libreDe(x) > 0,
      );
      const colores = [...new Set(conHueco.map((x) => claveColorLaxa(x.color)))];
      const cerca = colores.filter((c) => aUnaLetra(c, claveColorLaxa(l.color)));
      if (cerca.length === 1) {
        libres = conHueco.filter((x) => claveColorLaxa(x.color) === cerca[0]).sort((a, b) => a.pedidoOrden - b.pedidoOrden);
        avisos.push(
          `${l.modelo} "${l.colorCrudo || l.color}": los pedidos lo tienen como "${libres[0].color}"; se amarró ahí (una letra de diferencia).`,
        );
      }
    }
    if (!libres.length) {
      salida.push({
        ...base,
        detalle: `Ningún pedido vivo tiene ${base.modelo}${base.color ? ` ${base.color}` : ""}${l.talla && !l.sku ? ` talla ${l.talla}` : ""} con cajas pendientes.`,
      });
      continue;
    }
    let restante = cajas;
    for (const r of libres) {
      if (restante <= 0) break;
      const hueco = Math.max(0, r.cajas - enOtrosDe(r.id) - (reclamado.get(r.id) ?? 0));
      if (hueco <= 0) continue;
      const toma = Math.min(hueco, restante);
      salida.push(armar({ ...base, cajas: toma, pares: l.paresPorCaja ? toma * l.paresPorCaja : 0 }, r, toma));
      restante -= toma;
    }
    if (restante > 0) {
      salida.push({
        ...base,
        cajas: restante,
        estado: "sin_espacio",
        detalle: `Sobran ${restante} cajas que ningún pedido vivo tiene pendientes.`,
      });
    }
  }

  const cajasAsignar = salida.reduce((a, s) => a + s.cajasAsignar, 0);
  const ok = salida.filter((s) => s.estado === "ok").length;

  return {
    numero,
    contenedorExistente: Boolean(contenedorId),
    lineas: salida,
    totales: {
      cajasArchivo: packing.totales.cajas,
      cajasAsignar,
      renglonesOk: ok,
      renglonesConProblema: salida.length - ok,
    },
    avisos,
  };
}

/**
 * Aplica lo casado: crea o reusa el contenedor y pone en él las cajas de
 * cada renglón. Los renglones sin pedido o sin renglón no tocan nada; su
 * problema ya se vio en la vista previa.
 */
export async function aplicarPackingList(
  db: DB,
  accountId: string,
  casado: PackingCasado,
  datos: Omit<DatosContenedor, "numero">,
): Promise<{
  contenedorId: string;
  numero: string;
  existia: boolean;
  renglones: number;
  cajas: number;
  omitidos: number;
  recortes: string[];
  /** qué renglones del archivo NO entraron completos y por qué */
  problemas: string[];
}> {
  if (!casado.numero) throw new Error("Falta el número de contenedor.");

  const asignaciones = casado.lineas
    .filter((l) => l.pedidoLineaId && l.cajasAsignar > 0)
    .map((l) => ({
      pedidoLineaId: l.pedidoLineaId as string,
      cajas: l.cajasAsignar,
      medidas: l.medidas,
      pesoKg: l.pesoKg,
    }));

  if (!asignaciones.length) {
    throw new Error("Ningún renglón del packing list se pudo amarrar con un pedido cargado.");
  }

  // Dos líneas del archivo que caen en el MISMO renglón de pedido se suman:
  // la asignación es "cuántas cajas de este renglón van en este contenedor".
  // Las medidas y el peso de la caja viajan con ella (para el packing list
  // del agente aduanal); si se suman dos líneas, valen las de la primera.
  const porLinea = new Map<string, { cajas: number; medidas: MedidasCaja | null; pesoKg: number | null }>();
  for (const a of asignaciones) {
    const ya = porLinea.get(a.pedidoLineaId);
    porLinea.set(a.pedidoLineaId, {
      cajas: (ya?.cajas ?? 0) + a.cajas,
      medidas: ya?.medidas ?? a.medidas,
      pesoKg: ya?.pesoKg ?? a.pesoKg,
    });
  }

  const r = await asignarCajasAContenedor(
    db,
    accountId,
    { ...datos, numero: casado.numero },
    [...porLinea.entries()].map(([pedidoLineaId, x]) => ({ pedidoLineaId, ...x })),
  );

  // Lo que no entró se queda CON EL CONTENEDOR para que el dueño lo vea en
  // el borrador, elija el renglón del pedido que sí es y lo confirme ahí.
  const pendientes = casado.lineas
    .filter((l) => l.cajasAsignar < l.cajas)
    .map((l) => ({
      modelo: l.modelo,
      color: l.color,
      talla: l.talla,
      cajas: l.cajas - l.cajasAsignar,
      motivo: l.detalle ?? "No amarró con ningún renglón del pedido.",
      // Con el pedido, Contenido sugiere POR ELIMINACIÓN el color que falta.
      pedido: l.pedidoErp ?? l.pedidoArchivo ?? null,
    }));
  await db
    .from("contenedores")
    .update({ pendientes: pendientes.length ? pendientes : null })
    .eq("id", r.contenedorId);

  invalidarInventario(accountId);
  await invalidar(db, accountId, `Se cargó el packing list del contenedor ${r.numero}.`);

  return {
    contenedorId: r.contenedorId,
    numero: r.numero,
    existia: r.existia,
    renglones: porLinea.size,
    cajas: [...porLinea.values()].reduce((a, b) => a + b.cajas, 0),
    omitidos: casado.lineas.length - casado.lineas.filter((l) => l.cajasAsignar > 0).length,
    recortes: r.recortes,
    problemas: problemasDelCasado(casado),
  };
}
