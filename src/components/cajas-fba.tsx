import type { CajaPlaneada } from "@/lib/servicios/plan";
import type { PlanFbaCajas } from "@/lib/servicios/fba-plan";
import type { EnvioSeparado } from "@/lib/servicios/envios";
import type { DesgloseOpcionales } from "@/lib/reporte/opcionales";
import { partirPorOpcionales, textoDeMas } from "@/lib/reporte/opcionales";
import { Ficha } from "@/components/tiles";
import { Aviso, Cifras } from "@/components/ui/pagina";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Las CAJAS REALES de bodega que el motor eligió para FBA — el mismo
 * optimizador, el mismo rescate de tallas y las mismas opcionales que el
 * plan de envíos a Full. Lo opcional va marcado en rojo con su sobrante.
 */
export function CajasFba({
  plan,
  desglose,
  dias,
  envios = [],
  sinConfigurar = [],
}: {
  plan: PlanFbaCajas;
  desglose: DesgloseOpcionales;
  dias: number;
  /** cajas del plan partidas por bodega/grupo de envío, como en MELI */
  envios?: EnvioSeparado[];
  /** almacenes del plan que no están en almacenes_activos: salen en su propio envío */
  sinConfigurar?: string[];
}) {
  const sinCaja = plan.sinCajaEnBodega.reduce((a, f) => a + f.pares, 0);
  // Cajas que entraron por la regla del producto SIN VENTA: se marcan en la
  // lista para que se entienda por qué viaja una caja con faltante 0.
  const codigosSinEstreno = new Set(plan.sinEstreno.flatMap((e) => e.codigos));

  return (
    <div className="flex flex-col gap-4">
      <Cifras columnas={4}>
        <Ficha
          titulo="Cajas a mandar"
          valor={desglose.cajasObligatorias}
          nota={`${n(desglose.paresObligatorios)} pares`}
        />
        <Ficha
          titulo="Cajas opcionales"
          valor={desglose.cajasOpcionales}
          nota={
            desglose.cajasOpcionales > 0
              ? `${n(desglose.paresOpcionales)} pares extra si las subes`
              : "El plan no necesitó rescates"
          }
          tono={desglose.cajasOpcionales > 0 ? "alerta" : "neutro"}
        />
        <Ficha
          titulo="Pares sugeridos"
          valor={n(plan.paresSugeridos)}
          nota={`Faltante de ${n(plan.skusConFaltante)} SKUs para 30 días`}
        />
        <Ficha
          titulo="Sin caja en bodega"
          valor={n(sinCaja)}
          nota="Pares que faltan y ninguna caja disponible trae"
          tono={sinCaja > 0 ? "alerta" : "bien"}
        />
      </Cifras>

      {sinConfigurar.length ? (
        <Aviso tono="alerta">
          Almacenes sin configurar en <code>almacenes_activos</code> (cada uno sale en su
          propio envío): {sinConfigurar.join(", ")}.
        </Aviso>
      ) : null}

      {plan.avisos.map((a, i) => (
        <Aviso key={i} tono="alerta">
          {a}
        </Aviso>
      ))}

      {plan.sinEstreno.length ? (
        <Aviso titulo="Productos sin venta: posición mínima para probarlos">
          {plan.sinEstreno
            .map(
              (e) =>
                `${nombreProducto(e.producto)} · ${e.cajas} ${e.cajas === 1 ? "caja" : "cajas"}${
                  e.enPosicion > 0 ? ` (ya tenía ${e.enPosicion})` : ""
                }`,
            )
            .join(" · ")}
        </Aviso>
      ) : null}

      {plan.productosNuevos.length ? (
        <Aviso titulo="Productos nuevos: cualquier faltante fuerza caja firme">
          {plan.productosNuevos
            .map((e) => `${nombreProducto(e.producto)} (hace ${e.edad} días)`)
            .join(" · ")}
        </Aviso>
      ) : null}

      {desglose.totalDeMas > 0 ? (
        <p className="texto-2 text-sm">
          Al cerrar cajas completas van{" "}
          <strong className="cifra">{n(desglose.totalDeMas)}</strong> pares por encima de
          lo sugerido — <span className="cifra">{n(desglose.deMasEnOpcionales)}</span> de
          esos en las opcionales. Por talla:{" "}
          <span className="cifra">{textoDeMas(desglose.deMasPorTalla)}</span>
        </p>
      ) : null}

      {/* ---- Un envío por dirección de bodega ------------------------------
           Caseshop + Industher salen juntas y EnvioPack aparte
           (almacenes_activos.grupo_envio, el mismo reparto que en Full). Cada
           sección es UN envío que se da de alta en Amazon: sus cajas, sus
           pares y su Excel. El plan completo queda como un solo botón. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="seccion-titulo">Envíos a preparar</h2>
          {plan.cajas.length > 0 && envios.length > 1 ? (
            <p className="texto-2 mt-0.5 text-sm">
              {envios.length} envíos: uno por dirección de recolección, cada uno se da de alta por separado.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {plan.cajas.length > 0 && envios.length > 1 ? (
            <a
              href={`/api/amazon/envio-excel?dias=${dias}`}
              className="boton boton-borde boton-chico"
              title="Todas las cajas del plan, de todas las bodegas; el Excel de cada envío está en su sección"
            >
              Excel del plan completo
            </a>
          ) : null}
          <a
            href={`/api/amazon/excel-simple?dias=${dias}`}
            className="boton boton-borde boton-chico"
            title="Un renglón por SKU: ventas, stock FBA, en camino y faltante a cubrir"
          >
            Excel simple
          </a>
        </div>
      </div>

      {plan.cajas.length === 0 ? (
        <section className="tarjeta p-6 text-center">
          <p className="texto-2 text-sm">
            {plan.paresSugeridos === 0
              ? "Nada que mandar: el calzado que vende tiene cobertura suficiente en FBA."
              : "Hay faltantes, pero ninguna caja disponible en bodega los trae."}
          </p>
        </section>
      ) : envios.length ? (
        envios.map((e) => (
          <SeccionEnvio
            key={e.grupo}
            envio={e}
            desglose={desglose}
            dias={dias}
            codigosSinEstreno={codigosSinEstreno}
          />
        ))
      ) : (
        // Sin cuenta de MELI no hay grupos de bodega: todas las cajas juntas.
        <SeccionEnvio
          envio={{
            grupo: "",
            nombre: "todas las bodegas",
            almacenes: [...new Set(plan.cajas.map((c) => c.almacen))].sort(),
            cajas: plan.cajas as unknown as EnvioSeparado["cajas"],
            totalCajas: plan.cajas.reduce((a, c) => a + c.cantidad, 0),
            totalPares: plan.cajas.reduce((a, c) => a + c.paresTotales, 0),
            skus: 0,
            porSku: [],
          }}
          desglose={desglose}
          dias={dias}
          codigosSinEstreno={codigosSinEstreno}
        />
      )}

      {plan.sinCajaEnBodega.length > 0 ? (
        <section className="tarjeta overflow-hidden" style={{ borderColor: "var(--estado-alerta)" }}>
          <header className="border-b p-4 hairline">
            <h2 className="seccion-titulo">
              Faltantes SIN caja en bodega ({plan.sinCajaEnBodega.length} SKUs ·{" "}
              {n(sinCaja)} pares)
            </h2>
            <p className="texto-2 mt-0.5 text-sm">
              Ninguna caja disponible los trae. Si alguno sí tiene caja física en bodega, es
              un problema de amarre.
            </p>
          </header>
          <div className="max-h-[24rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU (MELI)</th>
                  <th className="num">Pares que faltan</th>
                </tr>
              </thead>
              <tbody>
                {plan.sinCajaEnBodega.map((f) => (
                  <tr key={f.sku}>
                    <td className="font-medium">{f.sku}</td>
                    <td className="num cifra">{n(f.pares)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {plan.faltanteConCaja.length > 0 ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="seccion-titulo">
              Faltantes chicos con caja disponible ({plan.faltanteConCaja.length} SKUs ·{" "}
              {n(plan.faltanteConCaja.reduce((a, f) => a + f.pares, 0))} pares)
            </h2>
            <p className="texto-2 mt-0.5 text-sm">
              El pico que queda no vale otra caja completa; se cubre en el siguiente envío.
            </p>
          </header>
          <div className="max-h-[20rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU (MELI)</th>
                  <th className="num">Van en el plan</th>
                  <th className="num">Pico que queda</th>
                </tr>
              </thead>
              <tbody>
                {plan.faltanteConCaja.map((f) => (
                  <tr key={f.sku}>
                    <td className="font-medium">{f.sku}</td>
                    <td className="num cifra">{n(f.enPlan)}</td>
                    <td className="num cifra">{n(f.pares)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {plan.sinAmarre.length > 0 ? (
        <section className="tarjeta overflow-hidden" style={{ borderColor: "var(--estado-alerta)" }}>
          <header className="border-b p-4 hairline">
            <h2 className="seccion-titulo">
              SKUs de Amazon que NO amarran con MELI ({plan.sinAmarre.length})
            </h2>
            <p className="texto-2 mt-0.5 text-sm">
              Su venta y su faltante no entran al plan hasta que amarren.
            </p>
          </header>
          <div className="max-h-[20rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU (Amazon)</th>
                  <th className="num">Ventas del periodo</th>
                  <th className="num">Faltante calculado</th>
                </tr>
              </thead>
              <tbody>
                {plan.sinAmarre.map((s) => (
                  <tr key={s.sku}>
                    <td className="font-medium">{s.sku}</td>
                    <td className="num cifra">{n(s.unidades)}</td>
                    <td className="num cifra">{n(s.faltante)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/**
 * UNA sección por envío: la dirección de recolección, el número de cajas que
 * esa dirección de verdad puede juntar (el que se captura en el alta), las
 * opcionales aparte, la lista de cajas y el contenido por SKU.
 */
function SeccionEnvio({
  envio,
  desglose,
  dias,
  codigosSinEstreno,
}: {
  envio: EnvioSeparado;
  desglose: DesgloseOpcionales;
  dias: number;
  codigosSinEstreno: Set<string>;
}) {
  const { normales, opcionales } = partirPorOpcionales(envio.cajas as CajaPlaneada[]);
  const cajasNorm = normales.reduce((a, c) => a + c.cantidad, 0);
  const paresNorm = normales.reduce((a, c) => a + c.paresTotales, 0);
  const cajasOpc = opcionales.reduce((a, c) => a + c.cantidad, 0);
  const paresOpc = opcionales.reduce((a, c) => a + c.paresTotales, 0);
  const excel = envio.grupo
    ? `/api/amazon/envio-excel?dias=${dias}&grupo=${encodeURIComponent(envio.grupo)}`
    : `/api/amazon/envio-excel?dias=${dias}`;

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-center gap-4 border-b p-4 hairline">
        <div>
          <h3 className="seccion-titulo">Envío {envio.nombre}</h3>
          <p className="texto-2 text-xs">
            Recolección en {envio.almacenes.join(" y ")}
          </p>
        </div>

        <div className="flex gap-6">
          <Dato titulo="Cajas del envío" valor={n(cajasNorm)} grande />
          <Dato titulo="Pares" valor={n(paresNorm)} />
          {cajasOpc > 0 ? (
            <Dato titulo="Opcionales aparte" valor={`+${n(cajasOpc)} (${n(paresOpc)} pares)`} alerta />
          ) : null}
          {envio.skus > 0 ? <Dato titulo="SKUs" valor={n(envio.skus)} /> : null}
        </div>

        <a
          href={excel}
          className="boton boton-primario ml-auto"
          title={`Excel solo con las cajas del envío ${envio.nombre}`}
        >
          Descargar Excel
        </a>
      </header>

      <div className="max-h-[28rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Caja</th>
              <th>Almacén</th>
              <th>Tipo</th>
              <th className="num">Mandar</th>
              <th className="num">Pares</th>
              <th>Contenido por talla</th>
            </tr>
          </thead>
          <tbody>
            {normales.map((c, i) => (
              <FilaCaja
                key={`n-${c.codigo}-${i}`}
                c={c}
                desglose={desglose}
                sinEstreno={codigosSinEstreno.has(c.codigo)}
              />
            ))}
            {opcionales.length ? (
              <tr
                style={{
                  background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)",
                }}
              >
                <td colSpan={6} className="text-sm font-semibold">
                  Opcionales de {envio.nombre}: {n(cajasOpc)} cajas · {n(paresOpc)} pares.
                  Rescatan una talla que falta; el resto de la caja sobra. Tú decides si van.
                </td>
              </tr>
            ) : null}
            {opcionales.map((c, i) => (
              <FilaCaja key={`o-${c.codigo}-${i}`} c={c} desglose={desglose} />
            ))}
          </tbody>
        </table>
      </div>

      {envio.porSku.length ? (
        <details className="border-t hairline">
          <summary className="cursor-pointer p-3 text-sm font-medium">
            Contenido por SKU ({n(envio.porSku.length)} SKUs · {n(envio.totalPares)} pares,
            opcionales incluidas)
          </summary>
          <div className="max-h-[20rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Talla</th>
                  <th className="num">Pares en este envío</th>
                </tr>
              </thead>
              <tbody>
                {envio.porSku.map((s) => (
                  <tr key={s.sku}>
                    <td className="font-medium">{s.sku}</td>
                    <td>{s.talla}</td>
                    <td className="num cifra">{n(s.pares)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Dato({
  titulo,
  valor,
  grande,
  alerta,
}: {
  titulo: string;
  valor: string;
  grande?: boolean;
  alerta?: boolean;
}) {
  return (
    <div>
      <div className="texto-tenue text-[11px] uppercase tracking-wide">
        {titulo}
      </div>
      <div
        className={`cifra font-semibold ${grande ? "text-2xl" : "text-lg"}`}
        style={alerta ? { color: "var(--estado-alerta)" } : undefined}
      >
        {valor}
      </div>
    </div>
  );
}

/** "GT160|BLK" (clave de producto) → "GT160 BLK", como se lee en pantalla. */
function nombreProducto(clave: string): string {
  return clave.replace("|", " ");
}

function FilaCaja({
  c,
  desglose,
  sinEstreno,
}: {
  c: CajaPlaneada;
  desglose: DesgloseOpcionales;
  sinEstreno?: boolean;
}) {
  const opcionales = Math.min(c.cantidad, c.cantidadOpcional ?? 0);
  const deMas = textoDeMas(desglose.deMasPorCaja.get(c.codigo) ?? []);
  return (
    <tr>
      <td>
        <div
          className="font-medium"
          style={opcionales > 0 ? { color: "var(--estado-critico)" } : undefined}
        >
          {c.skuCaja}
        </div>
        <div className="texto-tenue text-xs">
          {c.modelo} · {c.color}
        </div>
        {sinEstreno ? (
          <div className="text-[11px]" style={{ color: "var(--estado-alerta)" }}>
            SIN VENTA en Amazon · posición mínima para probarlo
          </div>
        ) : null}
        {opcionales > 0 ? (
          <div className="text-[11px]" style={{ color: "var(--estado-critico)" }}>
            {opcionales === c.cantidad
              ? "OPCIONAL"
              : `${opcionales} de ${c.cantidad} opcionales`}
            {deMas ? ` · sobra ${deMas}` : ""}
          </div>
        ) : null}
      </td>
      <td className="text-sm">{c.almacen}</td>
      <td className="text-sm">{c.esCorrida ? "Corrida" : `Talla ${c.talla}`}</td>
      <td
        className="num cifra font-semibold"
        style={opcionales > 0 ? { color: "var(--estado-critico)" } : undefined}
      >
        {c.cantidad}
        <span className="texto-tenue text-xs font-normal">
          {" "}
          / {c.cajasDisponibles}
        </span>
      </td>
      <td className="num cifra">{n(c.paresTotales)}</td>
      <td className="texto-2 text-xs">
        {c.aporta.map((a) => `${a.talla}:${a.paresTotales}`).join("  ")}
      </td>
    </tr>
  );
}
