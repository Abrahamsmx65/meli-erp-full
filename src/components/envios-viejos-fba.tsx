import type { EnCaminoFba } from "@/lib/servicios/fba-en-camino";
import { DIAS_VIGENCIA_ENVIO_FBA } from "@/lib/servicios/fba-en-camino";
import { Aviso } from "@/components/ui/pagina";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Los envíos entrantes a FBA que el sistema decidió IGNORAR por viejos.
 *
 * Se enseñan para dos cosas: que se vea por qué el plan ya no los cuenta
 * como "en camino", y que el usuario pueda ir a Seller Central a cerrarlos
 * o reclamarlos — mientras existan, Amazon los seguirá reportando.
 */
export function EnviosViejosFba({ enCamino }: { enCamino: EnCaminoFba | null }) {
  if (!enCamino) {
    return (
      <Aviso>
        Los envíos entrantes a FBA aún no se sincronizan (tarda hasta una hora). Mientras,
        el &quot;en camino&quot; sale del reporte de Amazon, que también cuenta envíos atorados.
      </Aviso>
    );
  }
  if (!enCamino.viejos.length) return null;

  return (
    <section className="tarjeta overflow-hidden" style={{ borderColor: "var(--estado-alerta)" }}>
      <header className="border-b p-4 hairline">
        <h2 className="seccion-titulo">
          Envíos a FBA ignorados por viejos ({enCamino.viejos.length} envíos ·{" "}
          {n(enCamino.paresViejos)} pares en el aire)
        </h2>
        <p className="texto-2 mt-0.5 text-sm">
          Más de {DIAS_VIGENCIA_ENVIO_FBA} días sin movimiento: el plan ya no los cuenta como
          &quot;en camino&quot;. Ciérralos o reclámalos en Seller Central.
        </p>
      </header>
      <div className="max-h-[20rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Envío</th>
              <th>Nombre</th>
              <th>Estado</th>
              <th className="num">Pares que nunca llegaron</th>
            </tr>
          </thead>
          <tbody>
            {enCamino.viejos.map((v) => (
              <tr key={v.shipmentId}>
                <td className="font-medium">{v.shipmentId}</td>
                <td className="text-sm">{v.nombre ?? "—"}</td>
                <td className="text-sm">{v.estado}</td>
                <td className="num cifra">{n(v.pares)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
