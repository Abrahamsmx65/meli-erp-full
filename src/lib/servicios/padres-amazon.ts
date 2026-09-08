/**
 * Resolver el ASIN PADRE de las publicaciones de Amazon.
 *
 * Amazon solo nos da hijos (un ASIN por talla y color). El padre es el que
 * agrupa el producto completo, y es al que debe apuntar el link de la sección
 * de contenido: `/dp/{hijo}` abre una talla suelta, `/dp/{padre}` abre la
 * publicación con todas sus variantes.
 *
 * Se pregunta por UN hijo de cada color (las variantes de talla comparten
 * padre) y solo por los que todavía no se han resuelto: la primera corrida
 * son unos cientos, las siguientes solo lo que se haya publicado desde
 * entonces.
 */
import { traerTodo, type DB } from "../datos/repos";
import type { Cliente } from "../amazon/spapi";
import { resolverPadres } from "../amazon/catalogo";
import { asinsRepresentativos } from "./contenido-amazon";

/**
 * Cuántos ASINs se resuelven por corrida. Cada llamada lleva 20 y la cuota es
 * de 2 por segundo: 200 son ~10 llamadas, unos 5 segundos del presupuesto de
 * 45 que tiene el latido completo.
 */
const POR_CORRIDA = 200;

export interface ResultadoPadres {
  estado: "al_dia" | "resueltos";
  asins?: number;
  padres?: number;
}

export async function sincronizarPadres(
  admin: DB,
  cliente: Cliente,
): Promise<ResultadoPadres> {
  const accountId = cliente.cuenta.accountId;

  // Paginado con traerTodo: cortado en 1,000, ASINs ya resueltos volvían a
  // entrar como "nuevos" y quemaban cuota de SP-API en cada corrida.
  const [representativos, yaResueltos] = await Promise.all([
    asinsRepresentativos(admin, accountId),
    traerTodo<{ asin: string; parent_asin: string | null; imagen_url: string | null }>(
      admin,
      "amazon_padres",
      "asin, parent_asin, imagen_url",
      (q) => q.eq("account_id", accountId),
    ).catch((err: Error) => {
      // SOLO la tabla ausente (falta la migración 0033) se traga: resolver
      // para no poder guardar sería quemar cuota de Amazon en cada corrida.
      // Cualquier otro error de lectura sube: el latido lo registra en
      // amazon_sync_log (estado "error") y reintenta en su siguiente vuelta.
      if (/does not exist|42P01|schema cache/i.test(err.message)) return null;
      throw err;
    }),
  ]);
  if (yaResueltos === null) return { estado: "al_dia" };

  const filas = yaResueltos as any[];
  const conocidos = new Set(filas.map((f) => String(f.asin ?? "")));
  const nuevos = representativos.filter((a) => !conocidos.has(a));
  // Los que se resolvieron antes de que se guardara la foto del padre se
  // vuelven a preguntar, para que la miniatura se rellene sola.
  const sinFoto = filas
    .filter((f) => f.parent_asin && !f.imagen_url)
    .map((f) => String(f.asin));
  const pendientes = [...new Set([...nuevos, ...sinFoto])].slice(0, POR_CORRIDA);
  if (!pendientes.length) return { estado: "al_dia" };

  const resueltos = await resolverPadres(cliente, pendientes);
  if (!resueltos.size) return { estado: "al_dia" };

  const ahora = new Date().toISOString();
  const { error } = await admin.from("amazon_padres").upsert(
    [...resueltos.entries()].map(([asin, p]) => ({
      account_id: accountId,
      asin,
      parent_asin: p.parentAsin,
      titulo: p.titulo,
      imagen_url: p.imagenUrl,
      resuelto_en: ahora,
    })),
  );
  if (error) throw new Error(`amazon_padres: ${error.message}`);

  return {
    estado: "resueltos",
    asins: resueltos.size,
    padres: new Set([...resueltos.values()].map((p) => p.parentAsin).filter(Boolean)).size,
  };
}
