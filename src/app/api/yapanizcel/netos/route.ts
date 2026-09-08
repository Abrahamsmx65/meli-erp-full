import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { esCron } from "@/lib/yapanizcel/api";
import { correrNetos } from "@/lib/yapanizcel/netos";
import { revisarPendientesYz } from "@/lib/yapanizcel/devoluciones";
import { almacenYz } from "@/lib/yapanizcel/corte";
import { continuarCargosCon } from "@/lib/servicios/cargos-meli";
import { clavesObsoletasYz } from "@/lib/yapanizcel/cache";
import { obtenerCompras } from "@/lib/yapanizcel/compras";
import { obtenerPlanYz } from "@/lib/yapanizcel/envios";
import { obtenerInventarioAmarrado, obtenerInventarioPantalla } from "@/lib/yapanizcel/inventario-pantalla";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Trabajo de fondo de YAPANIZCEL: el neto real de cada orden, orden por
 * orden contra Mercado Pago, y el registro hacia atrás de las órdenes
 * viejas. Cron cada 10 minutos (~4 minutos y medio de trabajo por corrida)
 * o a mano con sesión.
 */
async function autorizado(req: NextRequest): Promise<boolean> {
  if (esCron(req)) return true;
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const admin = clienteAdmin();
  const { data: cuentas } = await admin.from("yz_cuentas").select("id, nickname");
  const resultados: Record<string, unknown>[] = [];
  const t0 = Date.now();
  for (const c of cuentas ?? []) {
    const r: Record<string, unknown> = { cuenta: c.nickname };
    try {
      // Netos: hasta ~3 minutos; luego devoluciones y facturación con lo que quede.
      Object.assign(r, await correrNetos(admin, c.id, Math.min(190_000, 270_000 - (Date.now() - t0))));
    } catch (err) {
      r.error = (err as Error).message;
    }
    if (Date.now() - t0 < 230_000) {
      try {
        r.revision = await revisarPendientesYz(admin, c.id, t0 + 250_000);
      } catch (err) {
        r.revisionError = (err as Error).message;
      }
    }
    if (Date.now() - t0 < 240_000) {
      try {
        r.cargos = await continuarCargosCon(admin, c.id, await almacenYz(admin, c.id), t0 + 275_000);
      } catch (err) {
        r.cargosError = (err as Error).message;
      }
    }

    // Con lo que sobre del presupuesto: dejar PRECALCULADO lo que los syncs
    // o las escrituras invalidaron (compras, plan, inventario, amarre), para
    // que las pantallas de fundas lean un renglón masticado y nunca paguen
    // el cálculo en el clic. obtener* calcula y guarda solo si está viejo.
    if (Date.now() - t0 < 250_000) {
      try {
        const obsoletas = await clavesObsoletasYz(admin, c.id);
        const precalculadas: string[] = [];
        for (const clave of obsoletas) {
          if (Date.now() - t0 > 265_000) break;
          if (clave === "compras") await obtenerCompras(admin, c.id);
          else if (clave === "plan") await obtenerPlanYz(admin, c.id);
          else if (clave === "inventario") await obtenerInventarioPantalla(admin, c.id);
          else if (clave === "amarre") await obtenerInventarioAmarrado(admin, c.id);
          precalculadas.push(clave);
        }
        if (precalculadas.length) r.precalculadas = precalculadas;
      } catch (err) {
        r.precalculoError = (err as Error).message;
      }
    }
    resultados.push(r);
  }
  return NextResponse.json({ ok: true, resultados });
}
