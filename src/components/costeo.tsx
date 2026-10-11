"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContenedorVista, CostoModeloVista } from "@/lib/servicios/costeo";

function pesos(x: number | null | undefined, dec = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return "$" + x.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function usd(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return "US$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const tc = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(4));

const entrada = "w-full rounded-lg border px-2 py-1.5 text-sm";
const estiloEntrada = { borderColor: "var(--borde)", background: "var(--surface-2)" };

async function post(cuerpo: unknown): Promise<any> {
  const r = await fetch("/api/finanzas/costeo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "No se pudo.");
  return j;
}

/** Botones de arriba: recalcular y subir el Excel de costeo. */
export function AccionesCosteo() {
  const router = useRouter();
  const archivo = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState("");

  async function refrescar() {
    setOcupado("refrescar");
    setMensaje("");
    try {
      const r = await post({ accion: "refrescar" });
      setMensaje(`Listo: ${r.costeados} contenedores costeados.`);
      router.refresh();
    } catch (e) {
      setMensaje((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function subir(f: File) {
    setOcupado("subir");
    setMensaje("");
    try {
      const fd = new FormData();
      fd.append("archivo", f);
      const r = await fetch("/api/finanzas/costeo", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer el archivo.");
      setMensaje(`Leí ${j.contenedoresExcel} contenedores del Excel; ${j.costeados} ya cuentan.`);
      router.refresh();
    } catch (e) {
      setMensaje((e as Error).message);
    } finally {
      setOcupado(null);
      if (archivo.current) archivo.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {mensaje ? <span className="texto-2 text-[13px]">{mensaje}</span> : null}
      <input
        ref={archivo}
        type="file"
        accept=".xls,.xlsx"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])}
      />
      <button className="boton boton-fantasma boton-chico" disabled={!!ocupado} onClick={() => archivo.current?.click()}>
        {ocupado === "subir" ? "Leyendo…" : "Subir Excel de costeo"}
      </button>
      <button className="boton boton-primario boton-chico" disabled={!!ocupado} onClick={refrescar}>
        {ocupado === "refrescar" ? "Calculando…" : "Recalcular"}
      </button>
    </div>
  );
}

/** Tabla por modelo con el costo real, el del último contenedor y el que usan hoy los cortes. */
export function CostosPorModelo({ modelos }: { modelos: CostoModeloVista[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [soloDistintos, setSoloDistintos] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState("");

  const diferencia = (m: CostoModeloVista) =>
    m.real != null && m.costoActual != null && m.costoActual > 0 ? (m.real - m.costoActual) / m.costoActual : null;
  const distinto = (m: CostoModeloVista) => {
    const d = diferencia(m);
    return m.real != null && (d == null || Math.abs(d) >= 0.01);
  };

  const visibles = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return modelos.filter(
      (m) => (!q || m.modelo.includes(q.replace(/\s/g, "")) || (m.categoria ?? "").toUpperCase().includes(q)) && (!soloDistintos || distinto(m)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelos, busca, soloDistintos]);
  const porAplicar = modelos.filter(distinto);

  async function aplicar(lista: string[] | null) {
    const n = lista ? lista.length : porAplicar.length;
    if (!window.confirm(`¿Usar el costo real en Catálogo y costos para ${n} modelo${n === 1 ? "" : "s"}? Los cortes que se recalculen desde ahora lo usarán.`)) return;
    setOcupado(lista?.[0] ?? "todos");
    setError("");
    try {
      await post({ accion: "aplicar", modelos: lista });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input className="rounded-lg border px-2 py-1.5 text-sm" style={estiloEntrada} placeholder="Buscar modelo o categoría" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="texto-2 flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={soloDistintos} onChange={(e) => setSoloDistintos(e.target.checked)} />
          Solo los que no cuadran con el catálogo
        </label>
        <span className="texto-tenue text-[13px]">{visibles.length} modelos</span>
        {porAplicar.length ? (
          <button className="boton boton-primario boton-chico ml-auto" disabled={!!ocupado} onClick={() => aplicar(null)}>
            {ocupado === "todos" ? "Guardando…" : `Usar costo real en ${porAplicar.length} modelos`}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-[13px]" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
      <div className="tabla-caja alta">
        <table className="datos">
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Categoría</th>
              <th className="num">Existencias</th>
              <th className="num">Costo real</th>
              <th>Sale de</th>
              <th className="num">Último contenedor</th>
              <th className="num">En catálogo hoy</th>
              <th className="num">Diferencia</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibles.map((m) => {
              const d = diferencia(m);
              return (
                <tr key={m.modelo}>
                  <td className="font-medium">{m.modelo}</td>
                  <td className="texto-2">{m.categoria ?? "—"}</td>
                  <td className="num cifra">
                    {m.existencias == null ? "—" : m.existencias.toLocaleString("es-MX")}
                    {m.sinCubrir > 0 ? (
                      <div className="texto-tenue text-[11px]" title="Pares que llegaron en contenedores sin costear">
                        {m.sinCubrir.toLocaleString("es-MX")} sin costear
                      </div>
                    ) : null}
                  </td>
                  <td className="num cifra font-semibold">{pesos(m.real)}</td>
                  <td className="texto-2 text-[12px]">
                    {m.tomas.map((t) => `${t.id} (${t.pares.toLocaleString("es-MX")} · ${pesos(t.porPar)})`).join(", ") || "—"}
                  </td>
                  <td className="num cifra">
                    {pesos(m.ultimo?.porPar)}
                    <div className="texto-tenue text-[11px]">{m.ultimo?.id ?? ""}</div>
                  </td>
                  <td className="num cifra">{pesos(m.costoActual)}</td>
                  <td
                    className="num cifra"
                    style={{ color: d == null ? undefined : Math.abs(d) < 0.01 ? "var(--exito-texto)" : Math.abs(d) >= 0.1 ? "var(--estado-critico)" : "var(--alerta-texto)" }}
                  >
                    {d == null ? "—" : `${d > 0 ? "+" : ""}${(d * 100).toFixed(1)}%`}
                  </td>
                  <td>
                    {distinto(m) ? (
                      <button className="boton boton-fantasma boton-chico" disabled={!!ocupado} onClick={() => aplicar([m.modelo])}>
                        {ocupado === m.modelo ? "…" : "Usar"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const hoy = () => new Date().toISOString().slice(0, 10);

/** Lo que se captura de un contenedor: factura, flete, aduana, entregado y sus pagos. */
function EditorContenedor({ c, onListo }: { c: ContenedorVista; onListo: () => void }) {
  const [form, setForm] = useState({
    costoUsd: c.costoUsd != null ? String(c.costoUsd) : "",
    fleteUsd: c.fleteUsd != null ? String(c.fleteUsd) : "",
    aduana: c.aduana != null ? String(c.aduana) : "",
    comisionAgente: c.comisionAgente != null ? String(c.comisionAgente) : "",
    entregado: c.entregado,
    fechaEntrega: c.fechaEntrega ?? "",
    notas: c.notas ?? "",
  });
  const [pago, setPago] = useState({ concepto: "fabrica", fecha: hoy(), usd: "", tipoCambio: "" });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function correr(fn: () => Promise<unknown>) {
    setOcupado(true);
    setError("");
    try {
      await fn();
      onListo();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const campo = (k: keyof typeof form, etiqueta: string, tipo = "number") => (
    <label className="texto-2 text-[12px]">
      {etiqueta}
      <input
        className={entrada}
        style={estiloEntrada}
        type={tipo}
        step="any"
        value={String(form[k])}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-4 p-3">
      <form
        className="grid grid-cols-2 gap-3 md:grid-cols-7"
        onSubmit={(e) => {
          e.preventDefault();
          correr(() =>
            post({
              accion: "contenedor",
              contenedor: c.id,
              iso: c.iso,
              costoUsd: form.costoUsd,
              fleteUsd: form.fleteUsd,
              aduana: form.aduana,
              comisionAgente: form.comisionAgente,
              entregado: form.entregado,
              fechaEntrega: form.fechaEntrega,
              notas: form.notas,
            }),
          );
        }}
      >
        {campo("costoUsd", "Factura fábrica (USD)")}
        {campo("fleteUsd", "Flete (USD)")}
        {campo("aduana", "Aduana (MXN)")}
        {campo("comisionAgente", "Comisión agente (MXN)")}
        <label className="texto-2 flex items-end gap-1.5 pb-2 text-[12px]">
          <input type="checkbox" checked={form.entregado} onChange={(e) => setForm({ ...form, entregado: e.target.checked })} />
          Entregado{c.estadoErp === "recibido" ? " (recibido en Contenedores)" : ""}
        </label>
        {campo("fechaEntrega", "Fecha de entrega", "date")}
        <div className="flex items-end">
          <button className="boton boton-primario boton-chico w-full" disabled={ocupado}>
            Guardar
          </button>
        </div>
        <label className="texto-2 col-span-2 text-[12px] md:col-span-7">
          Notas
          <input className={entrada} style={estiloEntrada} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
        </label>
      </form>

      <div>
        <div className="mb-1 text-[13px] font-semibold">Pagos</div>
        <table className="datos">
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Fecha</th>
              <th className="num">USD</th>
              <th className="num">Tipo de cambio</th>
              <th className="num">Pesos</th>
              <th>Notas</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {c.pagos.map((p) => (
              <tr key={p.id}>
                <td>{p.concepto === "fabrica" ? "Fábrica" : "Flete"}</td>
                <td>{p.fecha ?? "—"}</td>
                <td className="num cifra">{usd(p.usd)}</td>
                <td className="num cifra">{tc(p.tipoCambio)}</td>
                <td className="num cifra">{pesos(p.usd * p.tipoCambio)}</td>
                <td className="texto-tenue text-[12px]">{p.notas ?? ""}</td>
                <td>
                  <button
                    className="boton boton-fantasma boton-chico"
                    disabled={ocupado}
                    onClick={() => window.confirm("¿Borrar este pago?") && correr(() => post({ accion: "borrar-pago", id: p.id }))}
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <select className={entrada} style={estiloEntrada} value={pago.concepto} onChange={(e) => setPago({ ...pago, concepto: e.target.value })}>
                  <option value="fabrica">Fábrica</option>
                  <option value="flete">Flete</option>
                </select>
              </td>
              <td>
                <input className={entrada} style={estiloEntrada} type="date" value={pago.fecha} onChange={(e) => setPago({ ...pago, fecha: e.target.value })} />
              </td>
              <td>
                <input className={entrada} style={estiloEntrada} type="number" step="any" placeholder="USD" value={pago.usd} onChange={(e) => setPago({ ...pago, usd: e.target.value })} />
              </td>
              <td>
                <input className={entrada} style={estiloEntrada} type="number" step="any" placeholder="17.25" value={pago.tipoCambio} onChange={(e) => setPago({ ...pago, tipoCambio: e.target.value })} />
              </td>
              <td className="num cifra texto-tenue">
                {Number(pago.usd) > 0 && Number(pago.tipoCambio) > 0 ? pesos(Number(pago.usd) * Number(pago.tipoCambio)) : ""}
              </td>
              <td colSpan={2}>
                <button
                  className="boton boton-primario boton-chico"
                  disabled={ocupado || !(Number(pago.usd) > 0 && Number(pago.tipoCambio) > 0)}
                  onClick={() =>
                    correr(async () => {
                      await post({ accion: "pago", contenedor: c.id, ...pago, usd: Number(pago.usd), tipoCambio: Number(pago.tipoCambio) });
                      setPago({ ...pago, usd: "", tipoCambio: "" });
                    })
                  }
                >
                  Agregar pago
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {c.modelos.length ? (
        <div>
          <div className="mb-1 text-[13px] font-semibold">
            Reparto {c.fuente === "excel" ? "(Excel de costeo)" : "(packing list)"}
          </div>
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th className="num">Pares</th>
                <th className="num">USD/par</th>
                <th className="num">CBM</th>
                <th className="num">Fábrica</th>
                <th className="num">Flete</th>
                <th className="num">Aduana</th>
                <th className="num">Por par</th>
              </tr>
            </thead>
            <tbody>
              {c.modelos.map((m) => (
                <tr key={m.modelo}>
                  <td>{m.modelo}</td>
                  <td className="num cifra">{m.pares.toLocaleString("es-MX")}</td>
                  <td className="num cifra">{m.usdPar == null ? "—" : m.usdPar.toFixed(2)}</td>
                  <td className="num cifra">{m.cbm == null ? "—" : m.cbm.toFixed(2)}</td>
                  <td className="num cifra">{pesos(m.fabricaMxn, 0)}</td>
                  <td className="num cifra">{pesos(m.fleteMxn, 0)}</td>
                  <td className="num cifra">{pesos(m.aduanaMxn, 0)}</td>
                  <td className="num cifra font-semibold">{m.porPar > 0 ? pesos(m.porPar) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {error ? <p className="text-[13px]" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
    </div>
  );
}

/** Lista de contenedores: lo pagado, con qué tipo de cambio y si ya cuenta. */
export function ContenedoresCosteo({ contenedores }: { contenedores: ContenedorVista[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState("");
  const [error, setError] = useState("");

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await post({ accion: "contenedor", contenedor: nuevo });
      setAbierto(nuevo.trim().toUpperCase().slice(0, 4));
      setNuevo("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={agregar}>
        <input className="rounded-lg border px-2 py-1.5 text-sm" style={estiloEntrada} placeholder="S272 o P609" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <button className="boton boton-fantasma boton-chico" disabled={!nuevo.trim()}>
          Agregar contenedor
        </button>
        {error ? <span className="text-[13px]" style={{ color: "var(--estado-critico)" }}>{error}</span> : null}
      </form>
      <div className="tabla-caja alta">
        <table className="datos">
          <thead>
            <tr>
              <th>Contenedor</th>
              <th>Estado</th>
              <th className="num">Factura</th>
              <th className="num">T.C. fábrica</th>
              <th className="num">Flete</th>
              <th className="num">Aduana</th>
              <th className="num" title="Gasto operativo: no entra al costo del par">Agente</th>
              <th className="num">Total MXN</th>
              <th className="num">Pares</th>
              <th className="num">Por par</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {contenedores.map((c) => (
              <Fragment key={c.id}>
                <tr>
                  <td className="font-medium">
                    {c.id}
                    <div className="texto-tenue text-[11px]">
                      {c.negocio === "fundas" ? "Fundas" : ""}
                      {c.negocio === "fundas" && c.iso ? " · " : ""}
                      {c.iso ?? ""}
                    </div>
                  </td>
                  <td className="text-[12px]">
                    <span style={{ color: c.cuenta ? "var(--exito-texto)" : "var(--alerta-texto)" }}>
                      {c.cuenta ? "Cuenta" : c.motivo}
                    </span>
                    {c.avisos.map((a, i) => (
                      <div key={i} className="texto-tenue">{a}</div>
                    ))}
                    {c.notas ? <div className="texto-tenue">{c.notas}</div> : null}
                  </td>
                  <td className="num cifra">
                    {usd(c.costoUsd)}
                    {c.costoUsd != null && c.pagadoUsd < c.costoUsd - 1 ? (
                      <div className="texto-tenue text-[11px]">pagado {usd(c.pagadoUsd)}</div>
                    ) : null}
                  </td>
                  <td className="num cifra">{tc(c.tcFabrica)}</td>
                  <td className="num cifra">
                    {pesos(c.pesosEnvio, 0)}
                    <div className="texto-tenue text-[11px]">{c.fleteUsd != null ? `${usd(c.fleteUsd)} · ${tc(c.tcFlete)}` : ""}</div>
                  </td>
                  <td className="num cifra">{pesos(c.aduana, 0)}</td>
                  <td className="num cifra">{c.comisionAgente ? pesos(c.comisionAgente, 0) : "—"}</td>
                  <td className="num cifra font-semibold">{c.totalMxn > 0 ? pesos(c.totalMxn, 0) : "—"}</td>
                  <td className="num cifra">{c.pares ? c.pares.toLocaleString("es-MX") : "—"}</td>
                  <td className="num cifra">{c.pares && c.pesosCosto ? pesos(c.totalMxn / c.pares) : "—"}</td>
                  <td>
                    <button className="boton boton-fantasma boton-chico" onClick={() => setAbierto(abierto === c.id ? null : c.id)}>
                      {abierto === c.id ? "Cerrar" : "Capturar"}
                    </button>
                  </td>
                </tr>
                {abierto === c.id ? (
                  <tr>
                    <td colSpan={11} style={{ background: "var(--surface-2)" }}>
                      <EditorContenedor c={c} onListo={() => router.refresh()} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
