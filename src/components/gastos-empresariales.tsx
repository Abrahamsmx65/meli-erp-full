"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepararIntentoGasto, type IntentoGastoPendiente } from "@/lib/servicios/gastos-idempotencia";
import type { GastoEmpresarial } from "@/lib/servicios/gastos-empresariales";

const VACIO = { id: 0, fecha: "", concepto: "", categoria: "Nómina", monto: "" };
const categorias = ["Nómina", "Bodega", "Servicios", "Administración"];
const entrada = "mt-1 w-full rounded-lg border px-2 py-1.5 text-sm";
const estiloEntrada = { borderColor: "var(--borde)", background: "var(--surface-2)" };

export function GastosEmpresariales({ gastos, periodo }: { gastos: GastoEmpresarial[]; periodo: string }) {
  const router = useRouter();
  const [anio, mes] = periodo.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const desde = `${periodo}-01`;
  const hasta = `${periodo}-${String(ultimoDia).padStart(2, "0")}`;
  const [form, setForm] = useState({ ...VACIO, fecha: `${periodo}-01` });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const intentoPendiente = useRef<IntentoGastoPendiente | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError("");
    try {
      const datos = { ...form, monto: Number(form.monto) };
      const cuerpo = JSON.stringify(datos);
      if (!form.id) intentoPendiente.current = prepararIntentoGasto(intentoPendiente.current, cuerpo);
      const r = await fetch("/api/cortes/general/gastos", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...datos,
          ...(!form.id ? { claveIdempotencia: intentoPendiente.current?.clave } : {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar el gasto.");
      intentoPendiente.current = null;
      setForm({ ...VACIO, fecha: `${periodo}-01` });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function borrar(id: number) {
    if (!window.confirm("¿Eliminar este gasto empresarial?")) return;
    setOcupado(true);
    setError("");
    try {
      const r = await fetch("/api/cortes/general/gastos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo eliminar el gasto.");
      if (form.id === id) setForm({ ...VACIO, fecha: `${periodo}-01` });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b p-4 hairline">
        <h2 className="text-base font-semibold">Gastos empresariales</h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>Nómina, bodegas y otros gastos del negocio. Se descuentan una sola vez, solo de la utilidad general.</p>
      </header>
      <form onSubmit={guardar} className="grid gap-3 border-b p-4 hairline md:grid-cols-5">
        <label className="text-xs">Fecha<input className={entrada} style={estiloEntrada} type="date" required min={desde} max={hasta} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></label>
        <label className="text-xs md:col-span-2">Concepto<input className={entrada} style={estiloEntrada} required maxLength={200} value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} placeholder="Ej. Nómina primera quincena" /></label>
        <label className="text-xs">Categoría<input className={entrada} style={estiloEntrada} required list="categorias-empresariales" maxLength={80} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} /><datalist id="categorias-empresariales">{categorias.map((x) => <option key={x} value={x} />)}</datalist></label>
        <label className="text-xs">Monto<input className={entrada} style={estiloEntrada} type="number" required min="0.01" step="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} /></label>
        <div className="flex gap-2 md:col-span-5">
          <button className="boton boton-primario" disabled={ocupado}>{ocupado ? "Guardando…" : form.id ? "Guardar cambios" : "Añadir gasto"}</button>
          {form.id ? <button type="button" className="boton boton-fantasma" onClick={() => setForm({ ...VACIO, fecha: `${periodo}-01` })}>Cancelar</button> : null}
        </div>
        {error ? <p className="text-sm md:col-span-5" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
      </form>
      {gastos.length ? (
        <div className="overflow-x-auto"><table className="datos"><thead><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th className="num">Monto</th><th></th></tr></thead><tbody>
          {gastos.map((g) => <tr key={g.id}><td className="cifra">{g.fecha}</td><td>{g.categoria}</td><td>{g.concepto}</td><td className="num cifra">${g.monto.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td><td className="num whitespace-nowrap"><button type="button" className="mr-3" style={{ color: "var(--acento)" }} onClick={() => setForm({ ...g, monto: String(g.monto) })}>Editar</button><button type="button" style={{ color: "var(--estado-critico)" }} disabled={ocupado} onClick={() => borrar(g.id)}>Eliminar</button></td></tr>)}
        </tbody></table></div>
      ) : <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>No hay gastos empresariales en este mes.</p>}
    </section>
  );
}