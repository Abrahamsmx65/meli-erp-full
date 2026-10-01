import { after, NextResponse, type NextRequest } from "next/server";
import { rolDeSesion } from "@/lib/acceso/roles";
import { cuentaActiva } from "@/lib/datos/repos";
import { dispararPublicacionTikTok, MAX_ESLABONES_PUBLICACION } from "@/lib/servicios/disparar-publicacion";
import {
  encolarPublicaciones,
  hayPendientes,
  listarProductosNuevos,
  publicarPendientes,
  quitarDeLaCola,
  reintentarPublicacion,
} from "@/lib/servicios/tiktok-publicar";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Lo que trabaja cada eslabón de fondo antes de pasar la estafeta. */
const MS_POR_ESLABON = 270_000;
/** Lo que trabaja la ruta que encola, en su `after()`, antes de prender el eslabón 1. */
const MS_TRAS_ENCOLAR = 240_000;

function origenDe(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
}

/** La lista de productos de Amazon y la cola. `?refrescar=1` vuelve a masticar la lista. */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  try {
    const datos = await listarProductosNuevos(clienteAdmin(), cuenta.id, { forzar: req.nextUrl.searchParams.get("refrescar") === "1" });
    return NextResponse.json(datos);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Encolar (y empezar a publicar por atrás), reintentar o quitar. Con el
 * bearer de CRON_SECRET y `?cuenta=&eslabon=` es un eslabón de fondo.
 */
export async function POST(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const cuentaParam = req.nextUrl.searchParams.get("cuenta");
  if (secreto && auth === `Bearer ${secreto}` && cuentaParam) {
    return eslabonDeFondo(req, cuentaParam, Number(req.nextUrl.searchParams.get("eslabon") ?? "1") || 1);
  }

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  if (rolDeSesion(user) !== "dueño") return NextResponse.json({ error: "Publicar en TikTok es del dueño." }, { status: 403 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  let cuerpo: any = {};
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }
  const admin = clienteAdmin();
  const origen = origenDe(req);

  try {
    if (cuerpo.accion === "reintentar") {
      const ok = await reintentarPublicacion(admin, cuenta.id, Number(cuerpo.id));
      if (ok) programarFondo(admin, cuenta.id, origen);
      return NextResponse.json({ ok });
    }
    if (cuerpo.accion === "quitar") {
      const ok = await quitarDeLaCola(admin, cuenta.id, Number(cuerpo.id));
      return NextResponse.json({ ok });
    }
    if (cuerpo.accion === "continuar") {
      programarFondo(admin, cuenta.id, origen);
      return NextResponse.json({ ok: true });
    }
    const pedidos = Array.isArray(cuerpo.productos) ? cuerpo.productos : [];
    if (!pedidos.length) return NextResponse.json({ error: "No marcaste ningún producto." }, { status: 400 });
    const r = await encolarPublicaciones(admin, cuenta.id, pedidos, { borrador: Boolean(cuerpo.borrador), creadoPor: user.id });
    if (r.encolados) programarFondo(admin, cuenta.id, origen);
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Publica lo que alcance en el `after()` y, si falta, prende el eslabón 1. */
function programarFondo(admin: any, accountId: string, origen: string) {
  after(async () => {
    try {
      const r = await publicarPendientes(admin, accountId, MS_TRAS_ENCOLAR);
      if (r.ocupado) return; // ya hay un eslabón trabajando
      if (r.faltan > 0 || (await hayPendientes(admin, accountId))) await dispararPublicacionTikTok(origen, accountId, 1);
    } catch (err) {
      console.error("publicarPendientes (tras encolar):", (err as Error).message);
    }
  });
}

async function eslabonDeFondo(req: NextRequest, accountId: string, eslabon: number) {
  const admin = clienteAdmin();
  const origen = origenDe(req);
  after(async () => {
    const inicio = new Date().toISOString();
    try {
      const r = await publicarPendientes(admin, accountId, MS_POR_ESLABON);
      const avanzo = r.publicados > 0 || r.errores > 0;
      const faltan = r.faltan > 0 || (await hayPendientes(admin, accountId));
      const seguir = faltan && !r.ocupado && avanzo && eslabon < MAX_ESLABONES_PUBLICACION;
      await admin.from("tiktok_sync_log").insert({
        account_id: accountId,
        tarea: "publicar",
        inicio,
        fin: new Date().toISOString(),
        estado: r.ocupado ? "ocupado" : r.errores ? "con avisos" : "ok",
        detalle: { eslabon, ...r, seguir },
      });
      if (seguir) await dispararPublicacionTikTok(origen, accountId, eslabon + 1);
    } catch (err) {
      await admin.from("tiktok_sync_log").insert({
        account_id: accountId,
        tarea: "publicar",
        inicio,
        fin: new Date().toISOString(),
        estado: "error",
        detalle: { eslabon, error: (err as Error).message },
      });
    }
  });
  return NextResponse.json({ ok: true, eslabon }, { status: 202 });
}
