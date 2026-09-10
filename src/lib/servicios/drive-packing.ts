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
 */
import type { DB } from "../datos/repos";
import { importarPackingList } from "../importar/packing-list";
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
}

/** Los contenedores ya cargados con su número de embarque, y el más alto (de ahí para adelante se importa). */
export async function contenedoresCargados(admin: DB, accountId: string): Promise<{ lista: ContenedorCargado[]; maximo: number | null }> {
  const { data } = await admin.from("contenedores").select("id, numero, estado").eq("account_id", accountId);
  const lista: ContenedorCargado[] = (data ?? []).map((c: { id: string; numero: string; estado: string }) => ({
    id: c.id,
    numero: c.numero,
    estado: c.estado,
    embarque: numeroDeEmbarque(c.numero),
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

/** Facturas y pedidos que viajan en la misma carpeta y no son packing list: ni se descargan. */
export function esArchivoAjeno(nombre: string): boolean {
  return /invoice|factura|proforma|\bPI\b/i.test(nombre) && !/packing/i.test(nombre);
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
  const r: ResultadoDrivePacking = { sinConfigurar: false, archivos: 0, revisados: 0, importados: [], omitidos: [], errores: [], correos: [] };
  // Sin llave se lee la carpeta pública (decisión del dueño); con llave, el API.
  const cfg = configDrive();

  // Los packing lists viven en subcarpetas por contenedor: a las de embarques
  // anteriores al último cargado ni se entra.
  const { lista: cargados, maximo } = await contenedoresCargados(admin, accountId);
  const archivos = (
    await listarCarpetaDrive(cfg, { omitirCarpeta: (nombre) => esEmbarqueViejo(numeroDeEmbarque(nombre), maximo) })
  ).filter(esHojaDeCalculo);
  r.archivos = archivos.length;
  const { data: guardadas } = await admin
    .from("drive_packing_lists")
    .select("drive_file_id, md5, modificado_en, estado")
    .eq("account_id", accountId);
  const previa = new Map((guardadas ?? []).map((g: FilaGuardada) => [g.drive_file_id, g]));

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
  for (const a of archivos) {
    if (Date.now() > opts.finMs) break;
    if (!opts.forzar && !cambio(a, previa.get(a.id))) continue;
    // Por la subcarpeta o el nombre, sin descargar: un embarque anterior al
    // último cargado no se toca.
    const porNombre = numeroDeEmbarque(a.carpeta) ?? numeroDeEmbarque(a.nombre);
    if (esEmbarqueViejo(porNombre, maximo)) {
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
      const numeroLeido = (packing.referencia || packing.contenedor || "").trim().toUpperCase();
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
      // "S259-2026" en el archivo), se trabaja sobre ESE contenedor.
      const yaCargado = contenedorDelEmbarque(cargados, numeroLeido);
      const numero = yaCargado?.numero.trim().toUpperCase() || numeroLeido;
      const porReferencia = numeroDeEmbarque(numero);
      if (esEmbarqueViejo(porReferencia, maximo)) {
        await registrar(a, "omitido", `${numero} es anterior al último embarque cargado (S${maximo}); no se importa.`);
        r.omitidos.push(`${a.nombre}: ${numero} anterior a S${maximo}`);
        continue;
      }
      const casado = await casarPackingList(admin, accountId, packing, numero);
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
      const aplicado = await aplicarPackingList(admin, accountId, casado, {
        numeroNaviera: packing.contenedor || null,
        estado: "borrador",
        notas: `Borrador desde Drive: ${a.nombre}`,
      });
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
  return r;
}
