import { Pastilla } from "@/components/pastilla";
import { escaneosRecientes, listarBoletos } from "@/lib/boletos";
import { formatearFolio } from "@/lib/codigos";
import { listarEventos } from "@/lib/eventos";
import { fechaCorta } from "@/lib/formato";
import { BotonLiberar } from "./boton-liberar";

export const dynamic = "force-dynamic";

const ETIQUETA_RESULTADO: Record<string, string> = {
  ok: "Entró",
  ya_usado: "Ya había entrado",
  no_existe: "No existe",
  cancelado: "Cancelado",
  no_pagado: "Sin pagar",
};

export default async function Asistentes({ searchParams }: { searchParams: Promise<{ evento?: string; q?: string }> }) {
  const f = await searchParams;
  const [eventos, boletos, escaneos] = await Promise.all([
    listarEventos(false),
    listarBoletos(f.evento || undefined, f.q || undefined),
    escaneosRecientes(25),
  ]);
  const usados = boletos.filter((b) => b.estado === "usado").length;
  const validos = boletos.filter((b) => b.estado === "valido" && b.estado_pedido === "pagado").length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="serif text-3xl font-bold">Asistentes</h1>
            <p className="text-sm" style={{ color: "var(--tinta-suave)" }}>{usados} ya entraron · {validos} por llegar</p>
          </div>
          <form className="flex flex-wrap gap-2" method="get">
            <select name="evento" defaultValue={f.evento ?? ""} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--borde)" }}>
              <option value="">Todos los eventos</option>
              {eventos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
            <input name="q" defaultValue={f.q ?? ""} placeholder="Nombre, correo, referencia…" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--borde)" }} />
            <button className="boton boton-suave !py-2">Buscar</button>
          </form>
        </div>
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>Folio</th><th>Tipo</th><th>Persona</th><th>Pedido</th><th>Estado</th><th>Entró</th><th></th></tr></thead>
            <tbody>
              {boletos.length === 0 && <tr><td colSpan={7} className="py-10 text-center" style={{ color: "var(--tinta-suave)" }}>Todavía no hay boletos emitidos.</td></tr>}
              {boletos.map((b) => (
                <tr key={b.id}>
                  <td className="mono font-semibold">{formatearFolio(b.folio)}</td>
                  <td className="font-semibold">{b.tipo ?? "—"}</td>
                  <td><div className="font-semibold">{b.nombre}</div><div className="text-xs" style={{ color: "var(--tinta-suave)" }}>{b.correo}</div></td>
                  <td className="mono text-sm">{b.referencia}</td>
                  <td><Pastilla estado={b.estado} /></td>
                  <td className="whitespace-nowrap text-sm">{b.usado_en ? `${fechaCorta(b.usado_en)}` : "—"}</td>
                  <td>{b.estado === "usado" && <BotonLiberar boletoId={b.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="tarjeta p-5">
        <h2 className="font-bold">Últimos escaneos</h2>
        <ul className="mt-3 grid gap-2 text-sm">
          {escaneos.length === 0 && <li style={{ color: "var(--tinta-suave)" }}>Nadie ha escaneado todavía.</li>}
          {escaneos.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: "var(--borde)" }}>
              <div>
                <div className="font-medium">{e.nombre ?? <span className="mono text-xs">{e.codigo.slice(0, 12)}…</span>}</div>
                <div className="text-xs" style={{ color: "var(--tinta-suave)" }}>{e.folio ? formatearFolio(e.folio) : ""} {fechaCorta(e.creado_en)}</div>
              </div>
              <span className={`pastilla ${e.resultado === "ok" ? "pastilla-pagado" : e.resultado === "ya_usado" ? "pastilla-por_confirmar" : "pastilla-cancelado"}`}>
                {ETIQUETA_RESULTADO[e.resultado] ?? e.resultado}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
