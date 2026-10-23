import type { RenglonOferta } from "@/lib/precios/ofertas-aporte";
import type { PromocionResumen } from "@/lib/servicios/ofertas-meli";
import { Tabla, Vacio } from "@/components/ui/pagina";

const din = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fechaCorta = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short" });
};

/** Las ofertas con aporte (Ofertas MELI de calzado y Ofertas de fundas). */
export function TablaOfertas({ renglones, etiqueta = "Modelo", precio = "PV normal" }: { renglones: RenglonOferta[]; etiqueta?: string; precio?: string }) {
  if (!renglones.length) return <Vacio>Nada por aquí.</Vacio>;
  return (
    <Tabla alta>
      <table className="datos">
        <thead>
          <tr>
            <th>{etiqueta}</th>
            <th>Publicación</th>
            <th>Oferta</th>
            <th className="num">Precio al cliente</th>
            <th className="num">Aporte MELI</th>
            <th className="num">Te queda</th>
            <th className="num">{precio}</th>
            <th>Vence</th>
            <th>Por qué</th>
          </tr>
        </thead>
        <tbody>
          {renglones.map((r) => (
            <tr key={`${r.itemId}|${r.promoId}`}>
              <td className="cifra">{r.modelo ?? "—"}</td>
              <td className="cifra">{r.itemId}</td>
              <td>{r.nombre}</td>
              <td className="num cifra">{din(r.precio)}</td>
              <td className="num cifra">{din(r.aporte)}</td>
              <td className="num cifra">{din(r.efectivo)}</td>
              <td className="num cifra">{din(r.pvNormal)}</td>
              <td>{fechaCorta(r.fin)}</td>
              <td className="texto-2 text-xs">{r.motivo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Tabla>
  );
}

/** Las promociones con aporte que MELI tiene para la cuenta. */
export function TablaPromocionesOfertas({
  promociones,
  renglones,
  publicaciones = "Publicaciones de calzado",
}: {
  promociones: PromocionResumen[];
  renglones: RenglonOferta[];
  publicaciones?: string;
}) {
  return (
    <Tabla vacia={!promociones.length} textoVacio="MELI no tiene promociones con aporte para la cuenta.">
      <table className="datos">
        <thead>
          <tr>
            <th>Promoción</th>
            <th>Tipo</th>
            <th>Estado</th>
            <th>Vence</th>
            <th className="num">{publicaciones}</th>
            <th className="num">Con aporte</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {promociones.map((p) => (
            <tr key={p.id}>
              <td>{p.nombre}</td>
              <td className="cifra">{p.tipo}</td>
              <td>{p.estado}</td>
              <td>{fechaCorta(p.fin)}</td>
              <td className="num cifra">{p.invitadas}</td>
              <td className="num cifra">{renglones.filter((r) => r.promoId === p.id && r.decision !== "sin_aporte").length}</td>
              <td className="text-xs">{p.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Tabla>
  );
}
