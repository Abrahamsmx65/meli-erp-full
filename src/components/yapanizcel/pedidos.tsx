"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LineaPedido } from "@/lib/yapanizcel/pedidos";
import type { PedidoResumen } from "@/lib/yapanizcel/pedidos";
import { claveCanonica, desglosar } from "@/lib/yapanizcel/sku";
import { estiloInput } from "./comunes";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

const btn = "rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60";

/**
 * Cargar un pedido: se sube el Excel, se muestra TODO lo que entraría y hasta
 * que se confirma se guarda. También se puede capturar a mano, línea por línea.
 */
export function CargarPedido({ sugerencia }: { sugerencia?: { diseno: string; lineas: LineaPedido[] } }) {
  const router = useRouter();
  const [lineas, setLineas] = useState<LineaPedido[]>(sugerencia?.lineas ?? []);
  const [folio, setFolio] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [fechaPedido, setFechaPedido] = useState("");
  const [fechaEstimada, setFechaEstimada] = useState("");
  const [estado, setEstado] = useState<"creado" | "en_camino">("creado");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ skuBodega: "", cantidad: "", costo: "" });

  /**
   * Vuelve a amarrar contra MELI los SKUs dados (los que se corrigieron a
   * mano o los que llegaron sin amarre calculado) y repinta los renglones.
   * Un SKU que no amarra queda en rojo: se guardaría, pero no contaría como
   * en camino.
   */
  const reamarrar = useCallback(async (skus: string[]) => {
    const unicos = [...new Set(skus.filter(Boolean))];
    if (!unicos.length) return;
    try {
      const r = await fetch("/api/yapanizcel/pedidos/amarrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: unicos }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return;
      const amarres = (j.amarres ?? {}) as Record<string, string | null>;
      setLineas((ls) => ls.map((l) => (l.skuBodega in amarres ? { ...l, skuMeli: amarres[l.skuBodega] } : l)));
    } catch {
      // Sin red no se repinta; el aviso de la lectura sigue valiendo.
    }
  }, []);

  // Lo que llega sin amarre calculado (la sugerencia de Pedidos a China, una
  // línea capturada a mano) se amarra al aparecer.
  useEffect(() => {
    const pendientes = lineas.filter((l) => l.skuMeli === undefined).map((l) => l.skuBodega);
    if (pendientes.length) void reamarrar(pendientes);
  }, [lineas, reamarrar]);

  /** Al salir de la celda del SKU: se canoniza, se desglosa y se vuelve a amarrar. */
  function corregirSku(i: number, crudo: string) {
    const sku = claveCanonica(crudo);
    setLineas((ls) => {
      const actual = ls[i];
      if (!actual) return ls;
      if (sku === actual.skuBodega) return ls;
      if (!sku) return ls;
      const d = desglosar(sku);
      return ls.map((l, k) => (k === i ? { ...l, skuBodega: sku, diseno: d.diseno, modelo: d.modelo, color: d.color, skuMeli: undefined } : l));
    });
  }

  async function leerArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setOcupado("leer");
    setError(null);
    setAviso(null);
    try {
      const datos = new FormData();
      datos.append("archivo", archivo);
      const r = await fetch("/api/yapanizcel/pedidos/leer", { method: "POST", body: datos });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer el archivo.");
      setLineas(j.lineas);
      setAvisos(j.avisos ?? []);
      if (j.folio && !folio) setFolio(j.folio);
      if (j.fechaPedido && !fechaPedido) setFechaPedido(j.fechaPedido);
      setAviso(`Se leyeron ${j.lineas.length} líneas, ${n(j.unidades)} unidades. Revisa y confirma.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(null);
      e.target.value = "";
    }
  }

  function agregarLinea() {
    const sku = nuevo.skuBodega.trim().toUpperCase();
    const cantidad = Math.round(Number(nuevo.cantidad));
    if (!sku || !Number.isFinite(cantidad) || cantidad <= 0) return;
    const d = desglosar(sku);
    setLineas((ls) => [
      ...ls.filter((l) => l.skuBodega !== sku),
      { skuBodega: sku, diseno: d.diseno, modelo: d.modelo, color: d.color, cantidad, costoUnitario: nuevo.costo ? Number(nuevo.costo) : null, skuMeli: undefined },
    ]);
    setNuevo({ skuBodega: "", cantidad: "", costo: "" });
  }

  async function confirmar() {
    setOcupado("guardar");
    setError(null);
    setAviso(null);
    try {
      const r = await fetch("/api/yapanizcel/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folio, proveedor, fechaPedido, fechaEstimada, estado, lineas }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      setAviso(`Pedido ${folio.toUpperCase()} guardado.`);
      setLineas([]);
      setFolio("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const unidades = lineas.reduce((a, l) => a + l.cantidad, 0);
  const costo = lineas.reduce((a, l) => a + l.cantidad * (l.costoUnitario ?? 0), 0);
  const sinAmarre = lineas.filter((l) => l.skuMeli === null);
  const estiloRojo = { background: "color-mix(in oklab, var(--estado-critico) 12%, transparent)", color: "var(--estado-critico)" };

  return (
    <div className="tarjeta flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Excel del pedido</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={leerArchivo} disabled={ocupado !== null} className="text-xs" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Folio</span>
          <input value={folio} onChange={(e) => setFolio(e.target.value)} className="w-32 rounded-lg border px-2 py-1 text-xs" style={estiloInput} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Proveedor</span>
          <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="w-32 rounded-lg border px-2 py-1 text-xs" style={estiloInput} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Fecha del pedido</span>
          <input type="date" value={fechaPedido} onChange={(e) => setFechaPedido(e.target.value)} className="rounded-lg border px-2 py-1 text-xs" style={estiloInput} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Llegada estimada</span>
          <input type="date" value={fechaEstimada} onChange={(e) => setFechaEstimada(e.target.value)} className="rounded-lg border px-2 py-1 text-xs" style={estiloInput} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value as never)} className="rounded-lg border px-2 py-1 text-xs" style={estiloInput}>
            <option value="creado">Pedido (aún no sale)</option>
            <option value="en_camino">Ya en camino</option>
          </select>
        </label>
      </div>

      {avisos.length ? (
        <ul className="list-disc pl-5 text-xs" style={{ color: "var(--estado-serio)" }}>
          {avisos.slice(0, 20).map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
              <th className="px-2 py-1">SKU de bodega</th>
              <th className="px-2 py-1">SKU en MELI</th>
              <th className="px-2 py-1">Diseño</th>
              <th className="px-2 py-1">Modelo</th>
              <th className="px-2 py-1">Color</th>
              <th className="px-2 py-1 text-right">Cantidad</th>
              <th className="px-2 py-1 text-right">Costo unit.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i} className="border-t" style={{ borderColor: "var(--grid)", ...(l.skuMeli === null ? estiloRojo : {}) }}>
                <td className="px-2 py-1">
                  <input
                    key={l.skuBodega}
                    defaultValue={l.skuBodega}
                    onBlur={(e) => corregirSku(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    title={l.skuMeli === null ? "No amarra con ningún SKU de MELI: corrígelo aquí" : undefined}
                    className="num w-48 rounded-md border px-2 py-0.5 text-xs"
                    style={{ ...estiloInput, ...(l.skuMeli === null ? { borderColor: "var(--estado-critico)", color: "var(--estado-critico)" } : {}) }}
                  />
                </td>
                <td className="num px-2 py-1 text-xs">
                  {l.skuMeli === undefined ? <span style={{ color: "var(--ink-muted)" }}>…</span> : l.skuMeli === null ? <b>sin amarre</b> : l.skuMeli}
                </td>
                <td className="px-2 py-1">{l.diseno}</td>
                <td className="px-2 py-1">{l.modelo}</td>
                <td className="px-2 py-1">{l.color}</td>
                <td className="px-2 py-1 text-right">
                  <input type="number" min={0} value={l.cantidad} onChange={(e) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, cantidad: Math.max(0, Math.round(Number(e.target.value))) } : x)))} className="num w-20 rounded-md border px-2 py-0.5 text-right text-xs" style={estiloInput} />
                </td>
                <td className="px-2 py-1 text-right">
                  <input type="number" min={0} step="0.01" value={l.costoUnitario ?? ""} onChange={(e) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, costoUnitario: e.target.value === "" ? null : Number(e.target.value) } : x)))} className="num w-20 rounded-md border px-2 py-0.5 text-right text-xs" style={estiloInput} />
                </td>
                <td className="px-2 py-1 text-right">
                  <button onClick={() => setLineas((ls) => ls.filter((_, k) => k !== i))} className="text-xs underline" style={{ color: "var(--ink-muted)" }}>
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
            <tr className="border-t" style={{ borderColor: "var(--grid)" }}>
              <td className="px-2 py-1" colSpan={5}>
                <input value={nuevo.skuBodega} onChange={(e) => setNuevo((v) => ({ ...v, skuBodega: e.target.value }))} placeholder="SKU de bodega (DISEÑO-MODELO-COLOR)" className="num w-72 rounded-md border px-2 py-0.5 text-xs" style={estiloInput} />
              </td>
              <td className="px-2 py-1 text-right">
                <input type="number" min={1} value={nuevo.cantidad} onChange={(e) => setNuevo((v) => ({ ...v, cantidad: e.target.value }))} placeholder="Cant." className="num w-20 rounded-md border px-2 py-0.5 text-right text-xs" style={estiloInput} />
              </td>
              <td className="px-2 py-1 text-right">
                <input type="number" min={0} step="0.01" value={nuevo.costo} onChange={(e) => setNuevo((v) => ({ ...v, costo: e.target.value }))} placeholder="Costo" className="num w-20 rounded-md border px-2 py-0.5 text-right text-xs" style={estiloInput} />
              </td>
              <td className="px-2 py-1 text-right">
                <button onClick={agregarLinea} className="text-xs font-semibold underline" style={{ color: "var(--acento)" }}>
                  Agregar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm" style={{ color: "var(--ink-2)" }}>
          {lineas.length} líneas · <b>{n(unidades)}</b> unidades{costo > 0 ? ` · costo ${costo.toLocaleString("es-MX", { maximumFractionDigits: 2 })}` : ""}
        </span>
        {sinAmarre.length ? (
          <span className="text-sm font-semibold" style={{ color: "var(--estado-critico)" }}>
            {sinAmarre.length} en rojo sin amarre ({n(sinAmarre.reduce((a, l) => a + l.cantidad, 0))} unidades no contarán como en camino)
          </span>
        ) : null}
        <button onClick={confirmar} disabled={ocupado !== null || !lineas.length || !folio.trim()} className={`${btn} ml-auto`} style={{ background: "var(--acento)", color: "#fff" }}>
          {ocupado === "guardar" ? "Guardando…" : "Confirmar y guardar pedido"}
        </button>
      </div>
      {aviso ? (
        <p className="text-sm" style={{ color: "var(--exito-texto)" }}>
          {aviso}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

const ESTADO: Record<string, string> = { creado: "Pedido", en_camino: "En camino", recibido: "Recibido", cancelado: "Cancelado" };

export function ListaPedidos({ pedidos }: { pedidos: PedidoResumen[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cambiar(id: string, estado: string) {
    setOcupado(id);
    setError(null);
    try {
      const r = await fetch("/api/yapanizcel/pedidos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, estado }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo cambiar.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function borrar(id: string, folio: string) {
    if (!confirm(`¿Borrar el pedido ${folio}? Sus líneas dejan de contar como en camino.`)) return;
    setOcupado(id);
    try {
      const r = await fetch(`/api/yapanizcel/pedidos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo borrar.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="tarjeta overflow-x-auto">
      {error ? (
        <p className="p-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
            <th className="px-3 py-2">Folio</th>
            <th className="px-3 py-2">Proveedor</th>
            <th className="px-3 py-2">Pedido</th>
            <th className="px-3 py-2">Llega</th>
            <th className="px-3 py-2">Diseños</th>
            <th className="px-3 py-2 text-right">Líneas</th>
            <th className="px-3 py-2 text-right">Unidades</th>
            <th className="px-3 py-2">Estado</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {pedidos.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-3 py-4 text-center" style={{ color: "var(--ink-muted)" }}>
                Todavía no hay pedidos cargados.
              </td>
            </tr>
          ) : null}
          {pedidos.map((p) => (
            <tr key={p.id} className="border-t" style={{ borderColor: "var(--grid)" }}>
              <td className="num px-3 py-1.5 font-medium">{p.folio}</td>
              <td className="px-3 py-1.5">{p.proveedor ?? "—"}</td>
              <td className="num px-3 py-1.5">{p.fecha_pedido ?? p.creado_en.slice(0, 10)}</td>
              <td className="num px-3 py-1.5">{p.fecha_estimada ?? "—"}</td>
              <td className="px-3 py-1.5 text-xs" style={{ color: "var(--ink-2)" }}>
                {p.disenos.join(", ")}
              </td>
              <td className="num px-3 py-1.5 text-right">{p.lineas}</td>
              <td className="num px-3 py-1.5 text-right">{n(p.unidades)}</td>
              <td className="px-3 py-1.5">{ESTADO[p.estado] ?? p.estado}</td>
              <td className="px-3 py-1.5 text-right whitespace-nowrap text-xs">
                {p.estado === "creado" ? (
                  <button disabled={ocupado !== null} onClick={() => cambiar(p.id, "en_camino")} className="underline">
                    Ya salió
                  </button>
                ) : null}
                {p.estado === "en_camino" ? (
                  <button disabled={ocupado !== null} onClick={() => cambiar(p.id, "recibido")} className="underline">
                    Ya llegó
                  </button>
                ) : null}
                {p.estado !== "recibido" && p.estado !== "cancelado" ? (
                  <button disabled={ocupado !== null} onClick={() => cambiar(p.id, "cancelado")} className="ml-2 underline" style={{ color: "var(--ink-muted)" }}>
                    Cancelar
                  </button>
                ) : null}
                <button disabled={ocupado !== null} onClick={() => borrar(p.id, p.folio)} className="ml-2 underline" style={{ color: "var(--estado-critico)" }}>
                  Borrar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
