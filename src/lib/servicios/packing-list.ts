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
import type { LineaPacking, PackingList } from "../importar/packing-list";
import { canonizar, claveAplastada, claveComparacion, construirSkuMeli } from "../importar/sku";
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

function claveRenglon(pedido: string | null, modelo: string, color: string, talla: string | null): string {
  return `${pedido ? canonizar(pedido) : ""}|${canonizar(modelo)}|${claveColor(color)}|${talla ?? ""}`;
}

/** Los renglones de los pedidos vivos de la cuenta, con lo ya embarcado. */
async function cargarRenglones(db: DB, accountId: string) {
  const { data: pedidos } = await db
    .from("pedidos")
    .select("id, pedido, estado, creado_en")
    .eq("account_id", accountId)
    .neq("estado", "cancelado");

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

  const { renglones, idPorPedido, asignado } = await cargarRenglones(db, accountId);

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
  for (const r of renglones) {
    porClave.set(claveRenglon(r.pedido, r.modelo, r.color, r.talla || null), r);
    const sku = claveComparacion(construirSkuMeli(r.modelo, r.color, r.talla));
    const lista = porSku.get(sku) ?? [];
    lista.push(r);
    porSku.set(sku, lista);
  }
  const buscarLibre = (modelo: string, color: string, talla: string | null, sku?: string) => {
    // Sin pedido en el archivo: los renglones de cualquier pedido vivo con
    // ese producto, del más viejo al más nuevo.
    const clave = sku ? claveComparacion(sku) : claveComparacion(construirSkuMeli(modelo, color, talla ?? ""));
    const candidatos = porSku.get(clave) ?? [];
    return candidatos
      .filter((r) => r.cajas - enOtrosDe(r.id) > 0)
      .sort((a, b) => a.pedidoOrden - b.pedidoOrden);
  };

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
    };

    if (l.pedido) {
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
    const libres = buscarLibre(l.modelo, l.color, l.talla, l.sku);
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
}> {
  if (!casado.numero) throw new Error("Falta el número de contenedor.");

  const asignaciones = casado.lineas
    .filter((l) => l.pedidoLineaId && l.cajasAsignar > 0)
    .map((l) => ({ pedidoLineaId: l.pedidoLineaId as string, cajas: l.cajasAsignar }));

  if (!asignaciones.length) {
    throw new Error("Ningún renglón del packing list se pudo amarrar con un pedido cargado.");
  }

  // Dos líneas del archivo que caen en el MISMO renglón de pedido se suman:
  // la asignación es "cuántas cajas de este renglón van en este contenedor".
  const porLinea = new Map<string, number>();
  for (const a of asignaciones) {
    porLinea.set(a.pedidoLineaId, (porLinea.get(a.pedidoLineaId) ?? 0) + a.cajas);
  }

  const r = await asignarCajasAContenedor(
    db,
    accountId,
    { ...datos, numero: casado.numero },
    [...porLinea.entries()].map(([pedidoLineaId, cajas]) => ({ pedidoLineaId, cajas })),
  );

  invalidarInventario(accountId);
  await invalidar(db, accountId, `Se cargó el packing list del contenedor ${r.numero}.`);

  return {
    contenedorId: r.contenedorId,
    numero: r.numero,
    existia: r.existia,
    renglones: porLinea.size,
    cajas: [...porLinea.values()].reduce((a, b) => a + b, 0),
    omitidos: casado.lineas.length - casado.lineas.filter((l) => l.cajasAsignar > 0).length,
    recortes: r.recortes,
  };
}
