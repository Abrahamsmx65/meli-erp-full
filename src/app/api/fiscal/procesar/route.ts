import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import {
  cerrarSync,
  conCandado,
  RecursoOcupadoError,
  registrarSync,
} from "@/lib/datos/repos";
import { MeliClient } from "@/lib/meli/client";
import { enviarFiscalPendiente, leerFiscalFaltante } from "@/lib/servicios/fiscal";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Proceso en segundo plano de datos fiscales: primero empuja a MELI lo que el
 * usuario capturó (filas `pendiente`), luego lee del API lo que falte del
 * catálogo. Mismo esquema que los SKUs pendientes: contesta 202 al instante,
 * trabaja después de responder y, si se acaba el presupuesto de tiempo con
 * trabajo restante, se vuelve a lanzar solo.
 */
export async function POST(req: NextRequest) {
  const noAutorizado = await verificar(req);
  if (noAutorizado) return noAutorizado;

  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => procesar(origen));
  return NextResponse.json({ ok: true, encolado: true }, { status: 202 });
}

/** Con sesión, abrirlo desde la app también lo enciende. */
export async function GET(req: NextRequest) {
  const noAutorizado = await verificar(req);
  if (noAutorizado) return noAutorizado;

  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => procesar(origen));

  const { count } = await clienteAdmin()
    .from("datos_fiscales")
    .select("*", { count: "exact", head: true })
    .eq("estado", "pendiente");
  return NextResponse.json({ ok: true, encolado: true, pendientes: count ?? 0 }, { status: 202 });
}

async function verificar(req: NextRequest): Promise<NextResponse | null> {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (Boolean(secreto) && auth === `Bearer ${secreto}`) return null;

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  return null;
}

async function procesar(origen: string): Promise<void> {
  const admin = clienteAdmin();
  const t0 = Date.now();
  const PRESUPUESTO_MS = 230_000; // margen dentro de los 300 s de Vercel
  const sigue = () => Date.now() - t0 < PRESUPUESTO_MS;

  const { data: cuentas } = await admin.from("meli_accounts").select("id").limit(50);

  let avance = 0;
  let restante = 0;

  for (const cuenta of cuentas ?? []) {
    const accountId = cuenta.id as string;
    if (!sigue()) {
      restante++;
      continue;
    }

    try {
      await conCandado(admin, accountId, "datos_fiscales", 300, async () => {
        // La bitácora abre ANTES que nada: la página usa el renglón
        // "corriendo" para saber que el proceso está vivo.
        const logId = await registrarSync(admin, accountId, "datos_fiscales");

        const { data: tok } = await admin
          .from("meli_tokens")
          .select("access_token, refresh_token, expira_en")
          .eq("account_id", accountId)
          .single();
        if (!tok) {
          await cerrarSync(admin, logId, "ok", { sinTokens: true });
          return; // cuenta sin conectar: nada que hacer
        }

        const cliente = new MeliClient({
          clientId: process.env.MELI_CLIENT_ID!,
          clientSecret: process.env.MELI_CLIENT_SECRET!,
          credenciales: {
            accessToken: tok.access_token,
            refreshToken: tok.refresh_token,
            expiraEn: new Date(tok.expira_en).getTime(),
          },
          alRenovar: async (c) => {
            await admin
              .from("meli_tokens")
              .update({
                access_token: c.accessToken,
                refresh_token: c.refreshToken,
                expira_en: new Date(c.expiraEn).toISOString(),
                actualizado_en: new Date().toISOString(),
              })
              .eq("account_id", accountId);
          },
        });

        try {
          // Lo capturado por el usuario va primero: es lo que está esperando.
          const envio = await enviarFiscalPendiente(admin, cliente, accountId, sigue);
          const lectura = await leerFiscalFaltante(admin, cliente, accountId, sigue);

          avance += envio.enviados + envio.fallidos + lectura.itemsLeidos;
          restante += envio.restantes + lectura.itemsRestantes;

          await cerrarSync(admin, logId, "ok", {
            enviados: envio.enviados,
            fallidos: envio.fallidos,
            itemsLeidos: lectura.itemsLeidos,
            skusLeidos: lectura.skusLeidos,
            sinDatos: lectura.sinDatos,
            restantes: envio.restantes + lectura.itemsRestantes,
            errores: lectura.errores.slice(0, 5),
          });
        } catch (err) {
          await cerrarSync(admin, logId, "error", { mensaje: (err as Error).message });
        }
      });
    } catch (err) {
      if (!(err instanceof RecursoOcupadoError)) {
        console.error("fiscal/procesar:", (err as Error).message);
      }
    }
  }

  // ¿Queda trabajo y esta corrida sí avanzó? Se relanza solo.
  const secreto = process.env.CRON_SECRET;
  if (restante > 0 && avance > 0 && secreto) {
    try {
      await fetch(`${origen}/api/fiscal/procesar`, {
        method: "POST",
        headers: { authorization: `Bearer ${secreto}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Si el eslabón no prende, el botón de la página lo relanza.
    }
  }
}
