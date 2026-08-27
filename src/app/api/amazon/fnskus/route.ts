import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { Cliente, cuentasAmazon } from "@/lib/amazon/spapi";
import { completarFnskus } from "@/lib/amazon/fnsku";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Margen antes del corte de la función, para alcanzar a guardar lo hecho. */
const PLAZO_MS = 50_000;

/** Tope de SKUs que la pantalla puede mandar de un jalón. */
const MAXIMO = 300;

/**
 * Pregunta a Amazon el FNSKU de los SKUs que no lo tienen.
 *
 * El reporte de inventario FBA solo trae los listings vivos, así que todo lo
 * agotado o pausado en FBA llegaba sin FNSKU y su etiqueta de Amazon no se
 * podía armar. Esto lo consulta SKU por SKU contra el API de inventario y lo
 * guarda en el catálogo.
 *
 * Con `skus` en el cuerpo pregunta por esos (lo que la pantalla de etiquetas
 * trae en la lista, que es lo que urge); sin cuerpo avanza el catálogo
 * completo de poco en poco.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const pedidos = Array.isArray(body?.skus)
    ? body.skus.map((s: unknown) => String(s ?? "").trim()).filter(Boolean).slice(0, MAXIMO)
    : [];

  const admin = clienteAdmin();
  const cuentas = await cuentasAmazon(admin);
  if (!cuentas.length) {
    return NextResponse.json(
      { error: "No hay ninguna cuenta de Amazon conectada." },
      { status: 400 },
    );
  }

  const limite = Date.now() + PLAZO_MS;
  let preguntados = 0;
  let resueltos = 0;

  for (const cuenta of cuentas) {
    try {
      const r = await completarFnskus(admin, new Cliente(cuenta, limite), {
        skus: pedidos.length ? pedidos : undefined,
      });
      preguntados += r.preguntados;
      resueltos += r.resueltos;
    } catch (err) {
      // Una cuenta que falla no debe tumbar a las demás ni a la pantalla:
      // lo que no se resolvió se queda pendiente y se vuelve a intentar.
      return NextResponse.json(
        { error: (err as Error).message.slice(0, 300), preguntados, resueltos },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: true, preguntados, resueltos });
}
