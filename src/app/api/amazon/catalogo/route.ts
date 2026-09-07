import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { Cliente, cuentasAmazon } from "@/lib/amazon/spapi";
import { sincronizarListados } from "@/lib/amazon/sync";
import { cuentaAmazon } from "@/lib/servicios/amazon";

export const dynamic = "force-dynamic";
// zlib para descomprimir el reporte: hace falta el runtime de Node, no edge.
export const runtime = "nodejs";
export const maxDuration = 60;

/** Margen antes del corte, para alcanzar a guardar lo ya conseguido. */
const PLAZO_MS = 50_000;

const MENSAJES: Record<string, string> = {
  solicitado:
    "Le pedí el catálogo a Amazon. Tarda unos minutos en generarlo: vuelve a darle en un rato para recogerlo.",
  procesando: "Amazon todavía lo está preparando. Vuelve a darle en un par de minutos.",
  reintentar: "Amazon no entregó el reporte. Vuelve a intentar.",
  vacio: "Amazon devolvió el catálogo vacío.",
  al_dia: "El catálogo ya estaba al día.",
};

/**
 * Botón "Actualizar desde Amazon" de /amazon/contenido.
 *
 * El catálogo también se refresca solo cada 12 horas montado en el latido;
 * esto es para cuando alguien acaba de publicar o apagar algo y no quiere
 * esperar. Como todo reporte de Amazon va en dos tiempos: la primera llamada
 * lo pide y la segunda lo recoge.
 */
export async function POST() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  // Con RLS de por medio, esto confirma que la cuenta es suya.
  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay ninguna cuenta de Amazon conectada." }, { status: 400 });
  }

  // Las credenciales de SP-API sólo las alcanza la service_role.
  const admin = clienteAdmin();
  const credenciales = (await cuentasAmazon(admin)).find((c) => c.accountId === cuenta.id);
  if (!credenciales) {
    return NextResponse.json(
      { error: "La cuenta de Amazon no tiene credenciales guardadas." },
      { status: 400 },
    );
  }

  const cliente = new Cliente(credenciales, Date.now() + PLAZO_MS);
  try {
    const r = await sincronizarListados(admin, cliente, { forzar: true });
    return NextResponse.json({
      ok: true,
      estado: r.estado,
      publicaciones: r.publicaciones ?? 0,
      mensaje:
        r.estado === "cargado"
          ? `Listo: ${(r.publicaciones ?? 0).toLocaleString("es-MX")} publicaciones actualizadas.`
          : (MENSAJES[r.estado] ?? "Listo."),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
