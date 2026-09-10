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

interface FilaGuardada {
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

export async function sincronizarPackingListsDrive(
  admin: DB,
  accountId: string,
  opts: { finMs: number; forzar?: boolean },
): Promise<ResultadoDrivePacking> {
  const r: ResultadoDrivePacking = { sinConfigurar: false, archivos: 0, revisados: 0, importados: [], omitidos: [], errores: [], correos: [] };
  // Sin llave se lee la carpeta pública (decisión del dueño); con llave, el API.
  const cfg = configDrive();

  const archivos = (await listarCarpetaDrive(cfg)).filter(esHojaDeCalculo);
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
        nombre: a.nombre,
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
    r.revisados++;
    try {
      const buffer = await descargarDrive(cfg, a);
      const packing = await importarPackingList(buffer, { nombre: a.nombre });
      const numero = (packing.referencia || packing.contenedor || "").trim().toUpperCase();
      if (!numero) {
        await registrar(a, "error", "El archivo no trae la referencia del embarque ni el contenedor.");
        r.errores.push(`${a.nombre}: sin número de contenedor`);
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
      const { data: existente } = await admin
        .from("contenedores")
        .select("id, estado")
        .eq("account_id", accountId)
        .eq("numero", numero)
        .maybeSingle();
      if (existente && existente.estado !== "borrador") {
        await registrar(a, "omitido", `El contenedor ${numero} ya está confirmado (${existente.estado}); no se toca.`, {
          contenedor_id: existente.id,
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
      await registrar(a, "importado", null, {
        contenedor_id: aplicado.contenedorId,
        resultado: { renglones: aplicado.renglones, cajas: aplicado.cajas, omitidos: aplicado.omitidos, recortes: aplicado.recortes.slice(0, 20) },
      });
      r.importados.push(`${a.nombre} → ${aplicado.numero} (${aplicado.cajas} cajas, ${aplicado.renglones} renglones)`);
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
