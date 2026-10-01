import { NextResponse, type NextRequest } from "next/server";
import { variantesVivas } from "@/lib/catalogo";
import { config } from "@/lib/config";
import { costoDeEnvio, normalizarCarrito } from "@/lib/tienda";

export const dynamic = "force-dynamic";

/** El carrito vive en el navegador; aquí se le pone precio y existencia de ahorita. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const carrito = normalizarCarrito(body?.items);
  const vivas = await variantesVivas(carrito.map((r) => r.skuId));
  const renglones = carrito.map((r) => {
    const v = vivas.get(r.skuId);
    return v ? { ...v, cantidad: r.cantidad } : { skuId: r.skuId, cantidad: r.cantidad, noDisponible: true };
  });
  const subtotal = renglones.reduce((s, r: any) => s + (r.precio ? r.precio * Math.min(r.cantidad, r.disponible) : 0), 0);
  return NextResponse.json({ renglones, subtotal, envio: costoDeEnvio(subtotal, config.envio()), regla: config.envio() });
}
