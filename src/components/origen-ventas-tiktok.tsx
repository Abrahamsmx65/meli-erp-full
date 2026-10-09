import type { OrigenVentas } from "@/lib/tiktok/ventas";
import { Ayuda, Seccion } from "@/components/ui/pagina";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

function pct(x: number): string {
  return `${x >= 10 ? Math.round(x) : Math.round(x * 10) / 10}%`;
}

/** Color por origen: los creadores con el acento, la tienda en gris, lo sin revisar en gris rayado. */
const SEGMENTOS: { clave: "creadores" | "tienda" | "sinRevisar"; nombre: string; fondo: string }[] = [
  { clave: "creadores", nombre: "Creadores", fondo: "var(--acento)" },
  { clave: "tienda", nombre: "Tienda (nosotros)", fondo: "var(--ink-muted)" },
  { clave: "sinRevisar", nombre: "Sin revisar aún", fondo: "repeating-linear-gradient(135deg, var(--ink-muted) 0 3px, transparent 3px 7px)" },
];

/**
 * De dónde vino la venta del rango: una barra apilada creadores / tienda /
 * sin revisar con su % de lo cobrado, y el top 10 de creadores. Pedido del
 * dueño (1-oct-2026): «una gráfica de cuánto es por creadores y cuánto por
 * mí, y el top 10 de creadores que generaron la venta y su porcentaje».
 */
export function OrigenVentasTikTok({ origen }: { origen: OrigenVentas }) {
  const total = origen.total;
  const segmentos = SEGMENTOS.map((s) => ({ ...s, bloque: origen[s.clave] })).filter((s) => s.bloque.cobrado > 0);
  const maxCreador = origen.top[0]?.cobrado ?? 0;
  return (
    <Seccion titulo="Origen de la venta" descripcion="Creadores contra la tienda sola, en % de lo cobrado." sinRelleno>
      <div className="px-4 pt-3">
        <Ayuda titulo="¿De dónde sale?">
          <p>
            Quién trajo cada pedido en pie del rango, según el endpoint de afiliados de TikTok: lo que vendió un creador y lo
            que vendió la tienda sola. Porcentajes sobre lo cobrado.
          </p>
          <p>Un pedido que todavía no se revisa contra TikTok (se leen cada hora) se declara aparte, no se cuenta como nuestro.</p>
        </Ayuda>
      </div>

      {total.cobrado > 0 ? (
        <div className="px-4 pt-4">
          <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={`Creadores ${pct(origen.creadores.porcentaje)}, tienda ${pct(origen.tienda.porcentaje)}, sin revisar ${pct(origen.sinRevisar.porcentaje)}`}>
            {segmentos.map((s) => (
              <div key={s.clave} className="h-full" style={{ width: `${s.bloque.porcentaje}%`, background: s.fondo }} title={`${s.nombre}: ${pct(s.bloque.porcentaje)} · ${pesos(s.bloque.cobrado)}`} />
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {SEGMENTOS.map((s) => {
              const b = origen[s.clave];
              return (
                <div key={s.clave} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-[2px]" style={{ background: s.fondo }} aria-hidden />
                  <div>
                    <div className="font-medium">
                      {s.nombre} · <span className="num">{pct(b.porcentaje)}</span>
                    </div>
                    <div className="num text-xs texto-2">
                      {pesos(b.cobrado)} · {n(b.pedidos)} pedidos · {n(b.unidades)} pares
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="px-4 pt-4 text-sm texto-2">
          Sin ventas en el rango.
        </p>
      )}

      <div className="tabla-caja mt-4">
        <table className="datos">
          <thead>
            <tr>
              <th>#</th>
              <th>Creador</th>
              <th className="num">Pedidos</th>
              <th className="num">Pares</th>
              <th className="num">Cobrado</th>
              <th className="num">% de la venta</th>
              <th aria-label="Proporción" />
            </tr>
          </thead>
          <tbody>
            {origen.top.map((c, i) => (
              <tr key={c.creador}>
                <td className="num cifra texto-tenue">{i + 1}</td>
                <td className="font-medium">@{c.creador}</td>
                <td className="num cifra">{n(c.pedidos)}</td>
                <td className="num cifra">{n(c.unidades)}</td>
                <td className="num cifra">{pesos(c.cobrado)}</td>
                <td className="num cifra font-semibold">{pct(c.porcentaje)}</td>
                <td style={{ width: "22%" }}>
                  <div className="h-2 w-full rounded-[4px]" style={{ background: "var(--superficie-2, rgba(0,0,0,0.06))" }}>
                    <div className="h-2 rounded-[4px]" style={{ width: `${maxCreador > 0 ? (c.cobrado / maxCreador) * 100 : 0}%`, background: "var(--acento)" }} />
                  </div>
                </td>
              </tr>
            ))}
            {!origen.top.length ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm texto-2" colSpan={7}>
                  {origen.sinRevisar.pedidos > 0 ? "Todavía no se leen los afiliados de estos pedidos; se revisan cada hora." : "Ningún creador vendió en el rango."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {origen.creadoresDistintos > origen.top.length ? (
          <p className="px-4 pb-4 pt-2 text-xs texto-2">
            Top {origen.top.length} de {n(origen.creadoresDistintos)} creadores que vendieron en el rango.
          </p>
        ) : (
          <div className="pb-2" />
        )}
      </div>
    </Seccion>
  );
}
