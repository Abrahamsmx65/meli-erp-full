import Link from "next/link";
import { listarEventos } from "@/lib/eventos";
import { fechaCorta, pesos } from "@/lib/formato";

export const dynamic = "force-dynamic";

export default async function Eventos() {
  const eventos = await listarEventos(false);
  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between">
        <h1 className="serif text-3xl font-bold">Eventos</h1>
        <Link href="/admin/eventos/nuevo" className="boton">+ Nuevo evento</Link>
      </div>
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr><th>Evento</th><th>Fecha</th><th>Boletos</th><th className="text-right">Pagados / apartados / límite</th><th>Venta</th><th></th></tr>
          </thead>
          <tbody>
            {eventos.length === 0 && <tr><td colSpan={6} className="py-10 text-center" style={{ color: "var(--tinta-suave)" }}>Crea tu primer evento.</td></tr>}
            {eventos.map((e) => (
              <tr key={e.id}>
                <td className="font-semibold">{e.nombre}<div className="text-xs font-normal" style={{ color: "var(--tinta-suave)" }}>{e.lugar}</div></td>
                <td className="whitespace-nowrap text-sm">{fechaCorta(e.fecha)}</td>
                <td className="text-sm">{e.tipos.map((t) => `${t.nombre} ${pesos(t.precio)}`).join(" · ") || "—"}</td>
                <td className="text-right">{e.pagados} / {e.ocupados} / {e.capacidad}</td>
                <td>{e.activo ? <span className="pastilla pastilla-pagado">Abierta</span> : <span className="pastilla pastilla-cancelado">Cerrada</span>}</td>
                <td className="whitespace-nowrap">
                  <Link href={`/admin/eventos/${e.id}`} className="boton boton-suave !px-3 !py-1.5 text-sm">Editar</Link>{" "}
                  <a href={`/evento/${e.id}`} target="_blank" rel="noreferrer" className="boton boton-fantasma !px-3 !py-1.5 text-sm">Ver página</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
