import Link from "next/link";
import { cuentaPorTokenPreparar } from "@/lib/servicios/acceso-preparar";
import { clienteAdmin } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/datos/repos";

export const dynamic = "force-dynamic";

/** Sin sesión: la lista de cortes para elegir cuál preparar. La puerta es el token. */
export default async function CortesPublicos({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cuenta = await cuentaPorTokenPreparar(token);
  if (!cuenta) {
    return <div className="tarjeta mx-auto max-w-lg p-8 text-center">Este link ya no sirve.</div>;
  }

  const admin = clienteAdmin();
  let cortes: any[] = [];
  const hechos = new Map<number, number>();
  try {
    // Paginado: tiktok_preparaciones crece un renglón por pedido preparado y
    // nunca se borra; al pasar de 1,000, el avance "X/Y" saldría corto.
    const [rCortes, prep] = await Promise.all([
      admin
        .from("tiktok_cortes")
        .select("id, numero, creado_en, pedidos, pares")
        .eq("account_id", cuenta.id)
        .order("numero", { ascending: false })
        .limit(15),
      traerTodo<{ corte_id: number }>(admin, "tiktok_preparaciones", "corte_id", (q) =>
        q.eq("account_id", cuenta.id),
      ),
    ]);
    if (rCortes.error) throw new Error(rCortes.error.message);
    cortes = rCortes.data ?? [];
    for (const r of prep) hechos.set(r.corte_id, (hechos.get(r.corte_id) ?? 0) + 1);
  } catch (err) {
    // Pantalla de bodega, sin sesión: mejor decir qué pasó y dar el botón de
    // reintentar que una pantalla de error genérica. Nunca pintar la lista
    // vacía como si no hubiera cortes.
    return (
      <div className="tarjeta mx-auto flex max-w-lg flex-col items-center gap-3 p-8 text-center">
        <h1 className="titulo-seccion">No se pudieron leer los cortes</h1>
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          {(err as Error).message}. Suele ser un tropiezo momentáneo de la base.
        </p>
        <Link
          href={`/preparar/${token}`}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ background: "var(--acento)" }}
        >
          Reintentar
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="titulo-pagina">Preparar pedidos · TikTok</h1>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>Elige el corte que vas a preparar.</p>
        <Link href={`/preparar/${token}/conteo`} className="text-sm underline" style={{ color: "var(--acento)" }}>
          Conteo cíclico →
        </Link>
      </div>
      <ul className="tarjeta divide-y overflow-hidden">
        {(cortes ?? []).map((c: any) => {
          const h = hechos.get(c.id) ?? 0;
          const completo = c.pedidos > 0 && h >= c.pedidos;
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 hairline">
              <div>
                <div className="text-sm font-semibold">Corte #{c.numero}</div>
                <div className="text-xs" style={{ color: "var(--ink-2)" }}>
                  {new Date(c.creado_en).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {" · "}{c.pedidos} pedidos · {c.pares} pares · {h}/{c.pedidos} preparados
                </div>
              </div>
              <Link
                href={`/preparar/${token}/${c.id}`}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                style={{ background: completo ? "var(--ink-muted)" : "var(--acento)" }}
              >
                {completo ? "Ver" : "Preparar"}
              </Link>
            </li>
          );
        })}
        {!cortes?.length ? <li className="px-4 py-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>Todavía no hay cortes.</li> : null}
      </ul>
    </div>
  );
}
