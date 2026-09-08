import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Receptor de avisos de MELI para la app de YAPANIZCEL.
 *
 * La app de fundas tenía la URL del OAuth (/api/yapanizcel/meli/callback)
 * como URL de notificaciones y MELI la bombardeaba con ~1 millón de avisos
 * al día (items, órdenes, precios de ~18 mil variantes): eso solo era la
 * mayor parte de la factura de Vercel. La sincronización de fundas es por
 * SONDEO (tramos + cron), así que estos avisos hoy no se necesitan: aquí se
 * contesta 200 al instante y no se hace nada más, que es lo más barato que
 * puede costar un aviso. Si un día se quiere procesar en vivo, este es el
 * lugar. Lo IMPORTANTE es que en el devcenter de MELI la app de YAPANIZCEL
 * apunte sus notificaciones AQUÍ (o mejor: desuscribir los temas que no se
 * usan) y nunca al callback del OAuth.
 */
export async function POST() {
  // MELI exige 200 en < 500 ms; sin cuerpo, sin base, sin trabajo.
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, uso: "URL de notificaciones de MELI para la app de YAPANIZCEL." });
}
