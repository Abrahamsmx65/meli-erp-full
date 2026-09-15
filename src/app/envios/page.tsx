import Link from "next/link";
import { Suspense } from "react";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { obtenerPlan } from "@/lib/servicios/cache";
import { separarEnvios, verificarEnvios } from "@/lib/servicios/envios";
import { enviosPendientesIndusther, expandirFilaMeli } from "@/lib/servicios/industher-pendientes";
import { indexarCatalogo } from "@/lib/etiquetas/resolver";
import { traerTodo } from "@/lib/datos/repos";
import { cronometro } from "@/lib/servicios/cronometro";
import { Ficha } from "@/components/tiles";
import { desglosarOpcionales, textoDeMas } from "@/lib/reporte/opcionales";
import { EnviosSeparados } from "@/components/envios-separados";
import { PendientesIndusther } from "@/components/pendientes-industher";
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
  const t = cronometro("/envios");
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  t.marca("cuenta");

  if (!cuenta) {
    return (
      <Bienvenida
        titulo="Conecta tu cuenta de Mercado Libre"
        texto="Todavía no hay una cuenta conectada. Ve a Ajustes para autorizar la app y traer tu catálogo, tu stock en Full y tus ventas."
        cta={{ href: "/ajustes", texto: "Ir a Ajustes" }}
      />
    );
  }

  // Los pendientes de la bodega vienen del API de Industher EN VIVO (hasta
  // 20 s si su servidor anda lento): la promesa arranca ya, pero NO se
  // espera aquí — sus dos secciones llegan por streaming (Suspense) y el
  // resto de la página pinta de inmediato.
  const pendientesPromesa = enviosPendientesIndusther(supabase, cuenta.id);

  // Todo lo independiente en UN solo Promise.all: el plan y los almacenes.
  // Los envíos registrados ya no se pintan aquí (decisión del dueño): solo
  // alimentan el plan como "en camino".
  const [estado, almacenesRaw] = await Promise.all([
    t.medir("plan", obtenerPlan(supabase, cuenta.id)),
    traerTodo<{ almacen: string; grupo_envio: string | null }>(
      supabase,
      "almacenes_activos",
      "almacen, surte_full, grupo_envio",
      (q) => q.eq("account_id", cuenta.id),
    ).catch(() => [] as { almacen: string; grupo_envio: string | null }[]),
  ]);
  t.fin();
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
  // alta: uno por dirección de recolección. Los almacenes ya vienen leídos.
  const { envios, sinConfigurar } = await separarEnvios(supabase, cuenta.id, plan.cajas, almacenesRaw);

  // Lo acordado: el total oficial son las cajas OBLIGATORIAS; las del rescate
  // de tallas (opcionales) se muestran aparte con su sobrante por talla, y el
  // usuario decide cuáles subir.
  const desglose = desglosarOpcionales(
    plan.cajas.map((c) => ({
      codigo: c.codigo,
      cantidad: c.cantidad,
      paresPorCaja: c.paresPorCaja,
      cantidadOpcional: c.cantidadOpcional ?? 0,
      aporta: c.aporta.map((a) => ({ sku: a.sku, talla: a.talla, paresPorCaja: a.paresPorCaja })),
    })),
    plan.lineas.map((l) => ({ sku: l.sku, sugerido: l.sugerido })),
  );

  // UNA sola copia de las cajas viaja al navegador; la tabla del plan y las
  // tarjetas de envío la comparten (antes se serializaba dos veces: ~medio
  // mega duplicado en cada carga y en cada refresh).
  const filasCaja: FilaCajaPlan[] = plan.cajas.map((c) => ({
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
    paresPorCaja: c.paresPorCaja,
    paresTotales: c.paresTotales,
    cantidadOpcional: Math.min(c.cantidad, c.cantidadOpcional ?? 0),
    deMas: textoDeMas(desglose.deMasPorCaja.get(c.codigo) ?? []),
    aporta: c.aporta.map((a) => ({
      sku: a.sku,
      talla: a.talla,
      paresPorCaja: a.paresPorCaja,
      paresTotales: a.paresTotales,
    })),
  }));

  const grupos = envios.map((e) => ({
    grupo: e.grupo,
    nombre: e.nombre,
    almacenes: e.almacenes,
    codigos: e.cajas.map((c) => c.codigo),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titulo-pagina">Plan de envío</h1>
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

      {/* ---- Envíos que la bodega ya apartó para MELI ---------------------
           Llega por streaming: el API de Industher puede tardar segundos y
           no debe detener el resto de la página. */}
      <Suspense fallback={<EsperandoBodega />}>
        <SeccionPendientesBodega promesa={pendientesPromesa} />
      </Suspense>

      {/* ---- Cifras de cabecera ------------------------------------------ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Ficha
          titulo="SKUs críticos"
          valor={r.skusCriticos}
          nota="Se agotan antes de que llegue el envío"
          tono={r.skusCriticos > 0 ? "critico" : "bien"}
        />
        <Ficha titulo="Urgentes" valor={r.skusUrgentes} nota="Bajo punto de reorden" tono="alerta" />
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
              ? `${n(desglose.paresOpcionales)} pares extra si las subes: rescates y la media caja de la regla de la mitad`
              : "El plan no necesitó rescates"
          }
          tono={desglose.cajasOpcionales > 0 ? "alerta" : "neutro"}
        />
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

      <EnviosSeparados grupos={grupos} cajas={filasCaja} sinConfigurar={sinConfigurar} />

      {/* ---- Doble verificación del envío ---------------------------------
           También espera al API de Industher (el solape con lo apartado):
           llega por streaming después del resto. Las corridas para repartir
           por talla se leen ADENTRO: no bloquean el primer pixel. */}
      {envios.length ? (
        <Suspense
          fallback={
            <section className="tarjeta p-4 text-sm" style={{ color: "var(--ink-2)" }}>
              Verificando el envío contra lo que la bodega ya apartó…
            </section>
          }
        >
          <SeccionVerificacion
            promesa={pendientesPromesa}
            envios={envios}
            lineasPlan={plan.lineas}
            accountId={cuenta.id}
          />
        </Suspense>
      ) : null}

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
      <h1 className="titulo-seccion">{titulo}</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
        {texto}
      </p>
      {cta ? (
        <Link href={cta.href} className="boton boton-primario mt-4 inline-flex">
          {cta.texto}
        </Link>
      ) : null}
      {children ? <div className="mt-4 flex justify-center">{children}</div> : null}
    </div>
  );
}

/** Mientras contesta el API de Industher: la página ya está usable. */
function EsperandoBodega() {
  return (
    <section className="tarjeta animate-pulse p-4 text-sm" style={{ color: "var(--ink-2)" }}>
      Consultando a la bodega los envíos que ya apartó…
    </section>
  );
}

async function SeccionPendientesBodega({
  promesa,
}: {
  promesa: ReturnType<typeof enviosPendientesIndusther>;
}) {
  const pendientesBodega = await promesa;
  // Al navegador solo van los envíos de MELI y sus 5 campos de cabecera:
  // antes viajaban TODOS los envíos con TODOS sus renglones (la prop más
  // pesada de la página) y el filtro corría en el navegador.
  const deMeli = pendientesBodega.envios
    .filter((e) => e.esMeli)
    .map((e) => ({ id: e.id, fecha: e.fecha, cajas: e.cajas, pares: e.pares, omitido: e.omitido }));
  return <PendientesIndusther envios={deMeli} error={pendientesBodega.error} />;
}

async function SeccionVerificacion({
  promesa,
  envios,
  lineasPlan,
  accountId,
}: {
  promesa: ReturnType<typeof enviosPendientesIndusther>;
  envios: Awaited<ReturnType<typeof separarEnvios>>["envios"];
  lineasPlan: Parameters<typeof indexarCatalogo>[0];
  accountId: string;
}) {
  // Las corridas solo se usan aquí (repartir por talla las filas de CORRIDA
  // de los pendientes): se leen dentro del Suspense, en paralelo con la
  // espera del API de Industher, sin frenar el resto de la página.
  const supabase = await clienteServidor();
  const [pendientesBodega, corridasRaw] = await Promise.all([
    promesa,
    traerTodo<any>(supabase, "corridas", "pedido, modelo, color, tallas", (q) =>
      q.eq("account_id", accountId),
    ).catch(() => [] as any[]),
  ]);
  const indicePlan = indexarCatalogo(lineasPlan);
  const corridasPendientes = (corridasRaw ?? []).map((c: any) => ({
    pedido: String(c.pedido ?? ""),
    modelo: String(c.modelo ?? ""),
    color: String(c.color ?? ""),
    tallas: (c.tallas ?? {}) as Record<string, number>,
  }));

  // Doble verificación del envío: stock, cajas repetidas, cuadre de pares y
  // solape con lo que la bodega ya apartó. Los SKUs de los pendientes vienen
  // como los escribe la bodega: se amarran al SKU de MELI (y las corridas se
  // reparten por talla) para comparar manzanas con manzanas.
  const verificacion = verificarEnvios(
    envios,
    pendientesBodega.envios
      .filter((e) => e.esMeli && !e.omitido)
      .map((e) => ({
        id: e.id,
        filas: e.filas.flatMap((f) => expandirFilaMeli(f, indicePlan, corridasPendientes)),
      })),
  );

  return (
    <section className="tarjeta p-4">
      <h2 className="text-sm font-semibold">Verificación del envío</h2>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm">
        {verificacion.map((v, i) => (
          <li key={i} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              style={{ color: v.ok ? "var(--exito-texto)" : "var(--estado-alerta)" }}
            >
              {v.ok ? "✓" : "⚠"}
            </span>
            <span style={{ color: v.ok ? "var(--ink-2)" : "var(--ink-1)" }}>{v.texto}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
