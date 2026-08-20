import { Suspense } from "react";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import {
  LIMITE_FILAS,
  cargarAmazon,
  cuentaAmazon,
  estadoRecarga,
  normalizarDias,
} from "@/lib/servicios/amazon";
import { mapaCorridas, sugerirEnvioFba } from "@/lib/servicios/fba";
import { desglosarSku } from "@/lib/servicios/sync";
import { EnviosFba } from "@/components/envios-fba";
import { RecargaAmazon } from "@/components/recarga-amazon";
import { TablaAmazon } from "@/components/tabla-amazon";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

export default async function Amazon({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const dias = normalizarDias(sp.dias);
  const busqueda = (sp.q ?? "").trim();

  const supabase = await clienteServidor();
  const cuenta = await cuentaAmazon(supabase);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Amazon no está conectado</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          No hay ninguna cuenta de Amazon asociada a este usuario. El conector
          vive en la carpeta <code>CODIGO</code> y se configura con{" "}
          <code>python3 scripts/configurar.py</code>.
        </p>
      </div>
    );
  }

  // Las corridas viven con la cuenta de MELI: son las mismas cajas físicas.
  const cuentaMeli = await cuentaActiva(supabase);
  const [{ renglones, totales }, recarga, corridasRaw] = await Promise.all([
    cargarAmazon(supabase, dias, busqueda),
    estadoRecarga(supabase, cuenta.id),
    cuentaMeli
      ? traerTodo<any>(supabase, "corridas", "modelo, color, tallas, total, pedido", (q) =>
          q.eq("account_id", cuentaMeli.id),
        )
      : Promise.resolve([]),
  ]);
  const sugerencias = busqueda ? [] : sugerirEnvioFba(renglones, dias, mapaCorridas(corridasRaw));
  const etiqueta = dias === 365 ? "último año" : `últimos ${dias} días`;

  // Por modelo (el "padre"): todo el MY2307 junto, colores y tallas sumados.
  const porModelo = new Map<
    string,
    { colores: Set<string>; skus: number; unidades: number; importe: number; fba: number; enCamino: number }
  >();
  for (const r of renglones) {
    const modelo = (desglosarSku(r.sku).modelo ?? r.sku).toUpperCase();
    const m =
      porModelo.get(modelo) ??
      { colores: new Set<string>(), skus: 0, unidades: 0, importe: 0, fba: 0, enCamino: 0 };
    const color = desglosarSku(r.sku).color;
    if (color) m.colores.add(color);
    m.skus += 1;
    m.unidades += r.unidades;
    m.importe += r.importe;
    m.fba += r.disponible;
    m.enCamino += r.enTransferencia;
    porModelo.set(modelo, m);
  }
  const modelos = [...porModelo.entries()]
    .map(([modelo, m]) => ({
      modelo,
      colores: m.colores.size,
      skus: m.skus,
      unidades: m.unidades,
      importe: m.importe,
      fba: m.fba,
      enCamino: m.enCamino,
      cobertura: m.unidades > 0 ? (m.fba + m.enCamino) / (m.unidades / dias) : null,
    }))
    .sort((a, b) => b.unidades - a.unidades);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Amazon</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Ventas y existencias de {cuenta.nombre ?? "tu cuenta"} en Amazon{" "}
          {cuenta.pais}. La cobertura dice cuántos días dura el stock de FBA al
          ritmo de venta del periodo: es el número que decide qué reponer.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha
          titulo="Unidades"
          valor={n(totales.unidades)}
          nota={`Vendidas en los ${etiqueta}`}
        />
        <Ficha titulo="Importe" valor={pesos(totales.importe)} nota="Venta del periodo" />
        <Ficha
          titulo="Con venta"
          valor={n(totales.conVenta)}
          nota={`De ${n(totales.skus)} SKUs`}
        />
        <Ficha
          titulo="En FBA"
          valor={n(totales.disponible)}
          nota={`${n(totales.enTransito)} en tránsito`}
          tono="bien"
        />
        <Ficha
          titulo="Agotados"
          valor={n(totales.sinStock)}
          nota="Venden pero están en cero"
          tono={totales.sinStock > 0 ? "critico" : "neutro"}
        />
      </div>

      <RecargaAmazon estado={recarga} />

      {modelos.length ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Por modelo</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Todos los colores y tallas de cada modelo, juntos, en los {etiqueta}.
            </p>
          </header>
          <div className="max-h-[28rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th className="num">Colores</th>
                  <th className="num">SKUs</th>
                  <th className="num">Vendidas</th>
                  <th className="num">Importe</th>
                  <th className="num">En FBA</th>
                  <th className="num">En camino</th>
                  <th className="num">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {modelos.slice(0, 100).map((m) => (
                  <tr key={m.modelo}>
                    <td className="font-medium">{m.modelo}</td>
                    <td className="num cifra">{m.colores}</td>
                    <td className="num cifra">{m.skus}</td>
                    <td className="num cifra font-semibold">{n(m.unidades)}</td>
                    <td className="num cifra">{pesos(m.importe)}</td>
                    <td className="num cifra">{n(m.fba)}</td>
                    <td className="num cifra">{n(m.enCamino)}</td>
                    <td
                      className="num cifra"
                      style={{
                        color:
                          m.cobertura !== null && m.cobertura < 14
                            ? "var(--estado-critico)"
                            : "var(--ink-1)",
                      }}
                    >
                      {m.cobertura === null ? "—" : `${Math.round(m.cobertura)} d`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Con búsqueda activa los renglones vienen filtrados y la sugerencia
          de envío quedaría a medias: se muestra solo sobre el panorama entero. */}
      {!busqueda ? <EnviosFba sugerencias={sugerencias} dias={dias} /> : null}

      {/* useSearchParams necesita un límite de Suspense para poder prerenderizar. */}
      <Suspense fallback={<div className="tarjeta p-8 text-center text-sm">Cargando…</div>}>
        <TablaAmazon
          renglones={renglones}
          dias={dias}
          busqueda={busqueda}
          limite={LIMITE_FILAS}
          totales={{ unidades: totales.unidades, importe: totales.importe }}
        />
      </Suspense>
    </div>
  );
}
