"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MovimientoCuenta, Retiro, Socio } from "@/lib/finanzas/cuenta";

const pesos = (x: number | null | undefined, dec = 2) =>
  x == null || !Number.isFinite(x) ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const entrada = "w-full rounded-lg border px-2 py-1.5 text-sm";
const estiloEntrada = { borderColor: "var(--borde)", background: "var(--surface-2)" };
const hoy = () => new Date().toISOString().slice(0, 10);

async function post(cuerpo: unknown): Promise<void> {
  const r = await fetch("/api/finanzas/cuenta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
}

function useAccion() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const correr = async (fn: () => Promise<void>) => {
    setOcupado(true);
    setError("");
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  };
  return { ocupado, error, correr };
}

const TIPOS: Record<MovimientoCuenta["tipo"], string> = {
  transferencia: "Transferencia",
  ingreso: "Ingreso sin comisión",
  gasto: "Gasto de la cuenta",
};

/** Movimientos de la cuenta con Rafa: alta, lista y borrar. */
export function MovimientosCuenta({ movimientos }: { movimientos: MovimientoCuenta[] }) {
  const { ocupado, error, correr } = useAccion();
  const vacio = { fecha: hoy(), tipo: "transferencia", monto: "", beneficiario: "", referencia: "", notas: "" };
  const [form, setForm] = useState(vacio);
  const [busca, setBusca] = useState("");
  const visibles = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return q
      ? movimientos.filter((m) => [m.beneficiario, m.referencia, m.notas, m.fecha].some((x) => (x ?? "").toUpperCase().includes(q)))
      : movimientos;
  }, [movimientos, busca]);
  const comisionPrevia = form.tipo === "transferencia" && Number(form.monto) > 0 ? (Number(form.monto) * 2) / 116 : 0;

  return (
    <div className="flex flex-col gap-3">
      <form
        className="grid grid-cols-2 gap-2 md:grid-cols-7"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await correr(() => post({ accion: "movimiento", ...form, monto: Number(form.monto) }))) setForm(vacio);
        }}
      >
        <input className={entrada} style={estiloEntrada} type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
        <select className={entrada} style={estiloEntrada} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
          {Object.entries(TIPOS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input className={entrada} style={estiloEntrada} inputMode="decimal" placeholder="Monto" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
        <input className={entrada} style={estiloEntrada} placeholder="Beneficiario (RAFA.VANTORIX)" value={form.beneficiario} onChange={(e) => setForm({ ...form, beneficiario: e.target.value })} />
        <input className={entrada} style={estiloEntrada} placeholder="Referencia" value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} />
        <input className={entrada} style={estiloEntrada} placeholder="Notas" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
        <button className="boton boton-primario boton-chico" disabled={ocupado || !Number(form.monto)}>
          Agregar{comisionPrevia ? ` (comisión ${pesos(comisionPrevia)})` : ""}
        </button>
      </form>
      {error ? <p className="text-[13px]" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
      <div className="flex items-center gap-3">
        <input className="rounded-lg border px-2 py-1.5 text-sm" style={estiloEntrada} placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="texto-tenue text-[13px]">{visibles.length} movimientos</span>
      </div>
      <div className="tabla-caja alta">
        <table className="datos">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Beneficiario</th>
              <th>Referencia</th>
              <th className="num">Monto</th>
              <th className="num">Comisión</th>
              <th>Notas</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibles.map((m) => (
              <tr key={m.id}>
                <td className="cifra">{m.fecha ?? "—"}</td>
                <td className="texto-2 text-[12px]">{TIPOS[m.tipo]}</td>
                <td>{m.beneficiario ?? "—"}</td>
                <td className="texto-2">{m.referencia ?? ""}</td>
                <td className="num cifra">{pesos(m.monto)}</td>
                <td className="num cifra">{m.comision ? pesos(m.comision) : "—"}</td>
                <td className="texto-tenue text-[12px]">{m.notas ?? ""}</td>
                <td>
                  <button
                    className="boton boton-fantasma boton-chico"
                    disabled={ocupado}
                    onClick={() => window.confirm("¿Borrar este movimiento?") && correr(() => post({ accion: "borrar-movimiento", id: m.id }))}
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Retiros de un socio: se apuntan, no son gasto del negocio. */
export function RetirosSocios({ socios, retiros }: { socios: Socio[]; retiros: Retiro[] }) {
  const { ocupado, error, correr } = useAccion();
  const [socioId, setSocioId] = useState(socios[0]?.id ?? 0);
  const vacio = { fecha: hoy(), concepto: "", monto: "" };
  const [form, setForm] = useState(vacio);
  const suyos = retiros.filter((r) => r.socioId === socioId);
  const total = suyos.reduce((s, r) => s + r.monto, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {socios.map((s) => (
          <button
            key={s.id}
            className={`boton boton-chico ${s.id === socioId ? "boton-primario" : "boton-fantasma"}`}
            onClick={() => setSocioId(s.id)}
          >
            {s.nombre} · {s.porcentaje}%
          </button>
        ))}
        <span className="texto-2 ml-auto text-[13px]">
          {suyos.length} retiros · {pesos(total)}
        </span>
      </div>
      <form
        className="grid grid-cols-2 gap-2 md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await correr(() => post({ accion: "retiro", socioId, ...form, monto: Number(form.monto) }))) setForm(vacio);
        }}
      >
        <input className={entrada} style={estiloEntrada} type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
        <input className={entrada} style={estiloEntrada} placeholder="Concepto" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} />
        <input
          className={entrada}
          style={estiloEntrada}
          inputMode="decimal"
          placeholder="Monto (negativo si pagó algo del negocio)"
          value={form.monto}
          onChange={(e) => setForm({ ...form, monto: e.target.value })}
        />
        <button className="boton boton-primario boton-chico" disabled={ocupado || !Number(form.monto) || !form.concepto.trim()}>
          Agregar retiro
        </button>
      </form>
      {error ? <p className="text-[13px]" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
      <div className="tabla-caja alta">
        <table className="datos">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th className="num">Monto</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {suyos.map((r) => (
              <tr key={r.id}>
                <td className="cifra">{r.fecha ?? "—"}</td>
                <td>{r.concepto}</td>
                <td className="num cifra" style={{ color: r.monto < 0 ? "var(--exito-texto)" : undefined }}>{pesos(r.monto)}</td>
                <td>
                  <button
                    className="boton boton-fantasma boton-chico"
                    disabled={ocupado}
                    onClick={() => window.confirm("¿Borrar este retiro?") && correr(() => post({ accion: "borrar-retiro", id: r.id }))}
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
