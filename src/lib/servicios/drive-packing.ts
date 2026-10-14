/**
 * Packing lists desde la carpeta de Drive de la fábrica (decisión del
 * dueño, 9-sep-2026): una vez al día se leen los archivos nuevos o
 * cambiados, cada uno se casa contra los pedidos cargados y entra como
 * contenedor en estado BORRADOR; el dueño lo revisa, edita y confirma en
 * /contenedores. Un botón vuelve a sincronizar cuando haga falta.
 *
 * Reglas:
 *  - Solo hojas de cálculo. Lo que el lector no entiende queda en `error`.
 *  - Solo calzado: si ningún renglón amarra con un pedido cargado (los
 *    packing lists de fundas no tienen pedido aquí), queda `omitido`.
 *  - Un contenedor que el dueño ya confirmó (estado distinto de borrador)
 *    NO se toca aunque el archivo cambie: queda `omitido` con su motivo.
 *  - Subir el mismo archivo dos veces no duplica: se reemplaza lo de ese
 *    contenedor (misma regla que la carga a mano).
 *  - Al crear un contenedor nuevo se manda el correo de fotos que faltan.
 *  - El BL de la misma carpeta es el número de control (11-oct-2026): se lee
 *    el PDF (`importar/bl.ts`) y sus cajas quedan en `contenedores.cajas_bl`
 *    para que la pantalla compare contra lo cargado.
 *  - Un BORRADOR se vuelve a leer con «Releer todo» aunque su embarque sea
 *    anterior al último cargado: los arreglos del lector y del amarre tienen
 *    que poder llegarle (S260-2026 se quedó con 399 de 611 cajas).
 */
import type { DB } from "../datos/repos";
import { importarPackingList } from "../importar/packing-list";
import { cajasDelBl, leerBl } from "../importar/bl";
import { textoDePdf } from "../importar/texto-pdf";
import { aplicarPackingList, casarPackingList } from "./packing-list";
import { configDrive, descargarDrive, esHojaDeCalculo, listarCarpetaDrive, type ArchivoDrive } from "./drive";
import { avisarFotosDeContenedor } from "./fotos-contenedor";
import { invalidar } from "./cache";

export type EstadoDrivePacking = "importado" | "omitido" | "error";

export interface ResultadoDrivePacking {
  sinConfigurar: boolean;
  archivos: number;
  revisados: number;
  importados: string[];
  omitidos: string[];
  errores: string[];
  correos: { contenedor: string; enviado: boolean; motivo?: string }[];
  /** BL leídos: «S260-2026: 611 cajas (archivo)» */
  bls: string[];
}

export interface FilaGuardada {
  drive_file_id: string;
  md5: string | null;
  modificado_en: string | null;
  estado: string;
}

/**
 * ¿Cambió el archivo desde la última vez? Con llave hay md5; en el camino
 * público solo la fecha del listado (sin hora): mismo día = sin cambio, y
 * "Releer todo" pasa por encima.
 */
export function cambio(a: ArchivoDrive, g: FilaGuardada | undefined): boolean {
  if (!g) return true;
  if (a.md5 && g.md5) return a.md5 !== g.md5;
  const nuevo = a.modificadoEn ? a.modificadoEn.slice(0, 10) : null;
  const previo = g.modificado_en ? new Date(g.modificado_en).toISOString().slice(0, 10) : null;
  return nuevo !== previo;
}

/** Archivo de un contenedor que se borró: se vuelve a leer en la siguiente pasada. */
export const ESTADO_RELEER = "releer";

/** "S259-2026 PACKING LIST.xlsx" → 259; "S 260" → 260; sin forma de embarque → null. */
export function numeroDeEmbarque(texto: string | null | undefined): number | null {
  const m = (texto ?? "").toUpperCase().match(/(?:^|[^A-Z0-9])S\s*-?\s*(\d{2,4})(?![0-9])/);
  return m ? Number(m[1]) : null;
}

export interface ContenedorCargado {
  id: string;
  numero: string;
  estado: string;
  embarque: number | null;
  /** número ISO de la naviera (MIEU3920536) */
  naviera?: string | null;
}

/** Los contenedores ya cargados con su número de embarque, y el más alto (de ahí para adelante se importa). */
export async function contenedoresCargados(admin: DB, accountId: string): Promise<{ lista: ContenedorCargado[]; maximo: number | null }> {
  const { data } = await admin.from("contenedores").select("id, numero, estado, numero_naviera").eq("account_id", accountId);
  const lista: ContenedorCargado[] = (data ?? []).map((c: { id: string; numero: string; estado: string; numero_naviera: string | null }) => ({
    id: c.id,
    numero: c.numero,
    estado: c.estado,
    embarque: numeroDeEmbarque(c.numero),
    naviera: c.numero_naviera ? c.numero_naviera.trim().toUpperCase() : null,
  }));
  let maximo: number | null = null;
  for (const c of lista) if (c.embarque != null && (maximo == null || c.embarque > maximo)) maximo = c.embarque;
  return { lista, maximo };
}

export async function embarqueMaximo(admin: DB, accountId: string): Promise<number | null> {
  return (await contenedoresCargados(admin, accountId)).maximo;
}

/**
 * El contenedor ya cargado que corresponde a un embarque: por el texto
 * exacto o por el NÚMERO de embarque ("S259" y "S259-2026" son el mismo;
 * el 10-sep-2026 Drive duplicó S259 por compararlos como texto).
 */
export function contenedorDelEmbarque(lista: ContenedorCargado[], numero: string): ContenedorCargado | null {
  const exacto = lista.find((c) => c.numero.trim().toUpperCase() === numero.trim().toUpperCase());
  if (exacto) return exacto;
  const n = numeroDeEmbarque(numero);
  return n == null ? null : (lista.find((c) => c.embarque === n) ?? null);
}

/**
 * La referencia del embarque (S271-2026) del nombre de la subcarpeta o del
 * archivo, para los packing lists que no la traen adentro (S270, S271:
 * «Packing List (Container: HAMU5029953 …)» sin la S); antes el contenedor
 * quedaba bautizado con el número de la naviera.
 */
export function referenciaDeNombre(...textos: (string | null | undefined)[]): string | null {
  for (const t of textos) {
    const m = String(t ?? "").toUpperCase().match(/(?:^|[^A-Z0-9])S\s*-?\s*(\d{2,4})\s*-\s*(20\d{2})(?![0-9])/);
    if (m) return `S${m[1]}-${m[2]}`;
  }
  return null;
}

/**
 * A qué contenedor va un packing list: primero por el número ISO de la
 * naviera, luego por la referencia del embarque (texto o número: S259 =
 * S259-2026). Un contenedor que quedó bautizado con el ISO (S270, S271, que
 * no traen la referencia adentro) se RENOMBRA a la referencia, salvo que ya
 * exista otro con ese nombre. Dos archivos con la misma referencia caen en
 * el mismo contenedor: el S261-2026 trae dos packing lists IDÉNTICOS que
 * solo cambian el ISO (HMMU6173610 / HMMU6173810) y su BL dice 542 cajas para
 * uno solo; separarlos duplicaría cajas.
 */
export function elegirContenedor(
  lista: ContenedorCargado[],
  referencia: string | null,
  iso: string | null,
): { existente: ContenedorCargado | null; numero: string; renombrar: string | null } {
  const ref = referencia?.trim().toUpperCase() || null;
  const cont = iso?.trim().toUpperCase() || null;
  // El ISO primero: es único por contenedor y no lo comparte un duplicado.
  if (cont) {
    const porIso = lista.find((c) => c.naviera === cont || c.numero.trim().toUpperCase() === cont);
    if (porIso) {
      const ocupado = ref ? lista.some((c) => c !== porIso && c.numero.trim().toUpperCase() === ref) : true;
      const renombrar = ref && porIso.embarque == null && !ocupado ? ref : null;
      return { existente: porIso, numero: renombrar ?? porIso.numero, renombrar };
    }
  }
  const porRef = ref ? contenedorDelEmbarque(lista, ref) : null;
  if (porRef) return { existente: porRef, numero: porRef.numero, renombrar: null };
  return { existente: null, numero: ref || cont || "", renombrar: null };
}

/** Un PDF de la carpeta que puede ser el BL (no la proforma ni el pago). */
export function puedeSerBl(nombre: string): boolean {
  return /\.pdf$/i.test(nombre) && !/\bPI\b|invoice|factura|payment|proforma/i.test(nombre);
}

/**
 * Facturas, pagos, bolsas y PROFORMAS de pedidos que viajan en la misma
 * carpeta y no son packing list: ni se descargan. La proforma se llama por
 * su pedido («IN10148 (GT114).xls», «AR10137 (GT148G).xls»); el 11-oct-2026,
 * al tomar la referencia de la carpeta, las proformas entraron como packing
 * lists: duplicaron S263, S268 y S271 y le sumaron cajas a S266, S267 y S269.
 */
export function esArchivoAjeno(nombre: string): boolean {
  if (/packing/i.test(nombre)) return false;
  return /invoice|factura|proforma|payment|courier|\bPI\b/i.test(nombre) || /^\s*(IN|AR)\s*-?\d{4,}/i.test(nombre);
}

/**
 * Regla del dueño (10-sep-2026): la carpeta trae la historia completa; solo
 * se jalan los embarques POSTERIORES al último que ya está cargado (si el
 * último es S259, S258 y anteriores no se tocan). Lo que no trae número de
 * embarque se decide por el amarre con pedidos, como antes.
 */
export function esEmbarqueViejo(numero: number | null, maximo: number | null): boolean {
  return numero != null && maximo != null && numero < maximo;
}

export async function sincronizarPackingListsDrive(
  admin: DB,
  accountId: string,
  opts: { finMs: number; forzar?: boolean },
): Promise<ResultadoDrivePacking> {
  const r: ResultadoDrivePacking = { sinConfigurar: false, archivos: 0, revisados: 0, importados: [], omitidos: [], errores: [], correos: [], bls: [] };
  // Sin llave se lee la carpeta pública (decisión del dueño); con llave, el API.
  const cfg = configDrive();

  // Los packing lists viven en subcarpetas por contenedor: a las de embarques
  // anteriores al último cargado ni se entra.
  const { lista: cargados, maximo } = await contenedoresCargados(admin, accountId);
  const { data: guardadas } = await admin
    .from("drive_packing_lists")
    .select("drive_file_id, md5, modificado_en, estado, nombre, contenedor_id, resultado")
    .eq("account_id", accountId);
  const previa = new Map((guardadas ?? []).map((g: FilaGuardada) => [g.drive_file_id, g]));
  // Los embarques con un BORRADOR (por su número o por la carpeta de donde
  // salió) se siguen leyendo aunque sean anteriores al último cargado.
  const borradores = new Set(cargados.filter((c) => c.estado === "borrador").map((c) => c.id));
  const embarquesBorrador = new Set<number>();
  for (const c of cargados) if (c.estado === "borrador" && c.embarque != null) embarquesBorrador.add(c.embarque);
  for (const g of (guardadas ?? []) as { nombre: string | null; contenedor_id: string | null; estado: string }[]) {
    // Un contenedor BORRADO desde la pantalla deja sus archivos en «releer»:
    // su embarque vuelve a entrar aunque sea anterior al último cargado
    // (S265 y S271 el 13-oct-2026: se borraron y «Traer de Drive» ya no los traía).
    const delBorrador = g.contenedor_id && borradores.has(g.contenedor_id);
    const n = delBorrador || g.estado === ESTADO_RELEER ? numeroDeEmbarque(String(g.nombre ?? "").split("/")[0]) : null;
    if (n != null) embarquesBorrador.add(n);
  }
  const viejo = (n: number | null) => esEmbarqueViejo(n, maximo) && !(n != null && embarquesBorrador.has(n));
  // Un borrador que alguien ya CORRIGIÓ a mano en Contenido (sus cajas ya no
  // son las que entraron desde Drive) no se vuelve a armar: rearmarlo
  // borraría esas decisiones (S263-2026 tenía 232 cajas confirmadas a mano).
  const cajasDeDrive = new Map<string, number>();
  for (const g of (guardadas ?? []) as { contenedor_id: string | null; estado: string; resultado: { cajas?: number } | null }[]) {
    if (g.contenedor_id && g.estado === "importado" && typeof g.resultado?.cajas === "number") {
      cajasDeDrive.set(g.contenedor_id, Math.max(cajasDeDrive.get(g.contenedor_id) ?? 0, g.resultado.cajas));
    }
  }
  const cajasActuales = new Map<string, number>();
  const idsBorrador = [...borradores];
  if (idsBorrador.length) {
    const { data: lineasBorrador } = await admin.from("contenedor_lineas").select("contenedor_id, cajas").in("contenedor_id", idsBorrador);
    for (const l of (lineasBorrador ?? []) as { contenedor_id: string; cajas: number | null }[]) {
      cajasActuales.set(l.contenedor_id, (cajasActuales.get(l.contenedor_id) ?? 0) + (l.cajas ?? 0));
    }
  }
  const editadoAMano = (id: string) => cajasDeDrive.has(id) && (cajasActuales.get(id) ?? 0) !== cajasDeDrive.get(id);
  const todos = await listarCarpetaDrive(cfg, { omitirCarpeta: (nombre) => viejo(numeroDeEmbarque(nombre)) });
  const archivos = todos.filter(esHojaDeCalculo);
  r.archivos = archivos.length;

  const registrar = async (a: ArchivoDrive, estado: EstadoDrivePacking, motivo: string | null, extra: Record<string, unknown> = {}) => {
    await admin.from("drive_packing_lists").upsert(
      {
        account_id: accountId,
        drive_file_id: a.id,
        nombre: a.carpeta ? `${a.carpeta}/${a.nombre}` : a.nombre,
        md5: a.md5,
        modificado_en: a.modificadoEn || null,
        procesado_en: new Date().toISOString(),
        estado,
        motivo,
        ...extra,
      },
      { onConflict: "account_id,drive_file_id" },
    );
  };

  let huboCambios = false;
  // El BL se lee al final y necesita su rato: los packing lists paran antes.
  const finPacking = opts.finMs - 45_000;
  for (const a of archivos) {
    if (Date.now() > finPacking) break;
    if (!opts.forzar && previa.get(a.id)?.estado !== ESTADO_RELEER && !cambio(a, previa.get(a.id))) continue;
    // Por la subcarpeta o el nombre, sin descargar: un embarque anterior al
    // último cargado no se toca.
    const porNombre = numeroDeEmbarque(a.carpeta) ?? numeroDeEmbarque(a.nombre);
    if (viejo(porNombre)) {
      if (!previa.has(a.id) || opts.forzar) {
        await registrar(a, "omitido", `S${porNombre} es anterior al último embarque cargado (S${maximo}); no se importa.`);
        r.omitidos.push(`${a.nombre}: anterior a S${maximo}`);
      }
      continue;
    }
    if (esArchivoAjeno(a.nombre)) {
      if (!previa.has(a.id) || opts.forzar) {
        await registrar(a, "omitido", "No es un packing list (factura o pedido de la misma carpeta).");
        r.omitidos.push(`${a.nombre}: no es packing list`);
      }
      continue;
    }
    r.revisados++;
    try {
      const buffer = await descargarDrive(cfg, a);
      let packing;
      try {
        packing = await importarPackingList(buffer, { nombre: a.nombre });
      } catch (err) {
        // Un Excel que el lector no entiende y que ni se llama packing list
        // es otra cosa (el pedido, la factura): se omite sin marcarlo error.
        if (!/packing/i.test(a.nombre)) {
          await registrar(a, "omitido", `No parece packing list: ${(err as Error).message.slice(0, 200)}`);
          r.omitidos.push(`${a.nombre}: no parece packing list`);
          continue;
        }
        throw err;
      }
      // Sin referencia adentro (S270, S271), la de la carpeta o el nombre;
      // solo si el archivo es un packing list de verdad (se llama así o trae el
      // número del contenedor): una proforma no trae ninguno de los dos.
      const pareceDePacking = /packing/i.test(a.nombre) || Boolean(packing.contenedor);
      const referencia = packing.referencia || (pareceDePacking ? referenciaDeNombre(a.carpeta, a.nombre) : null);
      const numeroLeido = (referencia || packing.contenedor || "").trim().toUpperCase();
      if (!numeroLeido) {
        if (!/packing/i.test(a.nombre)) {
          await registrar(a, "omitido", "No parece packing list: no trae la referencia del embarque ni el contenedor.");
          r.omitidos.push(`${a.nombre}: no parece packing list`);
          continue;
        }
        await registrar(a, "error", "El archivo no trae la referencia del embarque ni el contenedor.");
        r.errores.push(`${a.nombre}: sin número de contenedor`);
        continue;
      }
      // Si el embarque ya está cargado con otro texto ("S259" a mano y
      // "S259-2026" en el archivo), se trabaja sobre ESE contenedor; el ISO
      // de la naviera manda para no pisar al gemelo de la misma referencia.
      const eleccion = elegirContenedor(cargados, referencia, packing.contenedor);
      const yaCargado = eleccion.existente;
      const numero = eleccion.numero.trim().toUpperCase() || numeroLeido;
      const porReferencia = numeroDeEmbarque(numero);
      if (viejo(porReferencia) && !(yaCargado && yaCargado.estado === "borrador")) {
        await registrar(a, "omitido", `${numero} es anterior al último embarque cargado (S${maximo}); no se importa.`);
        r.omitidos.push(`${a.nombre}: ${numero} anterior a S${maximo}`);
        continue;
      }
      if (yaCargado && yaCargado.estado === "borrador" && editadoAMano(yaCargado.id)) {
        if (eleccion.renombrar) {
          await admin.from("contenedores").update({ numero: eleccion.renombrar }).eq("id", yaCargado.id);
          yaCargado.numero = eleccion.renombrar;
          yaCargado.embarque = numeroDeEmbarque(eleccion.renombrar);
        }
        // No se rearma (borraría lo confirmado a mano), pero SÍ se le agregan
        // los renglones del pedido que el archivo trae y el contenedor aún no
        // tiene: un arreglo del lector (S263-2026, GT114 con talla «39 (26)»)
        // tiene que llegar también aquí. Sin tocar su renglón de la bitácora:
        // sigue diciendo con cuántas cajas entró desde Drive, que es justo lo
        // que delata el cambio a mano.
        const casadoMano = await casarPackingList(admin, accountId, packing, yaCargado.numero);
        const nuevos = casadoMano.lineas.some((l) => l.pedidoLineaId && l.cajasAsignar > 0)
          ? await aplicarPackingList(
              admin,
              accountId,
              casadoMano,
              { numeroNaviera: packing.contenedor || null, estado: "borrador", notas: `Borrador desde Drive: ${a.nombre}` },
              { soloNuevas: true },
            )
          : null;
        if (nuevos?.renglones) {
          huboCambios = true;
          r.importados.push(`${a.nombre} → ${yaCargado.numero}: con cambios a mano; se agregaron ${nuevos.cajas} cajas en ${nuevos.renglones} renglones nuevos`);
        } else {
          r.omitidos.push(`${a.nombre}: ${yaCargado.numero} con cambios a mano, nada nuevo que agregar`);
        }
        continue;
      }
      if (eleccion.renombrar && yaCargado && yaCargado.estado === "borrador") {
        // Quedó bautizado con el ISO de la naviera: toma la referencia del embarque.
        await admin.from("contenedores").update({ numero: eleccion.renombrar }).eq("id", yaCargado.id);
        yaCargado.numero = eleccion.renombrar;
        yaCargado.embarque = numeroDeEmbarque(eleccion.renombrar);
      }
      const casado = await casarPackingList(admin, accountId, packing, yaCargado && yaCargado.estado !== "borrador" ? yaCargado.numero : numero);
      const amarrados = casado.lineas.filter((l) => l.pedidoLineaId && l.cajasAsignar > 0);
      if (!amarrados.length) {
        await registrar(a, "omitido", "Ningún renglón amarra con un pedido de calzado cargado (¿es de fundas, o falta cargar el pedido?).", {
          resultado: { avisos: casado.avisos?.slice(0, 20) ?? [] },
        });
        r.omitidos.push(`${a.nombre}: sin pedido que amarre`);
        continue;
      }
      if (yaCargado && yaCargado.estado !== "borrador") {
        await registrar(a, "omitido", `El contenedor ${numero} ya está confirmado (${yaCargado.estado}); no se toca.`, {
          contenedor_id: yaCargado.id,
        });
        r.omitidos.push(`${a.nombre}: ${numero} ya confirmado`);
        continue;
      }
      const aplicado = await aplicarPackingList(
        admin,
        accountId,
        casado,
        {
          numeroNaviera: packing.contenedor || null,
          estado: "borrador",
          notas: `Borrador desde Drive: ${a.nombre}`,
        },
        // Rearmar un borrador desde su packing list deja SOLO lo del archivo:
        // asignar cajas agrega o actualiza renglones pero no quita los viejos.
        { reemplazar: true },
      );
      huboCambios = true;
      if (!aplicado.existia) cargados.push({ id: aplicado.contenedorId, numero: aplicado.numero, estado: "borrador", embarque: numeroDeEmbarque(aplicado.numero) });
      // Lo que NO entró se guarda POR RENGLÓN y sube al motivo: el dueño
      // tiene que poder ver que faltan cajas sin abrir la base (S260-2026,
      // 10-sep-2026: entraron 399 de 611 cajas y solo se guardó "omitidos: 3").
      const faltan = aplicado.problemas.length;
      await registrar(
        a,
        "importado",
        faltan ? `Entró con ${faltan} renglón(es) que no cupieron completos; revisa el contenido.` : null,
        {
          contenedor_id: aplicado.contenedorId,
          resultado: {
            renglones: aplicado.renglones,
            cajas: aplicado.cajas,
            cajasArchivo: casado.totales.cajasArchivo,
            omitidos: aplicado.omitidos,
            recortes: aplicado.recortes.slice(0, 20),
            problemas: aplicado.problemas.slice(0, 40),
            avisos: casado.avisos?.slice(0, 20) ?? [],
          },
        },
      );
      r.importados.push(
        `${a.nombre} → ${aplicado.numero} (${aplicado.cajas} de ${casado.totales.cajasArchivo} cajas, ${aplicado.renglones} renglones)`,
      );
      if (!aplicado.existia) {
        const correo = await avisarFotosDeContenedor(admin, accountId, aplicado.contenedorId);
        r.correos.push({ contenedor: aplicado.numero, enviado: correo.enviado, motivo: correo.motivo });
      }
    } catch (err) {
      const msg = (err as Error).message.slice(0, 300);
      await registrar(a, "error", msg);
      r.errores.push(`${a.nombre}: ${msg}`);
    }
  }

  if (huboCambios) {
    await invalidar(admin, accountId, "Entraron packing lists desde Drive.").catch(() => undefined);
  }
  await leerBlsDeContenedores(admin, accountId, cfg, todos, opts, r).catch((err) => {
    r.errores.push(`BL: ${(err as Error).message.slice(0, 200)}`);
  });
  return r;
}

/** Sin BL encontrado, no se vuelve a buscar en la misma carpeta hasta el día siguiente. */
const HORAS_REINTENTO_BL = 20;

/**
 * El BL de cada contenedor vivo, de la misma subcarpeta que su packing list
 * (o la del mismo número de embarque). Se lee una vez; «Releer todo» lo
 * vuelve a leer. Un PDF que no trae el número de cajas (proforma, factura)
 * se brinca solo.
 */
async function leerBlsDeContenedores(
  admin: DB,
  accountId: string,
  cfg: ReturnType<typeof configDrive>,
  todos: ArchivoDrive[],
  opts: { finMs: number; forzar?: boolean },
  r: ResultadoDrivePacking,
): Promise<void> {
  const pdfs = new Map<string, ArchivoDrive[]>();
  for (const a of todos) {
    if (!a.carpeta || !puedeSerBl(a.nombre)) continue;
    const l = pdfs.get(a.carpeta) ?? [];
    l.push(a);
    pdfs.set(a.carpeta, l);
  }
  if (!pdfs.size) return;
  const [{ data: conts }, { data: filas }] = await Promise.all([
    admin
      .from("contenedores")
      .select("id, numero, numero_naviera, estado, cajas_bl, bl_leido_en")
      .eq("account_id", accountId)
      .neq("estado", "recibido"),
    admin.from("drive_packing_lists").select("nombre, contenedor_id").eq("account_id", accountId).not("contenedor_id", "is", null),
  ]);
  const carpetaDe = new Map<string, string>();
  for (const f of (filas ?? []) as { nombre: string; contenedor_id: string }[]) {
    const carpeta = String(f.nombre ?? "").includes("/") ? String(f.nombre).split("/")[0] : null;
    if (carpeta && !carpetaDe.has(f.contenedor_id)) carpetaDe.set(f.contenedor_id, carpeta);
  }
  const carpetas = [...pdfs.keys()];
  const leidos = new Map<string, string>();
  for (const c of (conts ?? []) as {
    id: string;
    numero: string;
    numero_naviera: string | null;
    cajas_bl: number | null;
    bl_leido_en: string | null;
  }[]) {
    if (Date.now() > opts.finMs) break;
    if (!opts.forzar && c.cajas_bl != null) continue;
    if (!opts.forzar && c.bl_leido_en && Date.now() - Date.parse(c.bl_leido_en) < HORAS_REINTENTO_BL * 3_600_000) continue;
    const embarque = numeroDeEmbarque(c.numero);
    const carpeta =
      carpetaDe.get(c.id) ?? carpetas.find((k) => embarque != null && numeroDeEmbarque(k) === embarque) ?? null;
    if (!carpeta || !pdfs.has(carpeta)) continue;
    let encontrado: { cajas: number; archivo: string } | null = null;
    for (const a of pdfs.get(carpeta)!) {
      if (Date.now() > opts.finMs) break;
      try {
        let texto = leidos.get(a.id);
        if (texto == null) {
          texto = await textoDePdf(await descargarDrive(cfg, a));
          leidos.set(a.id, texto);
        }
        const cajas = cajasDelBl(leerBl(texto), c.numero_naviera);
        if (cajas) {
          encontrado = { cajas, archivo: `${carpeta}/${a.nombre}` };
          break;
        }
      } catch {
        /* un PDF ilegible no es el BL; se prueba el siguiente */
      }
    }
    await admin
      .from("contenedores")
      .update(
        encontrado
          ? { cajas_bl: encontrado.cajas, bl_archivo: encontrado.archivo, bl_leido_en: new Date().toISOString() }
          : { bl_leido_en: new Date().toISOString() },
      )
      .eq("id", c.id);
    if (encontrado) r.bls.push(`${c.numero}: ${encontrado.cajas} cajas (${encontrado.archivo})`);
  }
}
