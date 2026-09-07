import { clienteServidor } from "@/lib/supabase/server";
import { credencialesApp, cuentaActiva, leerParametros } from "@/lib/yapanizcel/cuenta";
import { configuracionSheets } from "@/lib/yapanizcel/sheets";
import { todo } from "@/lib/yapanizcel/db";
import { BotonSheets, BotonSincronizar, FormularioParametros, SubirCostos } from "@/components/yapanizcel/acciones";
import { Encabezado } from "@/components/yapanizcel/comunes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function AjustesYz({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  const app = credencialesApp();

  const [parametros, costos, ultimoSync, pendientes] = await Promise.all([
    cuenta ? leerParametros(supabase, cuenta.id) : null,
    cuenta ? todo<{ modelo: string; etiqueta: string | null; costo: number; actualizado_en: string }>(supabase, "yz_costos", "modelo, etiqueta, costo, actualizado_en", (q) => q.eq("account_id", cuenta.id).order("modelo")) : [],
    cuenta ? supabase.from("yz_sync_log").select("corrido_en, ok, detalle").eq("account_id", cuenta.id).order("corrido_en", { ascending: false }).limit(1).maybeSingle() : null,
    cuenta ? supabase.from("yz_skus_pendientes").select("*", { count: "exact", head: true }).eq("account_id", cuenta.id) : null,
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Encabezado titulo="Ajustes · YAPANIZCEL" texto="Conexión con la cuenta de Mercado Libre de fundas, el sheet de bodega, los costos y los parámetros del planeador." />

      {sp.ok ? (
        <div className="tarjeta p-4 text-sm" style={{ color: "var(--exito-texto)" }}>
          {sp.ok}
        </div>
      ) : null}
      {sp.error ? (
        <div className="tarjeta p-4 text-sm" style={{ color: "var(--estado-critico)" }}>
          {sp.error}
        </div>
      ) : null}

      <section className="tarjeta p-5">
        <h2 className="font-semibold">Cuenta de Mercado Libre (fundas)</h2>
        {!app ? (
          <p className="mt-2 text-sm" style={{ color: "var(--estado-serio)" }}>
            Faltan <code>MELI_YZ_CLIENT_ID</code> y <code>MELI_YZ_CLIENT_SECRET</code> en las variables de entorno. Son las credenciales de la
            aplicación de Mercado Libre de YAPANIZCEL (distinta a la del calzado). Registra como Redirect URI:{" "}
            <code>{process.env.NEXT_PUBLIC_APP_URL ?? "https://TU-APP"}/api/yapanizcel/meli/callback</code>
          </p>
        ) : cuenta ? (
          <div className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
            Conectada como <b style={{ color: "var(--ink-1)" }}>{cuenta.nickname ?? cuenta.meli_user_id}</b> · sitio {cuenta.site_id}.
            {ultimoSync?.data ? (
              <span> Última sincronización: {new Date(ultimoSync.data.corrido_en).toLocaleString("es-MX")} ({ultimoSync.data.ok ? "ok" : "con error"}).</span>
            ) : (
              <span> Todavía no se ha sincronizado.</span>
            )}
            {pendientes?.count ? <span> {pendientes.count} publicaciones pendientes de SKU (se resuelven solas).</span> : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <BotonSincronizar />
              <a href="/api/yapanizcel/meli/conectar" className="text-xs underline" style={{ color: "var(--ink-muted)" }}>
                Volver a conectar
              </a>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <p className="text-sm" style={{ color: "var(--ink-2)" }}>
              Todavía no está conectada. Te lleva a Mercado Libre a autorizar; inicia sesión ahí con la cuenta de YAPANIZCEL.
            </p>
            <a href="/api/yapanizcel/meli/conectar" className="mt-3 inline-block rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: "var(--acento)", color: "#fff" }}>
              Conectar con Mercado Libre
            </a>
          </div>
        )}
      </section>

      {cuenta ? (
        <>
          <section className="tarjeta p-5">
            <h2 className="font-semibold">Inventario de bodega (Google Sheets)</h2>
            <p className="mt-1 mb-3 text-sm" style={{ color: "var(--ink-2)" }}>
              Una pestaña por diseño. Se lee a diario en el cron y cuando lo pides aquí; reemplaza la bodega completa.
            </p>
            <BotonSheets configurado={Boolean(configuracionSheets())} />
          </section>

          <section className="tarjeta p-5">
            <h2 className="font-semibold">Costos</h2>
            <p className="mt-1 mb-3 text-sm" style={{ color: "var(--ink-2)" }}>
              Un Excel con dos columnas: <b>MODELO</b> (el número de diseño, p. ej. 499) y <b>COSTO</b> en MXN. Se acumula: lo que ya estaba se actualiza, lo nuevo se agrega.
            </p>
            <SubirCostos />
            {costos.length ? (
              <details className="mt-3 text-sm">
                <summary style={{ color: "var(--ink-2)" }}>{costos.length} modelos con costo</summary>
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                  {costos.map((c) => (
                    <div key={c.modelo} className="num flex justify-between">
                      <span>{c.etiqueta ?? c.modelo}</span>
                      <span>${Number(c.costo).toLocaleString("es-MX", { maximumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <p className="mt-2 text-xs" style={{ color: "var(--estado-serio)" }}>
                Sin costos cargados: la ganancia no se puede calcular.
              </p>
            )}
          </section>

          <section className="tarjeta p-5">
            <h2 className="font-semibold">Parámetros del planeador</h2>
            <div className="mt-3">
              <FormularioParametros valores={parametros!} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
