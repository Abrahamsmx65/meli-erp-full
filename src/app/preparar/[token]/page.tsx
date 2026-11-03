import Link from "next/link";
import { cuentaPorTokenPreparar } from "@/lib/servicios/acceso-preparar";
import { clienteAdmin } from "@/lib/supabase/server";
import { avanceDeCortes } from "@/lib/servicios/tiktok-despacho";
import { Aviso, Encabezado, Pagina } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/** Sin sesión: la lista de cortes para elegir cuál preparar. La puerta es el token. */
export default async function CortesPublicos({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cuenta = await cuentaPorTokenPreparar(token);
  if (!cuenta) {
    return (
      <Pagina>
        <Aviso tono="critico" titulo="Este link ya no sirve">Pide el link nuevo a quien administra el despacho.</Aviso>
      </Pagina>
    );
  }

  const admin = clienteAdmin();
  let cortes: any[] = [];
  const hechos = new Map<number, number>();
  try {
    // El avance "X/Y" sale SOLO de los cortes listados (RPC agrupado o, si
    // no contesta, sus preparaciones paginadas): antes se bajaban todas las
    // preparaciones de la historia para contar 15 cortes.
    const rCortes = await admin
      .from("tiktok_cortes")
      .select("id, numero, creado_en, pedidos, pares")
      .eq("account_id", cuenta.id)
      .order("numero", { ascending: false })
      .limit(15);
    if (rCortes.error) throw new Error(rCortes.error.message);
    cortes = rCortes.data ?? [];
    const avance = await avanceDeCortes(admin, cuenta.id, cortes.map((c: any) => Number(c.id)));
    for (const [id, a] of avance) hechos.set(id, a.preparados);
  } catch (err) {
    // Pantalla de bodega, sin sesión: mejor decir qué pasó y dar el botón de
    // reintentar que una pantalla de error genérica. Nunca pintar la lista
    // vacía como si no hubiera cortes.
    return (
      <Pagina className="mx-auto w-full max-w-2xl">
        <Encabezado ceja="TikTok Shop" titulo="Preparar pedidos · TikTok" />
        <Aviso tono="critico" titulo="No se pudieron leer los cortes">
          {(err as Error).message}. Suele ser un tropiezo momentáneo de la base.
        </Aviso>
        <div>
          <Link href={`/preparar/${token}`} className="boton boton-primario">
            Reintentar
          </Link>
        </div>
      </Pagina>
    );
  }

  return (
    <Pagina className="mx-auto w-full max-w-2xl">
      <Encabezado
        ceja="TikTok Shop"
        titulo="Preparar pedidos · TikTok"
        descripcion="Elige el corte que vas a preparar."
        acciones={
          <Link href={`/preparar/${token}/conteo`} className="boton boton-borde">
            Conteo cíclico →
          </Link>
        }
      />
      <ul className="tarjeta divide-y overflow-hidden">
        {(cortes ?? []).map((c: any) => {
          const h = hechos.get(c.id) ?? 0;
          const completo = c.pedidos > 0 && h >= c.pedidos;
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 hairline">
              <div>
                <div className="text-sm font-semibold">Corte #{c.numero}</div>
                <div className="text-xs texto-2">
                  {new Date(c.creado_en).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {" · "}{c.pedidos} pedidos · {c.pares} pares · {h}/{c.pedidos} preparados
                </div>
              </div>
              <Link
                href={`/preparar/${token}/${c.id}`}
                className={completo ? "boton boton-borde" : "boton boton-primario"}
              >
                {completo ? "Ver" : "Preparar"}
              </Link>
            </li>
          );
        })}
        {!cortes?.length ? <li className="px-4 py-6 text-center text-sm texto-2">Todavía no hay cortes.</li> : null}
      </ul>
    </Pagina>
  );
}
