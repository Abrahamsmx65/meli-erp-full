/**
 * Lo que contestan las rutas de «Publicar productos», igual para la
 * pantalla con sesión (`/api/meli/publicar`) y para el link con token
 * (`/api/publicar-publico/{token}`): cada ruta solo decide QUIÉN entra y
 * arma el contexto.
 */
import { after, NextResponse, type NextRequest } from "next/server";
import type { MeliClient } from "@/lib/meli/client";
import { RecursoOcupadoError } from "@/lib/datos/repos";
import { clienteAdmin } from "@/lib/supabase/admin";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import {
  encolarPublicacion,
  leerFicha,
  leerPedido,
  listarPublicaciones,
  procesarPublicacion,
  validarPedido,
} from "@/lib/servicios/meli-publicar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

export interface ContextoPublicar {
  admin: DB;
  cuentaId: string;
  cliente: MeliClient;
}

export async function contextoDeCuenta(cuentaId: string): Promise<ContextoPublicar | NextResponse> {
  const admin = clienteAdmin();
  const cliente = await clienteDeCuenta(admin, cuentaId);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 });
  return { admin, cuentaId, cliente };
}

/** `?ficha=GT312` lee en vivo la ficha a copiar; sin parámetros, las últimas publicaciones hechas aquí. */
export async function atenderGet(c: ContextoPublicar, req: NextRequest): Promise<NextResponse> {
  try {
    const modelo = req.nextUrl.searchParams.get("ficha");
    if (modelo) return NextResponse.json({ ficha: await leerFicha(c.admin, c.cuentaId, c.cliente, modelo) });
    return NextResponse.json({ publicaciones: await listarPublicaciones(c.admin, c.cuentaId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * `accion: "validar"` revisa el pedido contra MELI sin crear nada;
 * `"publicar"` lo encola y crea las publicaciones por atrás;
 * `"continuar"` / `"reintentar"` (con `id`) retoman uno ya encolado.
 */
export async function atenderPost(c: ContextoPublicar, req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const accion = typeof body.accion === "string" ? body.accion : "";
  try {
    if (accion === "validar") {
      return NextResponse.json(await validarPedido(c.admin, c.cuentaId, c.cliente, leerPedido(body)));
    }
    let id = typeof body.id === "string" ? body.id : "";
    if (accion === "publicar") {
      const pedido = leerPedido(body);
      const revision = await validarPedido(c.admin, c.cuentaId, c.cliente, pedido);
      if (!revision.ok) return NextResponse.json({ ...revision, error: "MELI no acepta el producto así." }, { status: 400 });
      id = (await encolarPublicacion(c.admin, c.cuentaId, pedido)).id;
    } else if (accion !== "continuar" && accion !== "reintentar") {
      return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
    if (!id) return NextResponse.json({ error: "Falta el id." }, { status: 400 });

    after(async () => {
      try {
        await procesarPublicacion(c.admin, c.cuentaId, c.cliente, id, { reintentar: accion === "reintentar" });
      } catch (err) {
        if (!(err instanceof RecursoOcupadoError)) console.error("publicar en MELI:", (err as Error).message);
      }
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Sube UNA foto a MELI y contesta su id. El navegador la manda ya reducida (Vercel no acepta más de 4.5 MB). */
export async function atenderFoto(c: ContextoPublicar, req: NextRequest): Promise<NextResponse> {
  const forma = await req.formData().catch(() => null);
  const archivo = forma?.get("file");
  if (!(archivo instanceof Blob) || !archivo.size) {
    return NextResponse.json({ error: "No llegó la foto." }, { status: 400 });
  }
  if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) {
    return NextResponse.json({ error: "La foto tiene que ser JPG, PNG o WEBP." }, { status: 400 });
  }
  try {
    const nombre = archivo instanceof File && archivo.name ? archivo.name : "foto.jpg";
    return NextResponse.json(await c.cliente.subirImagen(archivo, nombre));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
