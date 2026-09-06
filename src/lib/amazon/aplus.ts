/**
 * Contenido A+ en Amazon (A+ Content API 2020-11-01).
 *
 * Amazon no dice en el catálogo si un ASIN tiene A+; hay que preguntarle a
 * este API por sus "registros de publicación": si el ASIN tiene al menos uno,
 * tiene A+ publicado. Se pregunta UN ASIN por llamada (así es el API), con
 * cuota de 10 por segundo, y solo por el representativo de cada color: el A+
 * es de la publicación, no de la talla.
 *
 * Si la app no tiene el rol de A+ Content, Amazon contesta 403: se devuelve
 * `sinPermiso` y la pantalla lo dice en vez de marcar "sin A+" en falso.
 */
import { ErrorAmazon, type Cliente } from "./spapi";

export interface ResultadoAplus {
  /** asin → tiene A+ publicado. Los que Amazon no contestó no aparecen. */
  porAsin: Map<string, boolean>;
  /** La app no tiene permiso para el A+ Content API. */
  sinPermiso: boolean;
  /** Se acabó el plazo antes de preguntar por todos. */
  incompleto: boolean;
}

interface RespuestaPublicacion {
  publishRecordList?: { asin?: string; contentType?: string; contentReferenceKey?: string }[];
}

export async function aplusDeAsins(cliente: Cliente, asins: string[]): Promise<ResultadoAplus> {
  const salida: ResultadoAplus = { porAsin: new Map(), sinPermiso: false, incompleto: false };
  for (const asin of [...new Set(asins.filter(Boolean))]) {
    let r: RespuestaPublicacion | null;
    try {
      r = await cliente.llamar<RespuestaPublicacion>(
        "GET",
        "/aplus/2020-11-01/contentPublishRecords",
        "searchContentPublishRecords",
        { params: { marketplaceId: cliente.cuenta.marketplaceId, asin } },
      );
    } catch (err) {
      if (err instanceof ErrorAmazon && (err.status === 403 || err.status === 401)) {
        salida.sinPermiso = true;
        return salida;
      }
      // Un ASIN que Amazon no reconoce no cuesta el resto.
      if (err instanceof ErrorAmazon && err.status < 500) continue;
      throw err;
    }
    if (r === null) {
      salida.incompleto = true;
      return salida;
    }
    salida.porAsin.set(asin, (r.publishRecordList ?? []).length > 0);
  }
  return salida;
}
