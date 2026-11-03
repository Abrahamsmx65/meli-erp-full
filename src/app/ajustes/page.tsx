import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, leerParametros } from "@/lib/datos/repos";
import { normalizarParametros, periodoRevision, ventanaRiesgo } from "@/lib/engine/params";
import { FormularioParametros } from "@/components/ajustes";
import { Aviso, Encabezado, Pagina, Seccion } from "@/components/ui/pagina";

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
    <Pagina className="max-w-3xl">
      <Encabezado ceja="Sistema" titulo="Configuración" descripcion="Conexión con Mercado Libre, parámetros de reposición y almacenes." />

      {sp.ok ? <Aviso tono="bien">{sp.ok}</Aviso> : null}
      {sp.error ? <Aviso tono="critico">{sp.error}</Aviso> : null}

      {/* ---- Conexión ------------------------------------------------------ */}
      <Seccion titulo="Cuenta de Mercado Libre">
        {cuenta ? (
          <div className="texto-2 text-sm">
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
          <p className="texto-2 text-sm">Sin cuenta conectada.</p>
        )}

        <a
          href="/api/meli/conectar"
          className={`boton mt-3 ${cuenta ? "boton-borde boton-chico" : "boton-primario"}`}
        >
          {cuenta ? "Reconectar con Mercado Libre" : "Conectar con Mercado Libre"}
        </a>
      </Seccion>

      {/* ---- Parámetros ---------------------------------------------------- */}
      <Seccion titulo="Parámetros de reposición">
        <p className="texto-2 text-sm">
          Envío cada <strong>{periodoRevision(p).toFixed(1)} días</strong> · ventana de riesgo{" "}
          <strong>{ventanaRiesgo(p).toFixed(1)} días</strong>
        </p>

        {cuenta ? (
          <FormularioParametros inicial={p} />
        ) : (
          <p className="mt-3 text-sm texto-tenue">
            Sin cuenta conectada.
          </p>
        )}
      </Seccion>

      {/* ---- Almacenes ----------------------------------------------------- */}
      <Seccion titulo="Almacenes que surten a Full">
        {almacenes?.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {almacenes.map((a) => (
              <li key={a.almacen} className="flex items-center gap-2">
                <span aria-hidden="true" style={{ color: a.surte_full ? "var(--estado-bien)" : "var(--ink-muted)" }}>
                  {a.surte_full ? "●" : "○"}
                </span>
                {a.almacen}
                <span className="text-xs texto-tenue">
                  {a.surte_full ? "surte a Full" : "no surte"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="texto-2 text-sm">
            Sin almacenes todavía.{" "}
            <Link href="/importar" className="enlace">
              Importar ahora
            </Link>
          </p>
        )}
      </Seccion>
    </Pagina>
  );
}
