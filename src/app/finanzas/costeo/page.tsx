import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { leerCacheAppGuardado } from "@/lib/servicios/cache-app";
import { CLAVE_COSTEO, EDAD_COSTEO_MS, recalcularCosteo, type ResultadoCosteo } from "@/lib/servicios/costeo";
import { marcarRefrescando } from "@/lib/servicios/marca-refresco";
import { Ficha } from "@/components/tiles";
import { AccionesCosteo, ContenedoresCosteo, CostosPorModelo } from "@/components/costeo";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Vacio } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";
import { LeerSheets } from "@/components/leer-sheets";
import { ultimaLecturaSheets } from "@/lib/servicios/sheets-finanzas";

export const dynamic = "force-dynamic";

/**
 * Costeo real por contenedor (dueño, 11-oct-2026). Todo vive en el ERP:
 * factura y flete en USD con el tipo de cambio de CADA pago, aduana en
 * pesos y si ya se entregó. Lo que traía cada contenedor sale del Excel de
 * costeo o del packing list; flete y aduana se reparten SOLO por los CBM
 * del contenedor. Sin comisiones ni gastos (son operativos). Se calcula al
 * capturar, en el cron diario y con «Recalcular»; aquí solo se lee.
 */
export default async function Costeo() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Costeo" />;

  const guardado = await leerCacheAppGuardado<ResultadoCosteo>(supabase as DB, cuenta.id, CLAVE_COSTEO);
  const r = guardado.estado === "encontrado" ? guardado.valor.datos : null;
  // Un renglón de la versión anterior (antes de capturar pagos) no trae `excel`.
  const vieja = r != null && !("excel" in r);
  const viejo = vieja || (guardado.estado === "encontrado" && Date.now() - Date.parse(guardado.valor.generadoEn) > EDAD_COSTEO_MS);
  if (viejo || !r) {
    marcarRefrescando();
    try {
      const { after } = await import("next/server");
      const { clienteAdmin } = await import("@/lib/supabase/admin");
      after(() => recalcularCosteo(clienteAdmin() as DB, cuenta.id).then(() => undefined).catch(() => undefined));
    } catch {
      /* sin contexto de request: lo guardado sirve igual */
    }
  }

  const encabezado = (
    <Encabezado ceja="Negocio" titulo="Costeo" frescura={r?.generadoEn ?? null} refrescando={viejo} acciones={<div className="flex flex-wrap items-center gap-2"><LeerSheets leidoEn={(await ultimaLecturaSheets(supabase as DB, cuenta.id))?.leidoEn ?? null} /><AccionesCosteo /></div>} />
  );
  if (!r || vieja) {
    return (
      <Pagina>
        {encabezado}
        <Vacio>Calculando el costeo… se actualiza solo en unos segundos.</Vacio>
      </Pagina>
    );
  }

  const cuentan = r.contenedores.filter((c) => c.cuenta);
  const pendientes = r.contenedores.filter((c) => !c.cuenta);
  const conReal = r.modelos.filter((m) => m.real != null);
  const noCuadran = conReal.filter(
    (m) => m.costoActual == null || m.costoActual <= 0 || Math.abs(m.real! - m.costoActual) / m.costoActual >= 0.01,
  );

  return (
    <Pagina>
      {encabezado}
      {!r.excel ? (
        <Aviso tono="alerta" titulo="Falta el Excel de costeo">
          Sin él solo se reparten los contenedores con packing list. Súbelo con «Subir Excel de costeo».
        </Aviso>
      ) : null}
      {r.avisos.map((a, i) => (
        <Aviso key={i} tono="alerta">{a}</Aviso>
      ))}
      <Cifras columnas={4}>
        <Ficha titulo="Contenedores que cuentan" valor={cuentan.length} nota="Entregados y con aduana" />
        <Ficha titulo="Pendientes" valor={pendientes.length} tono={pendientes.length ? "alerta" : "neutro"} />
        <Ficha titulo="Modelos con costo real" valor={conReal.length} />
        <Ficha titulo="No cuadran con el catálogo" valor={noCuadran.length} tono={noCuadran.length ? "alerta" : "bien"} />
      </Cifras>
      <Pestanas
        pestanas={[
          {
            id: "contenedores",
            titulo: "Contenedores",
            cuenta: r.contenedores.length,
            contenido: (
              <Seccion sinRelleno>
                <div className="p-3">
                  <ContenedoresCosteo contenedores={r.contenedores} />
                </div>
              </Seccion>
            ),
          },
          {
            id: "modelos",
            titulo: "Por modelo",
            cuenta: conReal.length,
            contenido: (
              <Seccion titulo="Costo por par">
                <CostosPorModelo modelos={r.modelos} />
              </Seccion>
            ),
          },
        ]}
      />
    </Pagina>
  );
}
