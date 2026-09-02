import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarDesfases } from "@/lib/servicios/tiktok-panel";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

/** Dónde TikTok, el kardex y el 3PL no dicen lo mismo, y por qué. */
export default async function Desfases() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <div className="tarjeta mx-auto max-w-lg p-8 text-center">Conecta Mercado Libre primero.</div>;

  const d = await cargarDesfases(supabase, cuenta.id);
  const n = (x: number | null) => (x == null ? "—" : x.toLocaleString("es-MX"));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Desfases TikTok</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Tres números por SKU —lo que dice TikTok, lo que dice el kardex y lo que reporta Industher— y
          la razón de cada diferencia. Si esta lista está vacía, todo cuadra.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Ficha titulo="SKUs revisados" valor={d.revisados} />
        <Ficha titulo="Con desfase" valor={d.desfases.length} tono={d.desfases.length ? "alerta" : "bien"} />
        <Ficha titulo="Bodega en Industher" valor={d.bodega3pl ?? "no reportada"} nota={d.bodega3pl ? "" : "el API aún no la manda"} />
      </div>

      <section className="tarjeta overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                <th className="px-4 py-2 font-semibold">SKU</th>
                <th className="px-4 py-2 text-right font-semibold">Kardex</th>
                <th className="px-4 py-2 text-right font-semibold">Apartado</th>
                <th className="px-4 py-2 text-right font-semibold">Disponible</th>
                <th className="px-4 py-2 text-right font-semibold">TikTok</th>
                <th className="px-4 py-2 text-right font-semibold">Industher</th>
                <th className="px-4 py-2 font-semibold">Por qué</th>
              </tr>
            </thead>
            <tbody>
              {d.desfases.map((r) => (
                <tr key={r.sku} className="hairline align-top">
                  <td className="px-4 py-2 font-medium">{r.sku}</td>
                  <td className="num px-4 py-2 text-right" style={{ color: r.saldo < 0 ? "var(--estado-critico)" : undefined }}>{n(r.saldo)}</td>
                  <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }}>{r.apartado || "—"}</td>
                  <td className="num px-4 py-2 text-right font-semibold">{n(r.disponible)}</td>
                  <td className="num px-4 py-2 text-right">{n(r.enTikTok)}</td>
                  <td className="num px-4 py-2 text-right">{n(r.en3pl)}</td>
                  <td className="px-4 py-2 text-xs" style={{ color: "var(--ink-2)" }}>
                    {r.razones.map((x) => (
                      <div key={x}>{x}</div>
                    ))}
                  </td>
                </tr>
              ))}
              {!d.desfases.length ? (
                <tr>
                  <td className="px-4 py-8 text-center text-sm" colSpan={7} style={{ color: "var(--exito-texto)" }}>
                    Todo cuadra: TikTok, el kardex e Industher dicen lo mismo.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
