import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { avisarErp } from "@/lib/erp";
import { crearPreferencia } from "@/lib/mercadopago";
import { clienteActual } from "@/lib/sesion";
import { costoDeEnvio, normalizarCarrito, validarDatos } from "@/lib/tienda";
import { variantesVivas } from "@/lib/catalogo";

export const dynamic = "force-dynamic";

/** Minutos que se apartan los pares mientras el comprador paga con tarjeta. */
const MINUTOS_APARTADO = 45;

/**
 * Pagar: aparta los pares en la base (bloqueando los renglones del kardex,
 * `tienda_crear_pedido`), crea la preferencia de Mercado Pago y devuelve la
 * liga para pagar. El precio y la existencia los decide la base, nunca el
 * navegador.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const carrito = normalizarCarrito(body?.items);
  if (!carrito.length) return NextResponse.json({ error: "Tu carrito está vacío." }, { status: 400 });
  const { datos, errores } = validarDatos(body?.datos ?? {});
  if (Object.keys(errores).length) return NextResponse.json({ error: "Revisa tus datos de envío.", errores }, { status: 400 });

  // El envío se calcula sobre el precio de ahorita (la base vuelve a sumar el subtotal).
  const vivas = await variantesVivas(carrito.map((r) => r.skuId));
  const subtotal = carrito.reduce((s, r) => s + (vivas.get(r.skuId)?.precio ?? 0) * r.cantidad, 0);
  const envio = costoDeEnvio(subtotal, config.envio());
  const cliente = await clienteActual();

  const { data, error } = await db().rpc("tienda_crear_pedido", {
    p_account: config.cuenta(),
    p_cliente: cliente?.id ?? null,
    p_email: datos.email,
    p_nombre: datos.nombre,
    p_telefono: datos.telefono,
    p_direccion: {
      calle: datos.calle,
      numero: datos.numero,
      interior: datos.interior,
      colonia: datos.colonia,
      cp: datos.cp,
      ciudad: datos.ciudad,
      estado: datos.estado,
      referencias: datos.referencias,
    },
    p_envio: envio,
    p_items: carrito.map((r) => ({ sku_id: r.skuId, cantidad: r.cantidad })),
    p_minutos: MINUTOS_APARTADO,
  });
  if (error) return NextResponse.json({ error: "No se pudo crear el pedido. Intenta de nuevo." }, { status: 500 });
  const r = data as any;
  if (!r?.ok) {
    return NextResponse.json(
      { error: "Algunos pares se acaban de vender. Revisa tu carrito.", faltantes: r?.faltantes ?? [] },
      { status: 409 },
    );
  }

  // La cuenta recuerda los datos de envío para la próxima compra.
  if (cliente) {
    await db()
      .from("tienda_clientes")
      .update({ nombre: datos.nombre, telefono: datos.telefono, direccion: { ...datos, email: undefined } })
      .eq("id", cliente.id);
  }
  await avisarErp(`pedido ${r.folio}`);

  try {
    const pref = await crearPreferencia({
      pedidoId: r.id,
      folio: r.folio,
      token: r.token,
      email: datos.email,
      nombre: datos.nombre,
      envio: Number(r.envio),
      expiraEn: new Date(Date.now() + MINUTOS_APARTADO * 60_000),
      items: carrito
        .filter((c) => vivas.has(c.skuId))
        .map((c) => {
          const v = vivas.get(c.skuId)!;
          return {
            id: c.skuId,
            title: [v.titulo, v.color, v.talla ? `talla ${v.talla}` : null].filter(Boolean).join(" · ").slice(0, 250),
            quantity: c.cantidad,
            unit_price: v.precio,
            picture_url: v.imagen,
          };
        }),
    });
    await db().from("tienda_pedidos").update({ mp_preferencia: pref.id }).eq("id", r.id);
    return NextResponse.json({ ok: true, folio: r.folio, url: pref.init_point });
  } catch (err) {
    // Sin liga de pago el apartado no sirve: se suelta en el acto.
    await db().rpc("tienda_marcar_pago", { p_pedido: r.id, p_estado_mp: "cancelled", p_pago: null, p_detalle: { error: (err as Error).message } });
    await avisarErp(`pedido ${r.folio} sin pago`);
    return NextResponse.json({ error: "Mercado Pago no respondió. Intenta otra vez en un momento." }, { status: 502 });
  }
}
