"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepararIntentoGasto, type IntentoGastoPendiente } from "@/lib/servicios/gastos-idempotencia";
import type { GastoEmpresarial } from "@/lib/servicios/gastos-empresariales";
import type { GastoFijo } from "@/lib/servicios/gastos-fijos";

const entrada = "mt-1 w-full rounded-lg border px-2 py-1.5 text-sm";
const estiloEntrada = { borderColor: "var(--borde)", background: "var(--surface-2)" };

function pesos(x: number): string {
  return "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function nombreMes(p: string): string {
  const [a, m] = p.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

async function enviar(url: string, metodo: string, cuerpo: unknown): Promise<void> {
  const r = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
}

function Categorias({ id, categorias }: { id: string; categorias: readonly string[] }) {
  return <datalist id={id}>{categorias.map((x) => <option key={x} value={x} />)}</datalist>;
}

/** La plantilla: lo que se paga cada mes. */
export function GastosFijosVista({ fijos, mesActual, categorias }: { fijos: GastoFijo[]; mesActual: string; categorias: readonly string[] }) {
  const router = useRouter();
  const vacio = { id: 0, concepto: "", categoria: categorias[0], monto: "", desde: mesActual };
  const [form, setForm] = useState(vacio);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const activos = fijos.filter((f) => !f.hasta || f.hasta >= mesActual);
  const dadosDeBaja = fijos.filter((f) => f.hasta && f.hasta < mesActual);
  const totalMensual = activos.reduce((s, f) => s + f.monto, 0);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError("");
    try {
      await enviar("/api/gastos/fijos", form.id ? "PUT" : "POST", { ...form, monto: Number(form.monto) });
      setForm(vacio);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function baja(f: GastoFijo) {
    if (!window.confirm(`¿Dejar de pagar «${f.concepto}» desde ${nombreMes(mesActual)}? Los meses pasados se quedan como están.`)) return;
    setOcupado(true);
    setError("");
    try {
      await enviar("/api/gastos/fijos", "DELETE", { id: f.id, desde: mesActual });
      if (form.id === f.id) setForm(vacio);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="seccion-cabeza">
        <div className="min-w-0">
          <h2 className="seccion-titulo">Gastos fijos</h2>
          <p className="texto-2 mt-0.5 text-[13px]">{activos.length} activos · {pesos(totalMensual)} al mes</p>
        </div>
      </header>
      <form onSubmit={guardar} className="grid gap-3 border-b p-4 hairline md:grid-cols-6">
        <label className="text-xs md:col-span-2">Concepto<input className={entrada} style={estiloEntrada} required maxLength={200} value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} placeholder="Ej. Renta bodega" /></label>
        <label className="text-xs">Categoría<input className={entrada} style={estiloEntrada} required list="categorias-fijos" maxLength={80} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} /><Categorias id="categorias-fijos" categorias={categorias} /></label>
        <label className="text-xs">Monto al mes<input className={entrada} style={estiloEntrada} type="number" required min="0.01" step="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} /></label>
        <label className="text-xs">Desde<input className={entrada} style={estiloEntrada} type="month" required value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} /></label>
        <div className="flex items-end gap-2">
          <button className="boton boton-primario" disabled={ocupado}>{ocupado ? "Guardando…" : form.id ? "Guardar cambios" : "Agregar"}</button>
          {form.id ? <button type="button" className="boton boton-fantasma" onClick={() => setForm(vacio)}>Cancelar</button> : null}
        </div>
        {form.id ? <p className="text-xs texto-tenue md:col-span-6">El cambio aplica desde {nombreMes(mesActual)}; los meses pasados no se tocan.</p> : null}
        {error ? <p className="text-sm md:col-span-6" style={{ color: "var(--critico-texto)" }}>{error}</p> : null}
      </form>
      {activos.length ? (
        <div className="tabla-caja">
          <table className="datos">
            <thead><tr><th>Categoría</th><th>Concepto</th><th>Desde</th><th className="num">Al mes</th><th></th></tr></thead>
            <tbody>
              {activos.map((f) => (
                <tr key={f.id}>
                  <td>{f.categoria}</td>
                  <td>{f.concepto}</td>
                  <td className="cifra">{nombreMes(f.desde)}</td>
                  <td className="num cifra">{pesos(f.monto)}</td>
                  <td className="num whitespace-nowrap">
                    <button type="button" className="boton boton-fantasma boton-chico mr-1" onClick={() => setForm({ id: f.id, concepto: f.concepto, categoria: f.categoria, monto: String(f.monto), desde: f.desde })}>Editar</button>
                    <button type="button" className="boton boton-peligro boton-chico" disabled={ocupado} onClick={() => baja(f)}>Dar de baja</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="p-4 text-sm texto-2">Sin gastos fijos.</p>}
      {dadosDeBaja.length ? (
        <p className="border-t p-4 text-xs texto-tenue hairline">
          Dados de baja: {dadosDeBaja.map((f) => `${f.concepto} (hasta ${nombreMes(f.hasta!)})`).join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

/** Lo de un mes: los fijos (editables u omitibles para ese mes) y los sueltos. */
export function GastosDelMes({ gastos, periodo, categorias }: { gastos: GastoEmpresarial[]; periodo: string; categorias: readonly string[] }) {
  const router = useRouter();
  const [anio, mes] = periodo.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const desde = `${periodo}-01`;
  const hasta = `${periodo}-${String(ultimoDia).padStart(2, "0")}`;
  const vacio = { id: 0, fecha: desde, concepto: "", categoria: categorias[0], monto: "", fijo: false };
  const [form, setForm] = useState(vacio);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const intentoPendiente = useRef<IntentoGastoPendiente | null>(null);
  const hayProrrateo = gastos.some((g) => g.fijoId != null && (g.proporcion ?? 1) < 1);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError("");
    try {
      const datos = { id: form.id, fecha: form.fecha, concepto: form.concepto, categoria: form.categoria, monto: Number(form.monto) };
      if (!form.id) intentoPendiente.current = prepararIntentoGasto(intentoPendiente.current, JSON.stringify(datos));
      await enviar("/api/cortes/general/gastos", form.id ? "PUT" : "POST", {
        ...datos,
        ...(!form.id ? { claveIdempotencia: intentoPendiente.current?.clave } : {}),
      });
      intentoPendiente.current = null;
      setForm(vacio);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function quitar(g: GastoEmpresarial) {
    const pregunta = g.fijoId != null ? `¿Omitir «${g.concepto}» solo en este mes?` : `¿Eliminar «${g.concepto}»?`;
    if (!window.confirm(pregunta)) return;
    setOcupado(true);
    setError("");
    try {
      await enviar("/api/cortes/general/gastos", "DELETE", { id: g.id });
      if (form.id === g.id) setForm(vacio);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="seccion-cabeza">
        <div className="min-w-0">
          <h2 className="seccion-titulo">Gastos de {nombreMes(periodo)}</h2>
        </div>
      </header>
      <form onSubmit={guardar} className="grid gap-3 border-b p-4 hairline md:grid-cols-5">
        <label className="text-xs">Fecha<input className={entrada} style={estiloEntrada} type="date" required disabled={form.fijo} min={desde} max={hasta} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></label>
        <label className="text-xs md:col-span-2">Concepto<input className={entrada} style={estiloEntrada} required maxLength={200} value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} placeholder="Ej. Flete extra contenedor" /></label>
        <label className="text-xs">Categoría<input className={entrada} style={estiloEntrada} required list="categorias-mes" maxLength={80} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} /><Categorias id="categorias-mes" categorias={categorias} /></label>
        <label className="text-xs">Monto<input className={entrada} style={estiloEntrada} type="number" required min="0.01" step="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} /></label>
        <div className="flex gap-2 md:col-span-5">
          <button className="boton boton-primario" disabled={ocupado}>{ocupado ? "Guardando…" : form.id ? (form.fijo ? "Corregir este mes" : "Guardar cambios") : "Agregar gasto suelto"}</button>
          {form.id ? <button type="button" className="boton boton-fantasma" onClick={() => setForm(vacio)}>Cancelar</button> : null}
        </div>
        {error ? <p className="text-sm md:col-span-5" style={{ color: "var(--critico-texto)" }}>{error}</p> : null}
      </form>
      {gastos.length ? (
        <div className="tabla-caja">
          <table className="datos">
            <thead>
              <tr>
                <th>Tipo</th><th>Categoría</th><th>Concepto</th><th className="num">Del mes</th>
                {hayProrrateo ? <th className="num">A hoy</th> : null}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gastos.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap">{g.fijoId != null ? (g.editado ? "Fijo · corregido" : "Fijo") : g.fecha}</td>
                  <td>{g.categoria}</td>
                  <td>{g.concepto}</td>
                  <td className="num cifra">{pesos(g.montoMes ?? g.monto)}</td>
                  {hayProrrateo ? <td className="num cifra">{pesos(g.monto)}</td> : null}
                  <td className="num whitespace-nowrap">
                    <button type="button" className="boton boton-fantasma boton-chico mr-1" onClick={() => setForm({ id: g.id, fecha: g.fecha, concepto: g.concepto, categoria: g.categoria, monto: String(g.montoMes ?? g.monto), fijo: g.fijoId != null })}>Editar</button>
                    <button type="button" className="boton boton-peligro boton-chico" disabled={ocupado} onClick={() => quitar(g)}>{g.fijoId != null ? "Omitir" : "Eliminar"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="p-4 text-sm texto-2">Sin gastos en este mes.</p>}
    </section>
  );
}
