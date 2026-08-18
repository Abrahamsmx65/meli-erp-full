import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarCorridas } from "@/lib/servicios/corridas";
import { Ficha } from "@/components/tiles";
import { TablaCorridas } from "@/components/tabla-corridas";

export const dynamic = "force-dynamic";

export default async function Corridas() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Conecta Mercado Libre</h1>
        <Link href="/ajustes" className="mt-3 inline-block underline" style={{ color: "var(--acento)" }}>
          Ir a Ajustes
        </Link>
      </div>
    );
  }

  const r = await cargarCorridas(supabase, cuenta.id);
  const t = r.totales;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Corridas</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Qué tallas trae cada caja. Es lo que convierte &quot;40 cajas de GT104 negro&quot; en
          &quot;3 pares del 25, 6 del 26, 15 del 27…&quot;, y sin eso el planeador no puede
          decidir qué mandar a Full.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ficha titulo="Corridas" valor={t.corridas} nota={`${t.porProforma} salieron de una proforma`} />
        <Ficha
          titulo="Capturadas a mano"
          valor={t.manuales}
          nota="De antes de cargar proformas"
        />
        <Ficha titulo="Cajas legibles" valor={t.cajasCubiertas} nota="Se sabe qué traen" tono="bien" />
        <Ficha
          titulo="Cajas opacas"
          valor={t.cajasOpacas}
          nota="Falta su corrida"
          tono={t.cajasOpacas > 0 ? "alerta" : "bien"}
        />
      </div>

      <details className="tarjeta p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          De dónde salen estas corridas
        </summary>
        <div className="mt-3 flex flex-col gap-2 text-sm" style={{ color: "var(--ink-2)" }}>
          <p>
            Cuando cargas un pedido en{" "}
            <Link href="/pedidos" className="underline">
              Pedidos a China
            </Link>
            , la proforma de la fábrica ya trae el reparto de tallas por caja. El sistema lo
            lee y da de alta la corrida solo, marcada como{" "}
            <strong>de la proforma</strong>. No hay que capturar nada.
          </p>
          <p>
            Las que dicen <strong>manual</strong> son de pedidos viejos, cargados antes de
            que existiera esa lectura. Siguen sirviendo igual.
          </p>
          <p>
            Si un modelo cambia de corrida entre pedidos, no se pisan: la corrida se guarda
            por pedido, así que las cajas viejas conservan la suya y las nuevas usan la nueva.
          </p>
        </div>
      </details>

      <TablaCorridas corridas={r.corridas} huecos={r.huecos} tallas={r.tallas} />
    </div>
  );
}
