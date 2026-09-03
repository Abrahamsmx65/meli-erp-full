import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, leerParametros } from "@/lib/datos/repos";
import { normalizarParametros, periodoRevision, ventanaRiesgo } from "@/lib/engine/params";
import { FormularioParametros } from "@/components/ajustes";

export const dynamic = "force-dynamic";

export default async function Ajustes({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  // Las tres lecturas son independientes: en serie sumaban ~3 viajes.
  const [guardados, rAlmacenes, rSync] = await Promise.all([
    cuenta ? leerParametros(supabase, cuenta.id) : Promise.resolve({}),
    cuenta
      ? supabase
          .from("almacenes_activos")
          .select("almacen, surte_full")
          .eq("account_id", cuenta.id)
          .order("almacen")
      : Promise.resolve({ data: [] as any[] }),
    cuenta
      ? supabase
          .from("sync_log")
          .select("tarea, inicio, fin, estado, detalle")
          .eq("account_id", cuenta.id)
          .order("inicio", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
  ]);
  const p = normalizarParametros(guardados);
  const almacenes = rAlmacenes.data;
  const ultimoSync = rSync.data;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="titulo-pagina">Ajustes</h1>

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

      {/* ---- Conexión ------------------------------------------------------ */}
      <section className="tarjeta p-5">
        <h2 className="font-semibold">Cuenta de Mercado Libre</h2>
        {cuenta ? (
          <div className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
            <p>
              Conectada como <strong style={{ color: "var(--ink-1)" }}>{cuenta.nickname}</strong>{" "}
              (ID {cuenta.meli_user_id}, sitio {cuenta.site_id}).
            </p>
            {ultimoSync ? (
              <p className="mt-1">
                Última sincronización: {new Date(ultimoSync.inicio).toLocaleString("es-MX")} —{" "}
                {ultimoSync.estado}
                {ultimoSync.detalle && typeof ultimoSync.detalle === "object"
                  ? ` (${(ultimoSync.detalle as any).skus ?? 0} SKUs, ${(ultimoSync.detalle as any).ordenes ?? 0} órdenes)`
                  : ""}
              </p>
            ) : (
              <p className="mt-1">Todavía no has sincronizado.</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
            Sin cuenta conectada. Autoriza la app para traer tu catálogo, tu stock en Full y tus
            ventas.
          </p>
        )}

        <a
          href="/api/meli/conectar"
          className="mt-3 inline-block rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ background: "var(--acento)" }}
        >
          {cuenta ? "Reconectar con Mercado Libre" : "Conectar con Mercado Libre"}
        </a>
      </section>

      {/* ---- Parámetros ---------------------------------------------------- */}
      <section className="tarjeta p-5">
        <h2 className="font-semibold">Parámetros de reposición</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Con {p.enviosPorSemana} envíos por semana mandas cada{" "}
          <strong>{periodoRevision(p).toFixed(1)} días</strong>. Sumando el lead time de{" "}
          {p.leadTimeDias} días, el stock de seguridad tiene que aguantar una ventana de{" "}
          <strong>{ventanaRiesgo(p).toFixed(1)} días</strong>.
        </p>

        {cuenta ? (
          <FormularioParametros inicial={p} />
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--ink-muted)" }}>
            Conecta una cuenta para configurar los parámetros.
          </p>
        )}
      </section>

      {/* ---- Almacenes ----------------------------------------------------- */}
      <section className="tarjeta p-5">
        <h2 className="font-semibold">Almacenes que surten a Full</h2>
        {almacenes?.length ? (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {almacenes.map((a) => (
              <li key={a.almacen} className="flex items-center gap-2">
                <span aria-hidden="true" style={{ color: a.surte_full ? "var(--estado-bien)" : "var(--ink-muted)" }}>
                  {a.surte_full ? "●" : "○"}
                </span>
                {a.almacen}
                <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  {a.surte_full ? "surte a Full" : "no surte"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
            Los almacenes aparecen aquí cuando importas tu reporte de existencias.{" "}
            <Link href="/importar" className="underline" style={{ color: "var(--acento)" }}>
              Importar ahora
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
