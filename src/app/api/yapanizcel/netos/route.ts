import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { esCron } from "@/lib/yapanizcel/api";
import { correrNetos } from "@/lib/yapanizcel/netos";
import { revisarPendientesYz } from "@/lib/yapanizcel/devoluciones";
import { almacenYz } from "@/lib/yapanizcel/corte";
import { continuarCargosCon } from "@/lib/servicios/cargos-meli";
import { clavesObsoletasYz } from "@/lib/yapanizcel/cache";
import { recalcularCompras } from "@/lib/yapanizcel/compras";
import { recalcularPlanYz } from "@/lib/yapanizcel/envios";
import { recalcularInventarioAmarrado, recalcularInventarioPantalla } from "@/lib/yapanizcel/inventario-pantalla";
import { recalcularListaPedidos } from "@/lib/yapanizcel/pedidos";
import { recalcularDisenosFundas } from "@/lib/servicios/productos";

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
    // Presupuesto total de ~265 s de los 300 de Vercel: netos hasta ~2.5
    // minutos, devoluciones hasta 200 s, precálculo hasta ~235 s,
    // facturación hasta 265 s. Todo mira el reloj; pasarse mata la función
    // sin guardar nada.
    try {
      Object.assign(r, await correrNetos(admin, c.id, Math.min(150_000, 240_000 - (Date.now() - t0))));
    } catch (err) {
      r.error = (err as Error).message;
    }
    if (Date.now() - t0 < 185_000) {
      try {
        r.revision = await revisarPendientesYz(admin, c.id, t0 + 200_000, 60);
      } catch (err) {
        r.revisionError = (err as Error).message;
      }
    }

    // Dejar PRECALCULADO lo que los syncs o las escrituras invalidaron Y lo
    // que ya envejeció (clavesObsoletasYz también mira la edad: las
    // pantallas sirven el renglón guardado aunque esté viejo y NUNCA
    // calculan en el clic, así que este es el único lugar que refresca). Va
    // ANTES de la facturación, que es reanudable y se pasea a 12.5 s por
    // petición: cuando iba al final casi nunca le tocaba tiempo y la
    // pantalla de Pedidos a China pagaba los 10 s del cálculo en cada sync.
    if (Date.now() - t0 < 225_000) {
      try {
        const obsoletas = await clavesObsoletasYz(admin, c.id);
        const precalculadas: string[] = [];
        for (const clave of obsoletas) {
          if (Date.now() - t0 > 235_000) break;
          if (clave === "compras") await recalcularCompras(admin, c.id);
          else if (clave === "plan") await recalcularPlanYz(admin, c.id);
          else if (clave === "inventario") await recalcularInventarioPantalla(admin, c.id);
          else if (clave === "amarre") await recalcularInventarioAmarrado(admin, c.id);
          else if (clave === "disenos") await recalcularDisenosFundas(admin, c.id);
          else if (clave === "pedidos") await recalcularListaPedidos(admin, c.id);
          precalculadas.push(clave);
        }
        if (precalculadas.length) r.precalculadas = precalculadas;
      } catch (err) {
        r.precalculoError = (err as Error).message;
      }
    }
    if (Date.now() - t0 < 240_000) {
      try {
        r.cargos = await continuarCargosCon(admin, c.id, await almacenYz(admin, c.id), t0 + 265_000);
      } catch (err) {
        r.cargosError = (err as Error).message;
      }
    }
    resultados.push(r);
  }
  return NextResponse.json({ ok: true, resultados });
}
