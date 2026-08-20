import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { obtenerPlan } from "@/lib/servicios/cache";
import { separarEnvios } from "@/lib/servicios/envios";
import { enviosParaPantalla } from "@/lib/servicios/envios-registrados";
import { Ficha } from "@/components/tiles";
import { EnviosSeparados } from "@/components/envios-separados";
import { EnviosEnCamino } from "@/components/envios-en-camino";
import { BotonesPlan, FrescuraPlan } from "@/components/acciones";
import {
  TablasPlan,
  type FilaCajaPlan,
  type FilaSkuPlan,
} from "@/components/tablas-plan";

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

  const estado = await obtenerPlan(supabase, cuenta.id);
  const plan = estado.plan;
  const { pendientes, catalogo } = plan;
  const r = plan.resumen;
  const p = plan.parametros;

  if (!plan.lineas.length) {
    // El botón va AQUÍ, no un enlace a otra pantalla: sin datos todavía es
    // justo cuando hace falta sincronizar, y mandar al usuario a Ajustes lo
    // dejaba atrapado sin forma de disparar la primera bajada.
    return (
      <Bienvenida
        titulo="Falta sincronizar"
        texto="La cuenta está conectada pero aún no hay SKUs. Trae tu catálogo, tu stock en Full y tus ventas de los últimos 90 días. La primera vez tarda varios minutos."
      >
        <BotonesPlan />
      </Bienvenida>
    );
  }

  // Al navegador solo va lo que la tabla pinta. Las explicaciones y el resto
  // del detalle se quedan del lado del servidor y salen en el Excel: mandarlo
  // todo serían más de dos megas de JSON en cada carga.
  const filasSku: FilaSkuPlan[] = plan.lineas.map((l) => ({
    sku: l.sku,
    modelo: l.modelo,
    color: l.color,
    talla: l.talla,
    estado: l.estado,
    demandaDiaria: l.demandaDiaria,
    factorCorreccion: l.factorCorreccion,
    diasSinStock: l.diasSinStock,
    disponible: l.disponible,
    enTransferencia: l.enTransferencia,
    coberturaDias: l.coberturaDias,
    sugerido: l.sugerido,
    enviado: l.enviado,
  }));

  // Las cajas del plan, repartidas en los envíos que de verdad se van a dar de
  // alta: uno por dirección de recolección.
  const { envios, sinConfigurar } = await separarEnvios(supabase, cuenta.id, plan.cajas);

  // Envíos ya dados de alta en MELI: los que van en camino cuentan para el
  // plan; los caducados se quedan a la vista un mes, marcados.
  const enCamino = await enviosParaPantalla(supabase, cuenta.id);

  const filasCaja: FilaCajaPlan[] = plan.cajas.map((c) => ({
    codigo: c.codigo,
    skuCaja: c.skuCaja,
    modelo: c.modelo,
    color: c.color,
    almacen: c.almacen,
    esCorrida: c.esCorrida,
    talla: c.talla,
    cantidad: c.cantidad,
    cajasDisponibles: c.cajasDisponibles,
    paresTotales: c.paresTotales,
    aporta: c.aporta.map((a) => ({ sku: a.sku, talla: a.talla, paresTotales: a.paresTotales })),
  }));

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

      <FrescuraPlan
        generadoEn={plan.generadoEn}
        vigente={estado.vigente}
        motivo={estado.motivo}
        msCalculo={estado.msCalculo}
      />

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

      {plan.avisos.map((a, i) => (
        <div key={i} className="tarjeta p-3 text-sm" style={{ color: "var(--ink-2)" }}>
          {a}
        </div>
      ))}

      <EnviosEnCamino
        envios={enCamino.map((e) => ({
          id: e.id,
          folio: e.folio,
          bodegas: e.bodegas,
          cajas: e.cajas,
          pares: e.pares,
          enviadoEn: e.enviadoEn,
          estado: e.estado,
        }))}
      />

      <EnviosSeparados
        envios={envios.map((e) => ({
          grupo: e.grupo,
          nombre: e.nombre,
          almacenes: e.almacenes,
          totalCajas: e.totalCajas,
          totalPares: e.totalPares,
          skus: e.skus,
          porSku: e.porSku,
          cajas: e.cajas.map((c) => ({
            codigo: c.codigo,
            skuCaja: c.skuCaja,
            pedido: c.pedido,
            modelo: c.modelo,
            color: c.color,
            almacen: c.almacen,
            esCorrida: c.esCorrida,
            talla: c.talla,
            cantidad: c.cantidad,
            cajasDisponibles: c.cajasDisponibles,
            paresTotales: c.paresTotales,
            aporta: c.aporta.map((a) => ({
              sku: a.sku,
              talla: a.talla,
              paresTotales: a.paresTotales,
            })),
          })),
        }))}
        sinConfigurar={sinConfigurar}
      />

      <TablasPlan
        lineas={filasSku}
        cajas={filasCaja}
        horizonteDias={p.horizonteDias}
        totalAnalizados={r.skusAnalizados}
        cajasDisponiblesBodega={catalogo.cajasDisponibles}
      />
    </div>
  );
}

function Bienvenida({
  titulo,
  texto,
  cta,
  children,
}: {
  titulo: string;
  texto: string;
  cta?: { href: string; texto: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="tarjeta mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold">{titulo}</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
        {texto}
      </p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-4 inline-block rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ background: "var(--acento)" }}
        >
          {cta.texto}
        </Link>
      ) : null}
      {children ? <div className="mt-4 flex justify-center">{children}</div> : null}
    </div>
  );
}
