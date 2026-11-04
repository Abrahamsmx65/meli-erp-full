import type { FuentesDeVenta } from "@/lib/servicios/tiktok-fuentes";
import type { ClaveFuente } from "@/lib/tiktok/fuentes-venta";
import { Aviso, Seccion } from "@/components/ui/pagina";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

function pct(x: number): string {
  return `${x >= 10 ? Math.round(x) : Math.round(x * 10) / 10}%`;
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  return new Date(Date.parse(`${iso}T12:00:00Z`)).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

/** Un tono por fuente: LIVE con el acento, el resto en la escala de grises de la página. */
const FONDO: Record<ClaveFuente, string> = {
  live: "var(--acento)",
  video: "var(--ink)",
  tarjeta: "var(--ink-muted)",
  buscador: "rgba(0,0,0,0.28)",
  pestanaTienda: "rgba(0,0,0,0.16)",
  otros: "repeating-linear-gradient(135deg, var(--ink-muted) 0 3px, transparent 3px 7px)",
};

/**
 * Por dónde se vendió: LIVE, video, tarjeta de producto, buscador y pestaña
 * Tienda, con lo nuestro contra lo de los creadores en cada una. Es la
 * analítica de TikTok tal cual (GMV por día); no es la venta del resumen de
 * arriba, que sale de los pedidos. Pedido del dueño (4-nov-2026).
 */
export function FuentesVentaTikTok({ fuentes, rango }: { fuentes: FuentesDeVenta; rango: { desde: string; hasta: string } }) {
  const r = fuentes.resumen;
  const parcial = r.dias > 0 && (r.desde! > rango.desde || r.hasta! < rango.hasta);
  const filas: { clave: "live" | "video" | "tarjeta"; nombre: string }[] = [
    { clave: "live", nombre: "LIVE" },
    { clave: "video", nombre: "Video" },
    { clave: "tarjeta", nombre: "Tarjeta de producto" },
  ];
  return (
    <Seccion
      titulo="Por dónde se vendió"
      descripcion="Según la analítica de TikTok: GMV del rango por LIVE, video, tarjeta de producto, buscador y pestaña Tienda."
    >
      {fuentes.sinLectura ? (
        <Aviso tono="info">TikTok todavía no entrega la analítica de la tienda: la primera lectura corre en la siguiente hora.</Aviso>
      ) : null}
      {fuentes.error ? (
        <Aviso tono="alerta" titulo="La última lectura de la analítica falló">
          TikTok contestó: {fuentes.error}. Si dice que falta permiso, hay que autorizar «Analytics» a la app en el Partner Center y volver a conectar la tienda.
        </Aviso>
      ) : null}
      {r.dias > 0 ? (
        <>
          {parcial ? (
            <p className="mb-2 text-xs texto-2">
              Con dato del {fechaCorta(r.desde)} al {fechaCorta(r.hasta)}; el resto del rango aún no se lee.
            </p>
          ) : null}
          <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={r.fuentes.map((f) => `${f.nombre} ${pct(f.porcentaje)}`).join(", ")}>
            {r.fuentes.map((f) => (
              <div key={f.clave} className="h-full" style={{ width: `${f.porcentaje}%`, background: FONDO[f.clave] }} title={`${f.nombre}: ${pct(f.porcentaje)} · ${pesos(f.monto)}`} />
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {r.fuentes.map((f) => (
              <div key={f.clave} className="flex items-start gap-2 text-sm">
                <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-[2px]" style={{ background: FONDO[f.clave] }} aria-hidden />
                <div>
                  <div className="font-medium">
                    {f.nombre} · <span className="num">{pct(f.porcentaje)}</span>
                  </div>
                  <div className="num text-xs texto-2">{pesos(f.monto)}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="tabla-caja mt-4">
            <table className="datos">
              <thead>
                <tr>
                  <th>Fuente</th>
                  <th className="num">Nosotros</th>
                  <th className="num">Creadores</th>
                  <th className="num">Total</th>
                  <th className="num">% creadores</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const nosotros = r.vendedor[f.clave];
                  const creadores = r.creadores[f.clave];
                  const total = nosotros + creadores;
                  return (
                    <tr key={f.clave}>
                      <td className="font-medium">{f.nombre}</td>
                      <td className="num cifra">{pesos(nosotros)}</td>
                      <td className="num cifra">{pesos(creadores)}</td>
                      <td className="num cifra font-medium">{pesos(total)}</td>
                      <td className="num cifra">{total > 0 ? pct((creadores / total) * 100) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs texto-2">
            GMV {pesos(r.gmv)} · {n(r.pedidos)} pedidos · {n(r.piezas)} piezas en {r.dias} día{r.dias === 1 ? "" : "s"} con dato. Lo de hoy y ayer se vuelve a leer cada hora.
          </p>
        </>
      ) : !fuentes.sinLectura && !fuentes.error ? (
        <p className="text-sm texto-2">Sin dato de TikTok para estas fechas todavía.</p>
      ) : null}
    </Seccion>
  );
}
