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
import type { DB } from "../datos/repos";
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

  const [representativos, yaResueltos] = await Promise.all([
    asinsRepresentativos(admin, accountId),
    admin.from("amazon_padres").select("asin").eq("account_id", accountId),
  ]);

  // Sin la tabla (falta la migración 0033) no se pregunta nada: resolver para
  // no poder guardar sería quemar cuota de Amazon en cada corrida.
  if (yaResueltos.error) return { estado: "al_dia" };

  const conocidos = new Set(((yaResueltos.data ?? []) as any[]).map((f) => String(f.asin ?? "")));
  const pendientes = representativos.filter((a) => !conocidos.has(a)).slice(0, POR_CORRIDA);
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
