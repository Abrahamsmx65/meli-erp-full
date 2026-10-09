import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarCorridas } from "@/lib/servicios/corridas";
import { Ficha } from "@/components/tiles";
import { TablaCorridas } from "@/components/tabla-corridas";
import { Cifras, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

export default async function Corridas() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) return <SinCuenta titulo="Corridas por caja" />;

  const r = await cargarCorridas(supabase, cuenta.id);
  const t = r.totales;

  return (
    <Pagina>
      <Encabezado
        ceja="Abastecimiento"
        titulo="Corridas por caja"
        descripcion="Qué tallas trae cada caja: sin eso el planeador no puede decidir qué mandar a Full."
        ayudaTitulo="De dónde salen estas corridas"
        ayuda={
          <>
            <p>
              Es lo que convierte &quot;40 cajas de GT104 negro&quot; en &quot;3 pares del 25, 6
              del 26, 15 del 27…&quot;.
            </p>
            <p>
              Cuando cargas un pedido en{" "}
              <Link href="/pedidos/cargar" className="enlace">
                Cargar pedidos
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
          </>
        }
      />

      <Cifras columnas={4}>
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
      </Cifras>

      <TablaCorridas corridas={r.corridas} huecos={r.huecos} tallas={r.tallas} />
    </Pagina>
  );
}
