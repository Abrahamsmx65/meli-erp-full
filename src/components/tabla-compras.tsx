"use client";

import { Fragment, useMemo, useState } from "react";
import { BarraCobertura } from "./tiles";

interface Renglon {
  modelo: string;
  color: string;
  tallas: number;
  demandaDiaria: number;
  ventaMes: number;
  enFull: number;
  enTransferencia: number;
  enBodega: number;
  enCamino: number;
  inventarioTotal: number;
  coberturaDias: number | null;
  fechaQuiebre: string | null;
  objetivo: number;
  faltante: number;
  paresPorCaja: number | null;
  cajasSugeridas: number;
  paresSugeridos: number;
  tieneCorrida: boolean;
  corridaPedido: string | null;
  urgencia: "quiebre" | "urgente" | "pronto" | "ok" | "sobrado";
  desajusteCorrida: { talla: string; enCorrida: number; segunDemanda: number }[];
  motivo: string;
}

const COLOR: Record<Renglon["urgencia"], string> = {
  quiebre: "var(--estado-critico)",
  urgente: "var(--estado-critico)",
  pronto: "var(--estado-alerta)",
  ok: "var(--exito-texto)",
  sobrado: "var(--ink-muted)",
};

const ETIQUETA: Record<Renglon["urgencia"], string> = {
  quiebre: "Sin producto",
  urgente: "Pedir ya",
  pronto: "Pedir pronto",
  ok: "Al día",
  sobrado: "De sobra",
};

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Qué pedirle a la fábrica.
 *
 * El orden por defecto no es alfabético ni por volumen: es por cuándo se
 * acaba. Lo que se va a quedar sin producto antes de que alcance a llegar un
 * pedido nuevo va hasta arriba, porque es lo único que realmente urge decidir
 * hoy.
 */
export function TablaCompras({
  renglones,
  ciclo,
}: {
  renglones: Renglon[];
  ciclo: number;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [soloPedir, setSoloPedir] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return renglones.filter((r) => {
      if (soloPedir && r.cajasSugeridas === 0 && r.faltante <= 0) return false;
      if (!q) return true;
      return `${r.modelo} ${r.color}`.includes(q);
    });
  }, [renglones, busqueda, soloPedir]);

  const visibles = filtrados.slice(0, 400);

  const totalCajas = filtrados.reduce((a, r) => a + r.cajasSugeridas, 0);
  const totalPares = filtrados.reduce((a, r) => a + r.paresSugeridos, 0);

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b p-3 hairline">
        <h2 className="text-sm font-semibold">Qué conviene pedir</h2>

        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar modelo o color…"
          className="rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
        />

        <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--ink-2)" }}>
          <input
            type="checkbox"
            checked={soloPedir}
            onChange={(e) => setSoloPedir(e.target.checked)}
          />
          Solo lo que falta
        </label>

        <div className="ml-auto text-sm" style={{ color: "var(--ink-2)" }}>
          <strong className="cifra">{n(totalCajas)}</strong> cajas ·{" "}
          <strong className="cifra">{n(totalPares)}</strong> pares
          {filtrados.length > visibles.length ? (
            <span style={{ color: "var(--ink-muted)" }}>
              {" "}
              · mostrando {visibles.length} de {filtrados.length}
            </span>
          ) : null}
        </div>
      </header>

      <div className="max-h-[36rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Modelo / color</th>
              <th className="num">Venta/mes</th>
              <th className="num">Full</th>
              <th className="num">Bodega</th>
              <th className="num">En barco</th>
              <th className="num">Total</th>
              <th>Aguanta</th>
              <th className="num">Faltan</th>
              <th className="num">Cajas</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((r) => {
              const id = `${r.modelo}|${r.color}`;
              const ab = abierto === id;
              return (
                <Fragment key={id}>
                  <tr
                    onClick={() => setAbierto(ab ? null : id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="font-medium">
                      {r.modelo}
                      <span style={{ color: "var(--ink-2)" }}> · {r.color || "—"}</span>
                      <div className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                        {r.tallas} tallas
                        {r.paresPorCaja ? ` · ${r.paresPorCaja} pares/caja` : " · sin corrida"}
                      </div>
                    </td>
                    <td className="num cifra">{n(r.ventaMes)}</td>
                    <td className="num cifra">{n(r.enFull + r.enTransferencia)}</td>
                    <td className="num cifra">{n(r.enBodega)}</td>
                    <td className="num cifra">{r.enCamino ? n(r.enCamino) : "—"}</td>
                    <td className="num cifra font-medium">{n(r.inventarioTotal)}</td>
                    <td style={{ minWidth: 110 }}>
                      <div className="cifra text-xs">
                        {r.coberturaDias === null
                          ? "sin venta"
                          : `${Math.round(r.coberturaDias)} días`}
                      </div>
                      <BarraCobertura
                        dias={r.coberturaDias ?? 0}
                        horizonte={ciclo}
                        color={COLOR[r.urgencia]}
                        maximo={ciclo * 3}
                      />
                    </td>
                    <td className="num cifra">{r.faltante ? n(r.faltante) : "—"}</td>
                    <td className="num cifra font-semibold">
                      {r.cajasSugeridas ? n(r.cajasSugeridas) : r.faltante > 0 ? "?" : "—"}
                    </td>
                    <td>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          background: `color-mix(in oklab, ${COLOR[r.urgencia]} 15%, transparent)`,
                          color: COLOR[r.urgencia],
                        }}
                      >
                        {ETIQUETA[r.urgencia]}
                      </span>
                    </td>
                  </tr>

                  {ab ? (
                    <tr>
                      <td colSpan={10} style={{ background: "var(--surface-2)" }}>
                        <div className="p-3 text-sm">
                          <p>{r.motivo}</p>

                          <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>
                            Objetivo <span className="cifra">{n(r.objetivo)}</span> pares (
                            {r.tallas} tallas) · hoy tienes{" "}
                            <span className="cifra">{n(r.inventarioTotal)}</span>:{" "}
                            {n(r.enFull)} en Full, {n(r.enTransferencia)} en camino a Full,{" "}
                            {n(r.enBodega)} en bodega, {n(r.enCamino)} en barco.
                            {r.fechaQuiebre ? ` Se queda en cero el ${r.fechaQuiebre}.` : ""}
                          </p>

                          {r.desajusteCorrida.length ? (
                            <div className="mt-3">
                              <div className="text-xs font-semibold">
                                La corrida no embona con cómo se vende
                                {r.corridaPedido ? ` (corrida del pedido ${r.corridaPedido})` : ""}
                              </div>
                              <table className="datos mt-1" style={{ maxWidth: 520 }}>
                                <thead>
                                  <tr>
                                    <th>Talla</th>
                                    <th className="num">Trae la caja</th>
                                    <th className="num">Debería traer</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.desajusteCorrida.map((d) => (
                                    <tr key={d.talla}>
                                      <td>{d.talla}</td>
                                      <td className="num cifra">{d.enCorrida}</td>
                                      <td
                                        className="num cifra"
                                        style={{
                                          color:
                                            d.segunDemanda > d.enCorrida
                                              ? "var(--estado-critico)"
                                              : "var(--ink-2)",
                                        }}
                                      >
                                        {d.segunDemanda}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                                Esto es lo que hay que negociar con la fábrica antes de confirmar:
                                la caja llega como venga y las tallas de más se quedan paradas.
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {!visibles.length ? (
        <p className="p-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
          Nada que pedir con estos filtros.
        </p>
      ) : null}
    </section>
  );
}
