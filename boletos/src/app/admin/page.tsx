import Link from "next/link";
import { Pastilla } from "@/components/pastilla";
import { listarEventos } from "@/lib/eventos";
import { fechaCorta, pesos } from "@/lib/formato";
import { listarPedidos, resumir } from "@/lib/pedidos";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Busqueda {
  evento?: string;
  estado?: string;
  q?: string;
}

export default async function PanelPedidos({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const f = await searchParams;
  const [eventos, pedidos] = await Promise.all([
    listarEventos(false),
    listarPedidos({ evento_id: f.evento || undefined, estado: f.estado || undefined, busqueda: f.q || undefined }),
  ]);

  let boletosQ = clienteAdmin().from("ev_boletos").select("estado, pedido_id");
  if (f.evento) boletosQ = boletosQ.eq("evento_id", f.evento);
  const { data: boletos } = await boletosQ;
  const r = resumir(pedidos, boletos ?? []);
  const nombreEvento = new Map(eventos.map((e) => [e.id, e.nombre]));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Pedidos</h1>
        <form className="flex flex-wrap gap-2" method="get">
          <select name="evento" defaultValue={f.evento ?? ""} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--borde)" }}>
            <option value="">Todos los eventos</option>
            {eventos.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
          <select name="estado" defaultValue={f.estado ?? ""} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--borde)" }}>
            <option value="">Todos los estados</option>
            <option value="pendiente">Esperando pago</option>
            <option value="por_confirmar">Avisó que pagó</option>
            <option value="pagado">Pagado</option>
            <option value="cancelado">Cancelado</option>
          </select>
          <input name="q" defaultValue={f.q ?? ""} placeholder="Nombre, correo, referencia…" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--borde)" }} />
          <button className="boton boton-suave !py-2">Filtrar</button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cifra titulo="Por revisar" valor={r.porConfirmar} nota="avisaron que pagaron" resaltar={r.porConfirmar > 0} />
        <Cifra titulo="Esperando pago" valor={r.pendientes} nota="pedidos sin transferir" />
        <Cifra titulo="Boletos pagados" valor={r.boletosPagados} nota={`${r.boletosUsados} ya entraron`} />
        <Cifra titulo="Cobrado" valor={pesos(r.dinero)} nota={`${r.pagados} pedidos pagados`} />
      </div>

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Referencia</th>
              <th>Persona</th>
              <th>Evento</th>
              <th className="text-right">Boletos</th>
              <th className="text-right">Total</th>
              <th>Estado</th>
              <th>Pedido</th>
              <th>Aviso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pedidos.length === 0 && (
              <tr><td colSpan={9} className="py-10 text-center" style={{ color: "var(--tinta-suave)" }}>No hay pedidos con ese filtro.</td></tr>
            )}
            {pedidos.map((p) => (
              <tr key={p.id}>
                <td className="mono font-semibold">{p.referencia}</td>
                <td>
                  <div className="font-semibold">{p.nombre}</div>
                  <div className="text-xs" style={{ color: "var(--tinta-suave)" }}>{p.correo}{p.telefono && ` · ${p.telefono}`}</div>
                </td>
                <td className="text-sm">{nombreEvento.get(p.evento_id) ?? "—"}</td>
                <td className="text-right">{p.cantidad}</td>
                <td className="text-right font-semibold">{pesos(p.total)}</td>
                <td><Pastilla estado={p.estado} />{p.comprobante_ruta && <div className="mt-1 text-xs" style={{ color: "var(--tinta-suave)" }}>📎 comprobante</div>}</td>
                <td className="text-sm whitespace-nowrap">{fechaCorta(p.creado_en)}</td>
                <td className="text-sm whitespace-nowrap">{fechaCorta(p.aviso_pago_en)}</td>
                <td><Link href={`/admin/pedidos/${p.id}`} className="boton boton-suave !px-3 !py-1.5 text-sm">Abrir</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cifra({ titulo, valor, nota, resaltar }: { titulo: string; valor: number | string; nota: string; resaltar?: boolean }) {
  return (
    <div className="tarjeta p-4" style={resaltar ? { borderColor: "var(--alerta)", background: "var(--alerta-suave)" } : undefined}>
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--tinta-suave)" }}>{titulo}</div>
      <div className="mt-1 text-2xl font-extrabold">{valor}</div>
      <div className="text-xs" style={{ color: "var(--tinta-suave)" }}>{nota}</div>
    </div>
  );
}
