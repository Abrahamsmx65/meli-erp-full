/**
 * Lo que contestan las rutas de «Crear en Amazon», igual para la pantalla
 * con sesión (`/api/meli/publicar/amazon`) y para el link con token
 * (`/api/publicar-publico/{token}/amazon`): cada ruta solo decide QUIÉN
 * entra y de qué cuenta.
 */
import { after, NextResponse, type NextRequest } from "next/server";
import { RecursoOcupadoError } from "@/lib/datos/repos";
import { clienteAdmin } from "@/lib/supabase/admin";
import {
  clienteAmazonParaPublicar,
  encolarAmazon,
  leerFichaAmazon,
  leerPedidoAmazon,
  listarPublicacionesAmazon,
  procesarAmazon,
  validarPedidoAmazon,
} from "@/lib/servicios/amazon-publicar";

const MS_LECTURA = 50_000;
const MS_TRABAJO = 760_000;

export async function atenderGetAmazon(cuentaId: string, req: NextRequest): Promise<NextResponse> {
  const admin = clienteAdmin();
  try {
    const modelo = req.nextUrl.searchParams.get("ficha");
    if (modelo) {
      const cliente = await clienteAmazonParaPublicar(admin, MS_LECTURA);
      return NextResponse.json({ ficha: await leerFichaAmazon(admin, cliente, modelo) });
    }
    return NextResponse.json({ publicaciones: await listarPublicacionesAmazon(admin, cuentaId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** `validar` no crea nada; `publicar` encola y crea por atrás; `continuar` / `reintentar` retoman uno. */
export async function atenderPostAmazon(cuentaId: string, req: NextRequest): Promise<NextResponse> {
  const admin = clienteAdmin();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const accion = typeof body.accion === "string" ? body.accion : "";
  try {
    const cliente = await clienteAmazonParaPublicar(admin, MS_TRABAJO);
    if (accion === "validar") {
      return NextResponse.json(await validarPedidoAmazon(admin, cliente, leerPedidoAmazon(body, cliente.cuenta.marketplaceId)));
    }
    let id = typeof body.id === "string" ? body.id : "";
    if (accion === "publicar") {
      const pedido = leerPedidoAmazon(body, cliente.cuenta.marketplaceId);
      const revision = await validarPedidoAmazon(admin, cliente, pedido);
      if (!revision.ok) return NextResponse.json({ ...revision, error: "Amazon no acepta el producto así." }, { status: 400 });
      id = await encolarAmazon(admin, cuentaId, cliente, pedido);
    } else if (accion !== "continuar" && accion !== "reintentar") {
      return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
    if (!id) return NextResponse.json({ error: "Falta el id." }, { status: 400 });

    after(async () => {
      try {
        await procesarAmazon(admin, cuentaId, cliente, id, { reintentar: accion === "reintentar" });
      } catch (err) {
        if (!(err instanceof RecursoOcupadoError)) console.error("crear en Amazon:", (err as Error).message);
      }
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
