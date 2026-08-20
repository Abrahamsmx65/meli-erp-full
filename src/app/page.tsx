import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { leerPlanParcial, obtenerPlan } from "@/lib/servicios/cache";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

export default async function Resumen() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Conecta tu cuenta de Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Todavía no hay una cuenta conectada. Ve a Ajustes para autorizar la app.
        </p>
        <Link
          href="/ajustes"
          className="mt-4 inline-block rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ background: "var(--acento)" }}
        >
          Ir a Ajustes
        </Link>
      </div>
    );
  }

  // Del plan solo hacen falta el resumen y los pendientes: se leen esas dos
  // claves del JSON en vez de bajar el plan completo (varios MB por clic).
  const [parcial, stockFull, filas, pedidos, contenedores] = await Promise.all([
    leerPlanParcial(supabase, cuenta.id, ["resumen", "pendientes"]),
    traerTodo<any>(supabase, "stock_full", "disponible", (q) =>
      q.eq("account_id", cuenta.id),
    ),
    // PAGINADO: una lectura directa corta en 1,000 filas y las fichas de
    // bodega quedaban sumando solo una parte de las existencias.
    traerTodo<any>(
      supabase,
      "existencias",
      "cajas_disponibles, pares_por_caja, en_camino, almacen",
      (q) => q.eq("account_id", cuenta.id),
    ),
    supabase
      .from("pedidos")
      .select("id, pedido, estado")
      .eq("account_id", cuenta.id),
    supabase
      .from("contenedores")
      .select("id, numero, estado, fecha_llegada_est")
      .eq("account_id", cuenta.id)
      .neq("estado", "recibido")
      .order("fecha_llegada_est", { ascending: true })
      .limit(5),
  ]);

  // Sin plan guardado (primera vez), se genera con el camino normal.
  const respaldo = parcial ? null : await obtenerPlan(supabase, cuenta.id);
  const r = (parcial?.resumen ?? respaldo?.plan.resumen) as any;
  const pend = (parcial?.pendientes ?? respaldo?.plan.pendientes) as any;
  const cajasBodega = filas.reduce((a, f) => a + (f.cajas_disponibles ?? 0), 0);
  const paresBodega = filas.reduce(
    (a, f) => a + (f.cajas_disponibles ?? 0) * (f.pares_por_caja ?? 0),
    0,
  );
  const paresEnFull = stockFull.reduce((a, f) => a + (f.disponible ?? 0), 0);
  const pendientes =
    (pend?.sinCorrida?.length ?? 0) + (pend?.sinAmarre?.length ?? 0);

  const porAlmacen = new Map<string, number>();
  for (const f of filas) {
    porAlmacen.set(
      f.almacen ?? "—",
      (porAlmacen.get(f.almacen ?? "—") ?? 0) + (f.cajas_disponibles ?? 0),
    );
  }

  const pedidosCreados = (pedidos.data ?? []).filter((p) => p.estado === "creado").length;
  const pedidosEnTransito = (pedidos.data ?? []).filter(
    (p) => p.estado === "en_transito" || p.estado === "con_contenedor",
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Resumen</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Cómo va el inventario hoy · cuenta {cuenta.nickname ?? cuenta.meli_user_id}
        </p>
      </div>

      {/* ---- Lo que hay que atender hoy ---------------------------------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ficha
          titulo="SKUs críticos"
          valor={r.skusCriticos}
          nota="Se agotan antes del próximo envío"
          tono={r.skusCriticos > 0 ? "critico" : "bien"}
        />
        <Ficha
          titulo="Cajas por mandar"
          valor={r.totalCajas}
          nota={`${n(r.piezasPlaneadas)} pares`}
        />
        <Ficha
          titulo="Pares en Full"
          valor={n(paresEnFull)}
          nota="Disponibles para vender ahora"
        />
        <Ficha
          titulo="Pares en bodega"
          valor={n(paresBodega)}
          nota={`${n(cajasBodega)} cajas cerradas`}
        />
      </div>

      {pendientes > 0 ? (
        <Link
          href="/pendientes"
          className="tarjeta flex flex-wrap items-center gap-3 p-4 text-sm"
          style={{ borderColor: "var(--estado-alerta)" }}
        >
          <span aria-hidden="true" style={{ color: "var(--estado-alerta)" }}>
            ■
          </span>
          <span>
            <strong className="cifra">{pendientes}</strong> cosas por resolver:{" "}
            {pend?.sinCorrida?.length ?? 0} cajas sin corrida capturada y{" "}
            {pend?.sinAmarre?.length ?? 0} SKUs sin amarrar a Mercado Libre. Ese
            inventario no entra al plan.
          </span>
          <span className="underline" style={{ color: "var(--acento)" }}>
            Resolver
          </span>
        </Link>
      ) : null}

      {/* ---- Accesos ------------------------------------------------------ */}
      <div className="grid gap-4 md:grid-cols-2">
        <Tarjeta
          href="/envios"
          titulo="Envíos a Full"
          cifra={`${r.totalCajas} cajas`}
          nota={`Próximo envío ${r.proximoEnvio} · ${n(r.piezasSugeridas)} pares sugeridos`}
        />
        <Tarjeta
          href="/inventario"
          titulo="Inventario"
          cifra={`${n(cajasBodega)} cajas`}
          nota={
            [...porAlmacen.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([a, c]) => `${a}: ${n(c)}`)
              .join(" · ") || "Sin existencias cargadas"
          }
        />
        <Tarjeta
          href="/pedidos"
          titulo="Pedidos a China"
          cifra={`${pedidosCreados + pedidosEnTransito}`}
          nota={
            pedidosCreados + pedidosEnTransito === 0
              ? "Ningún pedido abierto"
              : `${pedidosCreados} sin contenedor · ${pedidosEnTransito} en camino`
          }
        />
        <Tarjeta
          href="/corridas"
          titulo="Corridas"
          cifra=""
          nota="Cómo se reparten las tallas en cada caja"
        />
      </div>

      {/* ---- Contenedores en camino -------------------------------------- */}
      {contenedores.data?.length ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="font-semibold">Contenedores en camino</h2>
          </header>
          <table className="datos">
            <thead>
              <tr>
                <th>Contenedor</th>
                <th>Estado</th>
                <th>Llegada estimada</th>
              </tr>
            </thead>
            <tbody>
              {contenedores.data.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.numero}</td>
                  <td className="text-sm">{c.estado}</td>
                  <td className="cifra text-sm">{c.fecha_llegada_est ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function Tarjeta({
  href,
  titulo,
  cifra,
  nota,
}: {
  href: string;
  titulo: string;
  cifra: string;
  nota: string;
}) {
  return (
    <Link href={href} className="tarjeta block p-4 transition-colors hover:border-[var(--acento)]">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{titulo}</h2>
        {cifra ? <span className="cifra text-lg font-semibold">{cifra}</span> : null}
      </div>
      <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
        {nota}
      </p>
    </Link>
  );
}
