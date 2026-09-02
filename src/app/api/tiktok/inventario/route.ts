import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { claveOrdenada, indexarCatalogo } from "@/lib/etiquetas/resolver";
import { claveAplastada, claveComparacion } from "@/lib/importar/sku";
import { registrarMovimientos, sincronizarTikTok } from "@/lib/servicios/tiktok";
import { cargarPanelTikTok } from "@/lib/servicios/tiktok-panel";
import type { TipoMovimiento } from "@/lib/tiktok/kardex";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TIPOS: TipoMovimiento[] = ["entrada", "salida", "devolucion", "merma", "ajuste"];

/** El estado del almacén de TikTok, para refrescar la pantalla sin recargarla. */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  return NextResponse.json(await cargarPanelTikTok(supabase, cuenta.id));
}

/**
 * Captura movimientos del almacén de TikTok y, en el mismo clic, le escribe
 * el disponible nuevo a TikTok.
 *
 * Que la publicación vaya aquí y no en un botón aparte es el punto de todo
 * el módulo: capturar una entrada y que la publicación siga diciendo "0"
 * hasta el cron de mañana es exactamente el problema que esto resuelve. Si
 * la escritura falla, el movimiento SÍ queda guardado y se avisa — el kardex
 * es la verdad y la próxima corrida vuelve a intentar publicarlo.
 *
 * Cuerpo:
 *   { movimientos: [{ sku, tipo, cantidad, motivo?, nota?, fecha? }], publicar?: boolean }
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const crudos = Array.isArray(body?.movimientos) ? body.movimientos : [];
  if (!crudos.length) {
    return NextResponse.json({ error: "No se mandó ningún movimiento." }, { status: 400 });
  }

  // El SKU capturado a mano se amarra contra el catálogo real: escribirlo
  // distinto creaba un renglón fantasma con su propio saldo, y el bueno
  // seguía agotado.
  const catalogo = await traerTodo<any>(supabase, "skus", "sku", (q) =>
    q.eq("account_id", cuenta.id).eq("activo", true),
  );
  const indice = indexarCatalogo(catalogo ?? []);
  const amarrar = (sku: string): string => {
    const dado =
      indice.exacto.get(sku.toUpperCase()) ??
      indice.canonico.get(claveComparacion(sku)) ??
      indice.aplastado.get(claveAplastada(sku)) ??
      indice.ordenado.get(claveOrdenada(sku));
    return dado?.sku ?? sku;
  };

  const errores: string[] = [];
  const movimientos = crudos.map((m: any, i: number) => {
    const sku = String(m?.sku ?? "").trim();
    const tipo = String(m?.tipo ?? "entrada") as TipoMovimiento;
    const cantidad = Math.round(Number(m?.cantidad));

    if (!sku) errores.push(`Renglón ${i + 1}: falta el SKU.`);
    if (!TIPOS.includes(tipo)) errores.push(`Renglón ${i + 1}: tipo "${tipo}" desconocido.`);
    if (!Number.isFinite(cantidad) || cantidad < 0) {
      errores.push(`Renglón ${i + 1}: la cantidad tiene que ser un número de 0 para arriba.`);
    }

    return {
      sku: amarrar(sku),
      tipo,
      cantidad,
      motivo: m?.motivo ? String(m.motivo) : tipo === "entrada" ? "Entrada capturada a mano" : null,
      nota: m?.nota ? String(m.nota) : null,
      fecha: m?.fecha ? new Date(m.fecha).toISOString() : undefined,
    };
  });

  if (errores.length) return NextResponse.json({ error: errores.join(" ") }, { status: 400 });

  try {
    const r = await registrarMovimientos(supabase, cuenta.id, movimientos, user.id);

    // Y aquí es donde la entrada se vuelve inventario que un comprador puede
    // ver. REGLA DE ORO: nunca se le escribe a TikTok sin antes leer sus
    // pedidos recientes — si no, una captura pisaría las ventas de los
    // últimos minutos. Por eso va la sincronización de pedidos completa (sin
    // catálogo ni Industher), que termina publicando.
    let publicacion: unknown = null;
    if (body?.publicar !== false) {
      try {
        const r = await sincronizarTikTok(clienteAdmin(), cuenta.id, { soloPedidos: true });
        publicacion = { publicados: r.publicados, avisos: r.avisos };
      } catch (err) {
        publicacion = { error: (err as Error).message };
      }
    }

    return NextResponse.json({ ok: true, ...r, publicacion });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
