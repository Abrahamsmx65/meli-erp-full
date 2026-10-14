import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { listarNumeros } from "@/lib/servicios/numeros";
import { servirConCacheApp } from "@/lib/servicios/cache-app";
import { CLAVE_TARIFAS, EDAD_TARIFAS_MS, calcularTarifasReales, type TarifasGuardadas } from "@/lib/servicios/tarifas-reales";
import { TablaNumeros } from "@/components/numeros";
import { PreciosNumeros } from "@/components/precios-numeros";
import { Aviso, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Números (dueño, 11-oct-2026): precio de cada modelo en MELI, Amazon y
 * TikTok con el costo del ÚLTIMO contenedor costeado (tipo de cambio real
 * de sus pagos, flete y aduana por CBM, sin comisiones) y lo que cada
 * plataforma cobró DE VERDAD en los últimos 30 días (sin ventas
 * suficientes, la estimación del dueño). Reemplaza el sheet «Números»; las
 * fórmulas viven en `finanzas/numeros.ts`.
 */
export default async function Numeros() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Números" />;
  const db = supabase as DB;
  const tarifas = await servirConCacheApp<TarifasGuardadas>(db, cuenta.id, CLAVE_TARIFAS, EDAD_TARIFAS_MS, () =>
    calcularTarifasReales(db, cuenta.id),
  ).catch(() => null);
  const { renglones, costeoEn } = await listarNumeros(db, cuenta.id, tarifas?.datos.porModelo ?? {});
  const conCatalogo = renglones.filter((r) => r.fuenteCosto === "catalogo").length;

  return (
    <Pagina>
      <Encabezado ceja="Negocio" titulo="Números" frescura={tarifas?.generadoEn ?? costeoEn} refrescando={tarifas?.refrescando} />
      {!tarifas ? <Aviso tono="alerta">No se pudieron leer las tarifas reales: todo se calcula con tus estimaciones.</Aviso> : null}
      {tarifas?.datos.avisos.map((a, i) => (
        <Aviso key={i} tono="alerta">Tarifas reales de {a}</Aviso>
      ))}
      {conCatalogo ? (
        <Aviso tono="info">
          {conCatalogo} modelos no tienen contenedor costeado y usan el costo de Catálogo y costos.
        </Aviso>
      ) : null}
      <Seccion titulo="Llevar precios a MELI y Amazon" sinRelleno>
        <PreciosNumeros />
      </Seccion>
      <Seccion sinRelleno>
        <div className="p-3">
          <TablaNumeros renglones={renglones} />
        </div>
      </Seccion>
    </Pagina>
  );
}
