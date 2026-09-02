/**
 * El despacho de TikTok por CORTES.
 *
 * "Hacer corte" es la rutina de las 9 de la mañana: todo lo que está pagado
 * y sin salir se confirma en TikTok de un jalón, queda guardado como un
 * corte numerado, y de ese corte salen dos PDF que se pueden reimprimir
 * cuantas veces haga falta:
 *
 *   · las etiquetas de TikTok, en orden de modelo → color → talla, con
 *     "#n · SKU" estampado abajo a la derecha (lo demás intacto);
 *   · la lista de empaque, en el mismo orden y con los mismos números.
 *
 * TikTok no entrega la guía hasta que el envío está confirmado, así que
 * confirmar primero no es una decisión: es el único orden posible.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { traerTodo, type DB } from "../datos/repos";
import {
  enviarPaquete,
  etiquetaDePaquete,
  paquetesDePedido,
  renglonesDelPaquete,
  type OpcionesEnvio,
} from "../tiktok/api";
import {
  agruparPorModelo,
  numerarPaquetes,
  textoDeEtiqueta,
  type PaqueteDespacho,
  type PaqueteNumerado,
} from "../tiktok/despacho";
import { efectoDeEstado } from "../tiktok/kardex";
import { clienteDeCuenta, sincronizarPedidosPorId } from "./tiktok";

/** Lo que entra en un corte: pagado sin salir, o ya salido pero sin corte. */
const ESTADOS_DESPACHABLES = new Set(["AWAITING_SHIPMENT", "PARTIALLY_SHIPPING", "AWAITING_COLLECTION"]);

export interface ResultadoCorte {
  corteId: number;
  numero: number;
  pedidos: number;
  pares: number;
  errores: { orderId: string; error: string }[];
  publicados: number;
}

/** Los pedidos que entrarían en el siguiente corte. */
export async function pendientesDeCorte(db: DB, accountId: string): Promise<{ orderId: string; estado: string }[]> {
  const filas = await traerTodo<any>(db, "tiktok_ordenes", "order_id, estado, corte_id", (q) =>
    q.eq("account_id", accountId).is("corte_id", null),
  );
  return (filas ?? [])
    .filter((o: any) => ESTADOS_DESPACHABLES.has(String(o.estado).toUpperCase()))
    .map((o: any) => ({ orderId: o.order_id, estado: o.estado }));
}

/**
 * Confirma en TikTok todos los envíos pendientes y los deja en un corte.
 * Un pedido que TikTok rechace se anota y se queda fuera del corte (entra
 * al siguiente cuando se arregle); los demás siguen.
 */
export async function hacerCorte(
  admin: any,
  accountId: string,
  opciones: { handover: OpcionesEnvio["handover"]; creadoPor?: string | null },
): Promise<ResultadoCorte> {
  const cliente = await clienteDeCuenta(admin, accountId, 240_000);
  if (!cliente || !cliente.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");

  const pendientes = await pendientesDeCorte(admin, accountId);
  if (!pendientes.length) throw new Error("No hay pedidos por despachar.");

  const errores: { orderId: string; error: string }[] = [];
  const confirmados: string[] = [];

  for (const p of pendientes) {
    if (cliente.msRestantes() < 30_000) {
      errores.push({ orderId: p.orderId, error: "Se acabó el tiempo; entra al siguiente corte." });
      continue;
    }
    // Lo que ya salió (sin corte) no se vuelve a confirmar: solo se agrupa.
    if (efectoDeEstado(p.estado) === "salida") {
      confirmados.push(p.orderId);
      continue;
    }
    try {
      const paquetes = await paquetesDePedido(cliente, p.orderId);
      if (!paquetes.length) throw new Error("TikTok no tiene paquete para este pedido.");
      for (const pk of paquetes) {
        try {
          await enviarPaquete(cliente, pk.id, { handover: opciones.handover });
        } catch (err) {
          // Si TikTok dice que ya estaba enviado, no es error: es que alguien
          // lo confirmó a mano en el Seller Center.
          const m = (err as Error).message;
          if (!/already|ya .*enviad|shipped|SHIPPED/i.test(m)) throw err;
        }
      }
      confirmados.push(p.orderId);
    } catch (err) {
      errores.push({ orderId: p.orderId, error: (err as Error).message });
    }
  }

  // El número del corte: consecutivo por cuenta.
  const { data: ultimo } = await admin
    .from("tiktok_cortes")
    .select("numero")
    .eq("account_id", accountId)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();
  const numero = (ultimo?.numero ?? 0) + 1;

  // Pares del corte, de los renglones ya guardados.
  const items = confirmados.length
    ? await traerTodo<any>(admin, "tiktok_orden_items", "order_id, cantidad", (q) =>
        q.eq("account_id", accountId).in("order_id", confirmados),
      )
    : [];
  const pares = (items ?? []).reduce((a: number, i: any) => a + (i.cantidad ?? 0), 0);

  const { data: corte, error } = await admin
    .from("tiktok_cortes")
    .insert({
      account_id: accountId,
      numero,
      creado_por: opciones.creadoPor ?? null,
      handover: opciones.handover,
      pedidos: confirmados.length,
      pares,
      errores,
    })
    .select("id")
    .single();
  if (error || !corte) throw new Error(`No se pudo guardar el corte: ${error?.message ?? "sin id"}`);

  if (confirmados.length) {
    await admin
      .from("tiktok_ordenes")
      .update({ corte_id: corte.id })
      .eq("account_id", accountId)
      .in("order_id", confirmados);
  }

  // Una sola relectura para todos: TikTok ya los tiene en AWAITING_COLLECTION,
  // eso genera las salidas del kardex y republica el disponible.
  let publicados = 0;
  if (confirmados.length) {
    const r = await sincronizarPedidosPorId(admin, accountId, confirmados);
    publicados = r.publicados;
  }

  return { corteId: corte.id, numero, pedidos: confirmados.length, pares, errores, publicados };
}

// ---------------------------------------------------------------------------
// Los paquetes de un corte, ya ordenados y numerados
// ---------------------------------------------------------------------------

export interface CorteCargado {
  id: number;
  numero: number;
  creadoEn: string;
  paquetes: PaqueteNumerado[];
}

export async function cargarCorte(admin: any, accountId: string, corteId: number): Promise<CorteCargado> {
  const { data: corte } = await admin
    .from("tiktok_cortes")
    .select("id, numero, creado_en")
    .eq("account_id", accountId)
    .eq("id", corteId)
    .maybeSingle();
  if (!corte) throw new Error("Ese corte no existe.");

  const [ordenes, items] = await Promise.all([
    traerTodo<any>(admin, "tiktok_ordenes", "order_id, paquetes, detalle", (q) =>
      q.eq("account_id", accountId).eq("corte_id", corteId),
    ),
    traerTodo<any>(admin, "tiktok_orden_items", "order_id, line_item_id, sku_interno, seller_sku, cantidad", (q) =>
      q.eq("account_id", accountId),
    ),
  ]);
  const ordenIds = new Set((ordenes ?? []).map((o: any) => o.order_id));
  const itemsPorOrden = new Map<string, any[]>();
  for (const i of items ?? []) {
    if (!ordenIds.has(i.order_id)) continue;
    const l = itemsPorOrden.get(i.order_id) ?? [];
    l.push(i);
    itemsPorOrden.set(i.order_id, l);
  }

  const cliente = await clienteDeCuenta(admin, accountId, 120_000);
  const paquetes: PaqueteDespacho[] = [];

  for (const o of ordenes ?? []) {
    let ids: string[] = ((o.paquetes ?? []) as any[]).map((p) => String(p.id));
    if (!ids.length && cliente) {
      const desdeTikTok = await paquetesDePedido(cliente, o.order_id);
      ids = desdeTikTok.map((p) => p.id);
      if (ids.length) {
        await admin
          .from("tiktok_ordenes")
          .update({ paquetes: desdeTikTok })
          .eq("account_id", accountId)
          .eq("order_id", o.order_id);
      }
    }

    const renglones = itemsPorOrden.get(o.order_id) ?? [];
    const aPar = (lista: any[]) => {
      const porSku = new Map<string, number>();
      for (const r of lista) {
        const sku = r.sku_interno ?? r.seller_sku ?? "(sin SKU)";
        porSku.set(sku, (porSku.get(sku) ?? 0) + (r.cantidad ?? 1));
      }
      return [...porSku].map(([sku, pares]) => ({ sku, pares }));
    };

    if (ids.length <= 1) {
      paquetes.push({
        orderId: o.order_id,
        packageId: ids[0] ?? "",
        destinatario: o.detalle?.destinatario ?? null,
        pares: aPar(renglones),
      });
      continue;
    }

    // Varios paquetes: cada uno lleva sus propios renglones. Si TikTok no
    // dice cuáles, se estampan todos en cada etiqueta antes que adivinar.
    for (const id of ids) {
      let propios = renglones;
      try {
        const lineIds = cliente ? await renglonesDelPaquete(cliente, id) : [];
        if (lineIds.length) {
          const set = new Set(lineIds);
          propios = renglones.filter((r) => set.has(String(r.line_item_id)));
        }
      } catch {
        /* se estampan todos */
      }
      paquetes.push({
        orderId: o.order_id,
        packageId: id,
        destinatario: o.detalle?.destinatario ?? null,
        pares: aPar(propios.length ? propios : renglones),
      });
    }
  }

  return { id: corte.id, numero: corte.numero, creadoEn: corte.creado_en, paquetes: numerarPaquetes(paquetes) };
}

// ---------------------------------------------------------------------------
// PDF de etiquetas: las de TikTok, en orden, con "#n · SKU" abajo a la derecha
// ---------------------------------------------------------------------------

/** Tamaño A6 en puntos, por si la guía llega como imagen y hay que darle hoja. */
const A6: [number, number] = [297.64, 419.53];

/** Dónde va el estampado: abajo a la derecha, pegado al borde. */
const ESTAMPA = { margen: 6, tamano: 7 };

export async function pdfEtiquetasDelCorte(admin: any, accountId: string, corteId: number): Promise<Uint8Array> {
  const corte = await cargarCorte(admin, accountId, corteId);
  const cliente = await clienteDeCuenta(admin, accountId, 240_000);
  if (!cliente || !cliente.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");

  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Corte ${corte.numero} · etiquetas TikTok`);

  const estampar = (pagina: any, texto: string) => {
    const ancho = fuente.widthOfTextAtSize(texto, ESTAMPA.tamano);
    const { width } = pagina.getSize();
    pagina.drawText(texto, {
      x: Math.max(ESTAMPA.margen, width - ESTAMPA.margen - ancho),
      y: ESTAMPA.margen,
      size: ESTAMPA.tamano,
      font: fuente,
      color: rgb(0, 0, 0),
    });
  };

  for (const p of corte.paquetes) {
    const texto = textoDeEtiqueta(p);
    let bytes: Uint8Array | null = null;
    let error: string | null = null;

    try {
      if (!p.packageId) throw new Error("sin paquete en TikTok");
      const url = await etiquetaDePaquete(cliente, p.packageId);
      if (!url) throw new Error("TikTok no devolvió la guía");
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`descarga ${r.status}`);
      bytes = new Uint8Array(await r.arrayBuffer());
    } catch (err) {
      error = (err as Error).message;
    }

    if (bytes && esPdf(bytes)) {
      const origen = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copias = await doc.copyPages(origen, origen.getPageIndices());
      for (const pagina of copias) {
        doc.addPage(pagina);
        estampar(pagina, texto);
      }
      continue;
    }

    if (bytes && (esPng(bytes) || esJpg(bytes))) {
      const img = esPng(bytes) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const pagina = doc.addPage(A6);
      const escala = Math.min(A6[0] / img.width, A6[1] / img.height);
      const w = img.width * escala;
      const h = img.height * escala;
      pagina.drawImage(img, { x: (A6[0] - w) / 2, y: A6[1] - h, width: w, height: h });
      estampar(pagina, texto);
      continue;
    }

    // Sin guía: una hoja que lo diga, para que la numeración no se corra.
    const pagina = doc.addPage(A6);
    pagina.drawText(`SIN GUÍA — pedido ${p.orderId}`, { x: 20, y: A6[1] - 60, size: 12, font: fuente });
    pagina.drawText(error ?? "formato desconocido", { x: 20, y: A6[1] - 80, size: 8, font: fuente });
    estampar(pagina, texto);
  }

  return doc.save();
}

function esPdf(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
}
function esPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}
function esJpg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

// ---------------------------------------------------------------------------
// PDF de la lista de empaque: por modelo, mismos números
// ---------------------------------------------------------------------------

export async function pdfListaDelCorte(admin: any, accountId: string, corteId: number): Promise<Uint8Array> {
  const corte = await cargarCorte(admin, accountId, corteId);
  const grupos = agruparPorModelo(corte.paquetes);

  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Corte ${corte.numero} · lista de empaque`);

  const CARTA: [number, number] = [612, 792];
  const M = 40;
  let pagina = doc.addPage(CARTA);
  let y = CARTA[1] - M;

  const fecha = new Date(corte.creadoEn).toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const totalPares = grupos.reduce((a, g) => a + g.pares, 0);

  const linea = (texto: string, size: number, f = normal, x = M) => {
    if (y < M + size) {
      pagina = doc.addPage(CARTA);
      y = CARTA[1] - M;
    }
    pagina.drawText(texto, { x, y, size, font: f });
    y -= size + 4;
  };

  linea(`Corte #${corte.numero} · TikTok Shop`, 16, negrita);
  linea(`${fecha} · ${corte.paquetes.length} paquetes · ${totalPares} pares`, 10);
  y -= 6;
  linea("Resumen por modelo", 11, negrita);
  for (const g of grupos) linea(`${g.modelo}: ${g.pares} pares en ${g.paquetes.length} paquetes`, 10);
  y -= 8;

  for (const g of grupos) {
    y -= 4;
    linea(`${g.modelo} — ${g.pares} pares`, 12, negrita);
    for (const p of g.paquetes) {
      const skus = p.pares.map((x) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ");
      const dest = p.destinatario ? `  ·  ${p.destinatario}` : "";
      linea(`#${p.numero}   ${skus}   ·  pedido ${p.orderId}${dest}`, 9);
    }
  }

  return doc.save();
}
