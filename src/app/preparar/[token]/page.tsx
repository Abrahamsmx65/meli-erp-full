import Link from "next/link";
import { cuentaPorTokenPreparar } from "@/lib/servicios/acceso-preparar";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Sin sesión: la lista de cortes para elegir cuál preparar. La puerta es el token. */
export default async function CortesPublicos({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cuenta = await cuentaPorTokenPreparar(token);
  if (!cuenta) {
    return <div className="tarjeta mx-auto max-w-lg p-8 text-center">Este link ya no sirve.</div>;
  }

  const admin = clienteAdmin();
  const [{ data: cortes }, { data: prep }] = await Promise.all([
    admin
      .from("tiktok_cortes")
      .select("id, numero, creado_en, pedidos, pares")
      .eq("account_id", cuenta.id)
      .order("numero", { ascending: false })
      .limit(15),
    admin.from("tiktok_preparaciones").select("corte_id").eq("account_id", cuenta.id),
  ]);
  const hechos = new Map<number, number>();
  for (const r of prep ?? []) hechos.set(r.corte_id, (hechos.get(r.corte_id) ?? 0) + 1);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Preparar pedidos · TikTok</h1>
      <p className="text-sm" style={{ color: "var(--ink-2)" }}>Elige el corte que vas a preparar.</p>
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
