import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, RecursoOcupadoError } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import {
  encolarPublicacion,
  leerFicha,
  leerPedido,
  listarPublicaciones,
  procesarPublicacion,
  validarPedido,
} from "@/lib/servicios/meli-publicar";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

async function contexto() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) } as const;
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 }) } as const;
  const admin = clienteAdmin();
  const cliente = await clienteDeCuenta(admin, cuenta.id);
  if (!cliente) {
    return { error: NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 }) } as const;
  }
  return { supabase, cuenta, admin, cliente } as const;
}

/** `?ficha=GT312` lee en vivo la ficha a copiar; sin parámetros, las últimas publicaciones hechas aquí. */
export async function GET(req: NextRequest) {
  const c = await contexto();
  if ("error" in c) return c.error;
  try {
    const modelo = req.nextUrl.searchParams.get("ficha");
    if (modelo) return NextResponse.json({ ficha: await leerFicha(c.admin, c.cuenta.id, c.cliente, modelo) });
    return NextResponse.json({ publicaciones: await listarPublicaciones(c.supabase, c.cuenta.id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * `accion: "validar"` revisa el pedido contra MELI sin crear nada;
 * `"publicar"` lo encola y crea las publicaciones por atrás;
 * `"continuar"` / `"reintentar"` (con `id`) retoman uno ya encolado.
 */
export async function POST(req: NextRequest) {
  const c = await contexto();
  if ("error" in c) return c.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const accion = typeof body.accion === "string" ? body.accion : "";

  try {
    if (accion === "validar") {
      return NextResponse.json(await validarPedido(c.admin, c.cuenta.id, c.cliente, leerPedido(body)));
    }

    let id = typeof body.id === "string" ? body.id : "";
    if (accion === "publicar") {
      const pedido = leerPedido(body);
      const revision = await validarPedido(c.admin, c.cuenta.id, c.cliente, pedido);
      if (!revision.ok) return NextResponse.json({ ...revision, error: "MELI no acepta el producto así." }, { status: 400 });
      id = (await encolarPublicacion(c.admin, c.cuenta.id, pedido)).id;
    } else if (accion !== "continuar" && accion !== "reintentar") {
      return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
    if (!id) return NextResponse.json({ error: "Falta el id." }, { status: 400 });

    const { admin, cuenta, cliente } = c;
    after(async () => {
      try {
        await procesarPublicacion(admin, cuenta.id, cliente, id, { reintentar: accion === "reintentar" });
      } catch (err) {
        if (!(err instanceof RecursoOcupadoError)) console.error("publicar en MELI:", (err as Error).message);
      }
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
