import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { generarPlanCompleto } from "@/lib/servicios/plan";
import { Estado, colorEstado } from "@/components/estado";
import { BarraCobertura, Ficha } from "@/components/tiles";
import { BotonesPlan } from "@/components/acciones";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

export default async function Plan() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return (
      <Bienvenida
        titulo="Conecta tu cuenta de Mercado Libre"
        texto="Todavía no hay una cuenta conectada. Ve a Ajustes para autorizar la app y traer tu catálogo, tu stock en Full y tus ventas."
        cta={{ href: "/ajustes", texto: "Ir a Ajustes" }}
      />
    );
  }

  const completo = await generarPlanCompleto(supabase, cuenta.id);
  const { plan, cajasPlaneadas, pendientes, catalogo } = completo;
  const r = plan.resumen;
  const p = plan.parametros;

  if (!plan.lineas.length) {
    return (
      <Bienvenida
        titulo="Falta sincronizar"
        texto="La cuenta está conectada pero aún no hay SKUs. Sincroniza con Mercado Libre para traer tu catálogo y tus ventas."
        cta={{ href: "/ajustes", texto: "Sincronizar" }}
      />
    );
  }

  const accionables = plan.lineas.filter((l) => l.sugerido > 0 || l.estado === "critico");
  const maxCobertura = Math.max(p.horizonteDias * 2, 60);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Plan de envío</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Próximo envío {r.proximoEnvio} · cobertura objetivo {p.horizonteDias} días ·
            lead time {p.leadTimeDias} días · {p.enviosPorSemana} envíos por semana
          </p>
        </div>
        <BotonesPlan />
      </div>

      {/* ---- Cifras de cabecera ------------------------------------------ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Ficha
          titulo="SKUs críticos"
          valor={r.skusCriticos}
          nota="Se agotan antes de que llegue el envío"
          tono={r.skusCriticos > 0 ? "critico" : "bien"}
        />
        <Ficha titulo="Urgentes" valor={r.skusUrgentes} nota="Bajo punto de reorden" tono="alerta" />
        <Ficha titulo="Cajas a mandar" valor={r.totalCajas} nota={`${n(r.piezasPlaneadas)} pares`} />
        <Ficha
          titulo="Pares sugeridos"
          valor={n(r.piezasSugeridas)}
          nota="Lo ideal, antes de cuadrar cajas"
        />
        <Ficha
          titulo="Venta perdida"
          valor={n(r.ventaPerdidaEstimada)}
          nota={`Pares no vendidos por agotamiento en ${p.diasHistoria} días`}
          tono={r.ventaPerdidaEstimada > 0 ? "alerta" : "neutro"}
        />
      </div>

      {/* ---- Avisos ------------------------------------------------------- */}
      {(pendientes.sinCorrida.length > 0 || pendientes.sinAmarre.length > 0) && (
        <div
          className="tarjeta flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-sm"
          style={{ borderColor: "var(--estado-alerta)" }}
        >
          <span aria-hidden="true" style={{ color: "var(--estado-alerta)" }}>
            ■
          </span>
          <span>
            {pendientes.sinCorrida.length > 0 && (
              <>
                <strong>{pendientes.sinCorrida.length}</strong> cajas de corrida sin receta capturada
                {pendientes.sinAmarre.length > 0 && " · "}
              </>
            )}
            {pendientes.sinAmarre.length > 0 && (
              <>
                <strong>{pendientes.sinAmarre.length}</strong> SKUs de bodega sin amarrar a MELI
              </>
            )}
            . Ese inventario no se está considerando en el plan.
          </span>
          <Link href="/pendientes" className="underline" style={{ color: "var(--acento)" }}>
            Resolver
          </Link>
        </div>
      )}

      {completo.avisos.map((a, i) => (
        <div key={i} className="tarjeta p-3 text-sm" style={{ color: "var(--ink-2)" }}>
          {a}
        </div>
      ))}

      {/* ---- Qué cajas mandar --------------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b p-4 hairline">
          <h2 className="font-semibold">Cajas a mandar</h2>
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            {r.totalCajas} cajas · {n(r.piezasPlaneadas)} pares · de {n(catalogo.cajasDisponibles)}{" "}
            cajas disponibles en bodega
          </p>
        </header>

        {cajasPlaneadas.length === 0 ? (
          <p className="p-6 text-sm" style={{ color: "var(--ink-2)" }}>
            No hace falta mandar nada: todo tiene cobertura suficiente para el horizonte.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Caja</th>
                  <th>Almacén</th>
                  <th>Tipo</th>
                  <th className="num">Mandar</th>
                  <th className="num">Pares</th>
                  <th>Contenido</th>
                </tr>
              </thead>
              <tbody>
                {cajasPlaneadas.map((c) => (
                  <tr key={c.codigo}>
                    <td>
                      <div className="font-medium">{c.skuCaja}</div>
                      <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                        {c.modelo} · {c.color}
                      </div>
                    </td>
                    <td className="text-sm">{c.almacen}</td>
                    <td className="text-sm">
                      {c.esCorrida ? "Corrida" : `Talla ${c.talla}`}
                    </td>
                    <td className="num cifra font-semibold">
                      {c.cantidad}
                      <span className="text-xs font-normal" style={{ color: "var(--ink-muted)" }}>
                        {" "}
                        / {c.cajasDisponibles}
                      </span>
                    </td>
                    <td className="num cifra">{n(c.paresTotales)}</td>
                    <td className="text-xs" style={{ color: "var(--ink-2)" }}>
                      {c.aporta
                        .map((a) => `${a.talla}:${a.paresTotales}`)
                        .join("  ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Detalle por SKU ---------------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b p-4 hairline">
          <h2 className="font-semibold">SKUs que piden reposición</h2>
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            {accionables.length} de {r.skusAnalizados} analizados
          </p>
        </header>

        <div className="max-h-[36rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Estado</th>
                <th className="num">Venta/día</th>
                <th className="num">En Full</th>
                <th className="num">En camino</th>
                <th>Cobertura</th>
                <th className="num">Sugerido</th>
                <th className="num">Se manda</th>
              </tr>
            </thead>
            <tbody>
              {accionables.slice(0, 300).map((l) => {
                const enviado = plan.cajas.enviadoPorSku.get(l.sku) ?? 0;
                const corregido = l.demanda.factorCorreccion > 1.15;
                return (
                  <tr key={l.sku}>
                    <td>
                      <div className="font-medium">{l.sku}</div>
                      {corregido ? (
                        <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                          demanda ×{l.demanda.factorCorreccion.toFixed(2)} por{" "}
                          {l.demanda.diasSinStock} días agotado
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Estado estado={l.estado} />
                    </td>
                    <td className="num cifra">{l.demanda.demandaDiaria.toFixed(1)}</td>
                    <td className="num cifra">{n(l.disponible)}</td>
                    <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                      {l.enTransferencia ? n(l.enTransferencia) : "—"}
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <div className="flex items-center gap-2">
                        <BarraCobertura
                          dias={l.coberturaDias}
                          horizonte={p.horizonteDias}
                          color={colorEstado(l.estado)}
                          maximo={maxCobertura}
                        />
                        <span
                          className="cifra w-14 shrink-0 text-right text-xs"
                          style={{ color: "var(--ink-2)" }}
                        >
                          {Number.isFinite(l.coberturaDias)
                            ? `${l.coberturaDias.toFixed(0)} d`
                            : "—"}
                        </span>
                      </div>
                    </td>
                    <td className="num cifra">{n(l.sugerido)}</td>
                    <td
                      className="num cifra font-semibold"
                      style={{
                        color:
                          enviado === 0 && l.sugerido > 0
                            ? "var(--estado-critico)"
                            : "var(--ink-1)",
                      }}
                    >
                      {n(enviado)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="border-t p-3 text-xs hairline" style={{ color: "var(--ink-muted)" }}>
          La marca fina en cada barra es el horizonte objetivo de {p.horizonteDias} días.
          "Se manda" puede quedar por debajo de "Sugerido" porque las cajas no se abren:
          el sistema elige la combinación que menos daño hace.
        </footer>
      </section>
    </div>
  );
}

function Bienvenida({
  titulo,
  texto,
  cta,
}: {
  titulo: string;
  texto: string;
  cta: { href: string; texto: string };
}) {
  return (
    <div className="tarjeta mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold">{titulo}</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
        {texto}
      </p>
      <Link
        href={cta.href}
        className="mt-4 inline-block rounded-lg px-4 py-2 text-sm font-medium text-white"
        style={{ background: "var(--acento)" }}
      >
        {cta.texto}
      </Link>
    </div>
  );
}
