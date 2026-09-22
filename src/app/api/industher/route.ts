import { after } from "next/server";
import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { sincronizarTikTok } from "@/lib/servicios/tiktok";
import { sincronizarSaldoDesdeBodega } from "@/lib/servicios/tiktok-bodega";
import {
  configuracionIndusther,
  descargarInventarioIndusther,
  normalizarInventario,
  sincronizarInventarioIndusther,
} from "@/lib/servicios/industher";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET  -> prueba la conexión con el API de Industher y regresa una vista
 *         previa (campos detectados, muestra) SIN escribir nada.
 * POST -> sincroniza: descarga el inventario y reemplaza las existencias de
 *         los almacenes que el API reporta.
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const config = configuracionIndusther();
  if (!config) {
    return NextResponse.json(
      { error: "Falta INDUSTHER_API_KEY en las variables de entorno de Vercel." },
      { status: 400 },
    );
  }

  try {
    const descarga = await descargarInventarioIndusther();
    const inv = normalizarInventario(descarga.lista);
    inv.avisos.unshift(...descarga.avisos);

    return NextResponse.json({
      ok: true,
      renglones: inv.filas.length,
      cajasDisponibles: inv.filas.reduce((a, f) => a + f.cajasDisponibles, 0),
      almacenes: inv.almacenes,
      camposDetectados: inv.camposDetectados,
      camposIgnorados: inv.camposIgnorados,
      avisos: inv.avisos,
      muestra: inv.filas.slice(0, 5),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function POST() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json(
      { error: "Conecta primero tu cuenta de Mercado Libre." },
      { status: 400 },
    );
  }

  try {
    const resumen = await sincronizarInventarioIndusther(supabase, cuenta.id);
    // La bodega TikTok de Industher entra al kardex en la sincronización
    // de TikTok (cada 15 min). Quien aprieta el botón quiere verlo YA en
    // Almacén TikTok (21-sep-2026: «sincronizo mi bodega y no se actualiza»),
    // así que aquí se concilia el kardex y se publica en el fondo, leyendo
    // antes los pedidos recientes (regla de oro).
    after(async () => {
      const admin = clienteAdmin();
      await sincronizarSaldoDesdeBodega(admin, cuenta.id).catch(() => undefined);
      await sincronizarTikTok(admin, cuenta.id, { soloPedidos: true }).catch(() => undefined);
    });
    return NextResponse.json({ ok: true, resumen });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
