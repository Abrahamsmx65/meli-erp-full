import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { datosDeModelo, generarEvidencias } from "@/lib/servicios/evidencia-envio-generar";
import { dibujarEvidencia } from "@/lib/servicios/evidencia-envio-imagen";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vista previa de la ficha de evidencia de un modelo, dibujada al momento
 * (`?modelo=GT229`). Es para verla antes de mandarla; el link que va en el
 * Excel es el del bucket público, que se genera con el POST.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const modelo = (req.nextUrl.searchParams.get("modelo") ?? "").trim().toUpperCase();
  if (!modelo) return NextResponse.json({ error: "Falta el modelo." }, { status: 400 });

  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
  const datos = await datosDeModelo(cliente, supabase, cuenta.id, modelo);
  if (!datos) {
    return NextResponse.json(
      { error: "Ese modelo no tiene medida de consenso (hacen falta al menos tres hermanas medidas)." },
      { status: 404 },
    );
  }

  const png = await dibujarEvidencia(datos);
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="evidencia-${modelo.toLowerCase()}.png"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Genera y sube las fichas de todos los modelos con publicaciones mal
 * medidas (o de uno solo con `{ modelo }`). Con `{ forzar: true }` se vuelven
 * a dibujar aunque nada haya cambiado. `pendientes > 0` significa que se
 * acabó el tiempo: vuelve a llamar.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const admin = clienteAdmin();
  const cliente = await clienteDeCuenta(admin, cuenta.id);
  if (!cliente) return NextResponse.json({ error: "Sin tokens de MELI." }, { status: 500 });

  const cuerpo = (await req.json().catch(() => ({}))) as { modelo?: string; forzar?: boolean };

  try {
    const r = await generarEvidencias(cliente, admin, supabase, cuenta.id, {
      limiteMs: 40_000,
      soloModelo: cuerpo.modelo?.trim().toUpperCase() || undefined,
      forzar: cuerpo.forzar === true,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
