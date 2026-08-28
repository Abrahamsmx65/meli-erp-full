import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { Cliente, cuentasAmazon } from "@/lib/amazon/spapi";
import { completarFnskus, DIAS_REPREGUNTA } from "@/lib/amazon/fnsku";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Presupuesto por vuelta; deja margen dentro de los 300 s de Vercel. */
const PRESUPUESTO_MS = 230_000;

/** Cuántos SKUs se atacan por vuelta (50 por llamada, cuota de 2 por segundo). */
const POR_VUELTA = 1500;

/**
 * Completa el FNSKU que le falta al catálogo de Amazon.
 *
 * La pantalla de etiquetas ya resuelve sola lo que trae en la lista; esto es
 * para el resto del catálogo — miles de SKUs cuyo listing está agotado o
 * pausado en FBA y por eso nunca salieron en el reporte de inventario. Sirve
 * sobre todo para que el buscador de la pantalla los ofrezca.
 *
 * Contesta de inmediato y trabaja después: son ~6 mil SKUs a 50 por llamada
 * con cuota de 2 por segundo, así que no cabe en una sola invocación. Cuando
 * se acaba el presupuesto se vuelve a lanzar solo, hasta que ya no queda nada
 * que preguntar.
 */
export async function POST(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const esCron = Boolean(secreto) && auth === `Bearer ${secreto}`;

  if (!esCron) {
    const supabase = await clienteServidor();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  }

  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => procesar(origen));

  return NextResponse.json(
    { ok: true, encolado: true, pendientes: await pendientes() },
    { status: 202 },
  );
}

/** Con sesión, abrir la URL en el navegador también lo enciende. */
export async function GET(req: NextRequest) {
  return POST(req);
}

/** Cuántos SKUs del catálogo siguen sin FNSKU y sin preguntar. */
async function pendientes(): Promise<number> {
  const corte = new Date(Date.now() - DIAS_REPREGUNTA * 86_400_000).toISOString();
  const { count } = await clienteAdmin()
    .from("amazon_skus")
    .select("*", { count: "exact", head: true })
    .is("fnsku", null)
    .neq("canal", "DEFAULT")
    .or(`fnsku_consultado_en.is.null,fnsku_consultado_en.lt.${corte}`);
  return count ?? 0;
}

async function procesar(origen: string): Promise<void> {
  const admin = clienteAdmin();
  const limite = Date.now() + PRESUPUESTO_MS;

  let preguntados = 0;
  for (const cuenta of await cuentasAmazon(admin)) {
    try {
      const r = await completarFnskus(admin, new Cliente(cuenta, limite), { limite: POR_VUELTA });
      preguntados += r.preguntados;
    } catch {
      // Una cuenta que truena no debe frenar a las demás; lo suyo se queda
      // pendiente y la siguiente vuelta lo reintenta.
    }
  }

  // ¿Queda trabajo? Este mismo proceso se vuelve a lanzar y sigue. La nueva
  // invocación contesta 202 al instante, así que aquí no se espera casi nada.
  const secreto = process.env.CRON_SECRET;
  if (preguntados > 0 && secreto && (await pendientes()) > 0) {
    try {
      await fetch(`${origen}/api/amazon/fnskus`, {
        method: "POST",
        headers: { authorization: `Bearer ${secreto}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Si el eslabón no prende, el latido lo sigue avanzando de a poco.
    }
  }
}
