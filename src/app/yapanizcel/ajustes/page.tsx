import { clienteServidor } from "@/lib/supabase/server";
import { credencialesApp, cuentaActiva, leerParametros } from "@/lib/yapanizcel/cuenta";
import { todo } from "@/lib/yapanizcel/db";
import { BotonSincronizar, FormularioParametros, SubirCostos } from "@/components/yapanizcel/acciones";
import { Aviso, Encabezado, Pagina, Seccion } from "@/components/ui/pagina";

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
    <Pagina className="max-w-3xl">
      <Encabezado
        ceja="Fundas"
        titulo="Configuración de fundas"
        descripcion="Conexión con la cuenta de Mercado Libre de fundas, costos y parámetros del planeador."
        ayudaTitulo="¿Cómo funciona?"
        ayuda={
          <p>
            El sheet de inventario (una pestaña por diseño) se lee a diario en el cron y reemplaza la bodega completa. Para
            leerlo en el momento, usa el botón de Bodega fundas.
          </p>
        }
      />

      {sp.ok ? <Aviso tono="bien">{sp.ok}</Aviso> : null}
      {sp.error ? <Aviso tono="critico">{sp.error}</Aviso> : null}

      <Seccion titulo="Cuenta de Mercado Libre (fundas)">
        {!app ? (
          <Aviso tono="alerta">
            Faltan <code>MELI_YZ_CLIENT_ID</code> y <code>MELI_YZ_CLIENT_SECRET</code> en las variables de entorno. Son las credenciales de la
            aplicación de Mercado Libre de YAPANIZCEL (distinta a la del calzado). Registra como Redirect URI:{" "}
            <code>{process.env.NEXT_PUBLIC_APP_URL ?? "https://TU-APP"}/api/yapanizcel/meli/callback</code>
          </Aviso>
        ) : cuenta ? (
          <div className="texto-2 text-sm">
            Conectada como <b style={{ color: "var(--ink-1)" }}>{cuenta.nickname ?? cuenta.meli_user_id}</b> · sitio {cuenta.site_id}.
            {ultimoSync?.data ? (
              <span> Última sincronización: {new Date(ultimoSync.data.corrido_en).toLocaleString("es-MX")} ({ultimoSync.data.ok ? "ok" : "con error"}).</span>
            ) : (
              <span> Todavía no se ha sincronizado.</span>
            )}
            {pendientes?.count ? <span> {pendientes.count} publicaciones pendientes de SKU (se resuelven solas).</span> : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <BotonSincronizar />
              <a href="/api/yapanizcel/meli/conectar" className="boton boton-fantasma boton-chico">
                Volver a conectar
              </a>
            </div>
          </div>
        ) : (
          <div>
            <p className="texto-2 text-sm">Sin conectar. Inicia sesión en Mercado Libre con la cuenta de YAPANIZCEL.</p>
            <a href="/api/yapanizcel/meli/conectar" className="boton boton-primario mt-3">
              Conectar con Mercado Libre
            </a>
          </div>
        )}
      </Seccion>

      {cuenta ? (
        <>
          <Seccion titulo="Costos">
            <p className="texto-2 mb-3 text-sm">
              Excel con dos columnas: <b>MODELO</b> (diseño, p. ej. 499) y <b>COSTO</b> en MXN. Actualiza lo que ya estaba y agrega lo nuevo.
            </p>
            <SubirCostos />
            {costos.length ? (
              <details className="mt-3 text-sm">
                <summary className="texto-2">{costos.length} modelos con costo</summary>
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
              <p className="mt-2 text-xs" style={{ color: "var(--alerta-texto)" }}>
                Sin costos cargados: la ganancia no se puede calcular.
              </p>
            )}
          </Seccion>

          <Seccion titulo="Parámetros del planeador">
            <FormularioParametros valores={parametros!} />
          </Seccion>
        </>
      ) : null}
    </Pagina>
  );
}
