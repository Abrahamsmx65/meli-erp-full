import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarDesfases } from "@/lib/servicios/tiktok-panel";
import { Ficha } from "@/components/tiles";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/** Dónde TikTok, el kardex y el 3PL no dicen lo mismo, y por qué. */
export default async function Desfases() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Desfases TikTok" />;

  const d = await cargarDesfases(supabase, cuenta.id);
  const n = (x: number | null) => (x == null ? "—" : x.toLocaleString("es-MX"));

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Desfases TikTok"
        descripcion="Por SKU, lo que dicen TikTok, el kardex e Industher, y la razón de cada diferencia."
      />

      <Cifras columnas={3}>
        <Ficha titulo="SKUs revisados" valor={d.revisados} />
        <Ficha titulo="Con desfase" valor={d.desfases.length} tono={d.desfases.length ? "alerta" : "bien"} />
        <Ficha titulo="Bodega en Industher" valor={d.bodega3pl ?? "no reportada"} nota={d.bodega3pl ? "" : "el API aún no la manda"} />
      </Cifras>

      {d.desfases.length ? (
        <Seccion titulo="SKU con desfase" descripcion={`${d.desfases.length} SKU`} sinRelleno>
          <Tabla>
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th className="num">Kardex</th>
                  <th className="num">Apartado</th>
                  <th className="num">Disponible</th>
                  <th className="num">TikTok</th>
                  <th className="num">Industher</th>
                  <th>Por qué</th>
                </tr>
              </thead>
              <tbody>
                {d.desfases.map((r) => (
                  <tr key={r.sku} className="align-top">
                    <td className="font-medium">{r.sku}</td>
                    <td className="num cifra" style={{ color: r.saldo < 0 ? "var(--estado-critico)" : undefined }}>{n(r.saldo)}</td>
                    <td className="num cifra texto-2">{r.apartado || "—"}</td>
                    <td className="num cifra font-semibold">{n(r.disponible)}</td>
                    <td className="num cifra">{n(r.enTikTok)}</td>
                    <td className="num cifra">{n(r.en3pl)}</td>
                    <td className="texto-2 text-xs">
                      {r.razones.map((x) => (
                        <div key={x}>{x}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tabla>
        </Seccion>
      ) : (
        <Aviso tono="bien">Todo cuadra: TikTok, el kardex e Industher dicen lo mismo.</Aviso>
      )}
    </Pagina>
  );
}
