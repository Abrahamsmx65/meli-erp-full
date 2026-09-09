/**
 * Aviso por correo de las fotos que faltan para un contenedor recién
 * cargado (decisión del dueño): de los productos NUEVOS que vienen en los
 * pedidos de ese contenedor, cuáles no están publicados o tienen menos de
 * FOTOS_MINIMAS fotos en MELI o en Amazon. Se revisa en vivo contra MELI y
 * Amazon (solo lo que falta) y se manda a CORREO_AVISOS.
 */
import type { DB } from "../datos/repos";
import { FOTOS_MINIMAS } from "./productos-nuevos";
import { revisarFotosDeNuevos } from "./productos-nuevos-revisar";
import { correoConfigurado, enviarCorreo } from "./correo";

export interface FaltanteFoto {
  modelo: string;
  color: string;
  pedidos: string[];
  meli: string;
  amazon: string;
}

export interface ListaFotosContenedor {
  numero: string;
  pedidos: string[];
  faltantes: FaltanteFoto[];
  productosDelContenedor: number;
  errores: string[];
}

async function pedidosDelContenedor(admin: DB, contenedorId: string): Promise<string[]> {
  const { data: cl } = await admin.from("contenedor_lineas").select("pedido_linea_id").eq("contenedor_id", contenedorId);
  const lineaIds = [...new Set((cl ?? []).map((x) => x.pedido_linea_id as string))];
  if (!lineaIds.length) return [];
  const { data: lineas } = await admin.from("pedido_lineas").select("pedido_id").in("id", lineaIds);
  const pedidoIds = [...new Set((lineas ?? []).map((x) => x.pedido_id as string))];
  if (!pedidoIds.length) return [];
  const { data: pedidos } = await admin.from("pedidos").select("pedido").in("id", pedidoIds);
  return [...new Set((pedidos ?? []).map((p) => String(p.pedido).trim().toUpperCase()))].sort();
}

export async function listaFotosDeContenedor(admin: DB, accountId: string, contenedorId: string): Promise<ListaFotosContenedor> {
  const { data: cont } = await admin.from("contenedores").select("numero").eq("id", contenedorId).maybeSingle();
  const pedidos = await pedidosDelContenedor(admin, contenedorId);
  const rev = await revisarFotosDeNuevos(admin, admin, accountId, false);
  const fotos = new Map(rev.productos.map((f) => [f.clave, f]));
  const enPedidos = new Set(pedidos);
  const del = rev.lista.filter((p) => p.pedidos.some((x) => enPedidos.has(x.pedido.trim().toUpperCase())));

  const faltantes: FaltanteFoto[] = [];
  for (const p of del) {
    const f = fotos.get(p.clave);
    const meli = !p.meli.publicaciones.length
      ? "Sin publicar"
      : f?.meli.fotos == null
        ? "Publicado, fotos sin revisar"
        : f.meli.fotos < FOTOS_MINIMAS
          ? f.meli.fotos === 0
            ? "Sin fotos"
            : `Faltan fotos (tiene ${f.meli.fotos})`
          : "";
    const amazon = !rev.amazonConectado
      ? ""
      : !p.amazon.skus.length
        ? "Sin publicar"
        : f?.amazon.fotos == null
          ? "Publicado, fotos sin revisar"
          : f.amazon.fotos < FOTOS_MINIMAS
            ? f.amazon.fotos === 0
              ? "Sin fotos"
              : `Faltan fotos (tiene ${f.amazon.fotos})`
            : "";
    if (meli || amazon) {
      faltantes.push({
        modelo: p.modelo,
        color: p.color,
        pedidos: p.pedidos.map((x) => x.pedido).filter((x) => enPedidos.has(x.trim().toUpperCase())),
        meli: meli || "OK",
        amazon: rev.amazonConectado ? amazon || "OK" : "—",
      });
    }
  }
  return { numero: cont?.numero ?? "", pedidos, faltantes, productosDelContenedor: del.length, errores: rev.errores };
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function correoDeFotos(l: ListaFotosContenedor): { asunto: string; html: string; texto: string } {
  const asunto = l.faltantes.length
    ? `Contenedor ${l.numero}: ${l.faltantes.length} productos nuevos sin fotos`
    : `Contenedor ${l.numero}: los productos nuevos ya tienen sus fotos`;
  const filas = l.faltantes
    .map(
      (f) =>
        `<tr><td>${esc(f.modelo)}</td><td>${esc(f.color)}</td><td>${esc(f.pedidos.join(", "))}</td><td>${esc(f.meli)}</td><td>${esc(f.amazon)}</td></tr>`,
    )
    .join("");
  const html = `
<p>Se cargó el contenedor <strong>${esc(l.numero)}</strong> (pedidos ${esc(l.pedidos.join(", ") || "—")}).
Trae ${l.productosDelContenedor} productos nuevos (nunca han tenido stock en Full ni en FBA).</p>
${
  l.faltantes.length
    ? `<p>Hay que hacer fotos o publicar estos (mínimo ${FOTOS_MINIMAS} fotos por color):</p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
<tr><th>Modelo</th><th>Color</th><th>Pedido</th><th>Mercado Libre</th><th>Amazon</th></tr>${filas}</table>`
    : `<p>Todos ya están publicados con sus fotos en Mercado Libre y Amazon.</p>`
}
${l.errores.length ? `<p style="color:#b00">No se pudo revisar todo: ${esc(l.errores.join(" · "))}</p>` : ""}
<p style="color:#666;font-size:12px">Detalle en el ERP: Pedidos → Productos nuevos.</p>`;
  const texto = [
    `Contenedor ${l.numero} (pedidos ${l.pedidos.join(", ") || "—"}): ${l.productosDelContenedor} productos nuevos.`,
    ...l.faltantes.map((f) => `- ${f.modelo} ${f.color} [${f.pedidos.join(", ")}] · MELI: ${f.meli} · Amazon: ${f.amazon}`),
    ...(l.errores.length ? [`No se pudo revisar todo: ${l.errores.join(" · ")}`] : []),
  ].join("\n");
  return { asunto, html, texto };
}

/** Arma la lista, la manda y deja constancia en el contenedor. Nunca lanza. */
export async function avisarFotosDeContenedor(
  admin: DB,
  accountId: string,
  contenedorId: string,
): Promise<{ enviado: boolean; motivo?: string; faltantes: number }> {
  try {
    if (!correoConfigurado()) return { enviado: false, motivo: "Correo sin configurar (RESEND_API_KEY / CORREO_AVISOS).", faltantes: 0 };
    const lista = await listaFotosDeContenedor(admin, accountId, contenedorId);
    const r = await enviarCorreo(correoDeFotos(lista));
    if (r.enviado) {
      await admin.from("contenedores").update({ fotos_aviso_en: new Date().toISOString() }).eq("id", contenedorId);
    }
    return { enviado: r.enviado, motivo: r.motivo, faltantes: lista.faltantes.length };
  } catch (err) {
    console.error("avisarFotosDeContenedor:", (err as Error).message);
    return { enviado: false, motivo: (err as Error).message.slice(0, 200), faltantes: 0 };
  }
}
