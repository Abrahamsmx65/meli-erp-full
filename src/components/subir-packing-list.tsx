"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface LineaCasada {
  filas: number[];
  pedidoArchivo: string | null;
  pedidoErp: string | null;
  modelo: string;
  color: string;
  talla: string | null;
  cajas: number;
  pares: number;
  pedidoLineaId: string | null;
  cajasPedido: number;
  enOtros: number;
  enEste: number;
  cajasAsignar: number;
  estado: "ok" | "recorte" | "sin_pedido" | "sin_renglon" | "sin_espacio";
  detalle: string | null;
}

interface Casado {
  numero: string;
  contenedorExistente: boolean;
  lineas: LineaCasada[];
  totales: {
    cajasArchivo: number;
    cajasAsignar: number;
    renglonesOk: number;
    renglonesConProblema: number;
  };
  avisos: string[];
}

interface Packing {
  contenedor: string | null;
  sello: string | null;
  referencia: string | null;
  pedidos: string[];
  totales: { cajas: number; pares: number };
}

const ETIQUETA: Record<LineaCasada["estado"], { texto: string; color: string }> = {
  ok: { texto: "Listo", color: "var(--exito-texto)" },
  recorte: { texto: "Recortado", color: "var(--estado-alerta)" },
  sin_pedido: { texto: "Pedido sin cargar", color: "var(--estado-critico)" },
  sin_renglon: { texto: "No está en el pedido", color: "var(--estado-critico)" },
  sin_espacio: { texto: "Ya embarcado", color: "var(--estado-critico)" },
};

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Sube el packing list de la fábrica y de ahí sale el contenedor completo:
 * número, pedidos y cajas por renglón. Primero se enseña cómo quedó el amarre
 * con los pedidos cargados; nada se guarda hasta confirmar.
 */
export function SubirPackingList() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [packing, setPacking] = useState<Packing | null>(null);
  const [casado, setCasado] = useState<Casado | null>(null);
  const [form, setForm] = useState({
    numero: "",
    numeroNaviera: "",
    naviera: "",
    fechaSalida: "",
    fechaLlegadaEst: "",
    estado: "en_transito",
  });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  async function mandar(f: File, accion: "previsualizar" | "confirmar", numero?: string) {
    const fd = new FormData();
    fd.append("archivo", f);
    fd.append("accion", accion);
    if (numero) fd.append("numero", numero);
    if (accion === "confirmar") {
      for (const [k, v] of Object.entries(form)) if (v) fd.append(k, v);
    }
    const r = await fetch("/api/contenedores/packing-list", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "No se pudo procesar el packing list.");
    return j;
  }

  async function previsualizar(f: File, numero?: string) {
    setCargando(true);
    setError(null);
    setExito(null);
    try {
      const j = await mandar(f, "previsualizar", numero);
      setArchivo(f);
      setPacking(j.packing);
      setCasado(j.casado);
      setForm((prev) => ({
        ...prev,
        numero: j.casado.numero || prev.numero,
        numeroNaviera: prev.numeroNaviera || j.packing.contenedor || "",
      }));
    } catch (e) {
      setError((e as Error).message);
      setPacking(null);
      setCasado(null);
    } finally {
      setCargando(false);
    }
  }

  async function confirmar() {
    if (!archivo) return;
    setCargando(true);
    setError(null);
    try {
      const j = await mandar(archivo, "confirmar", form.numero);
      const avisos = Array.isArray(j.recortes) && j.recortes.length ? ` Recortes: ${j.recortes.join(" ")}` : "";
      setExito(
        `Contenedor ${j.numero} ${j.existia ? "actualizado" : "creado"}: ${j.renglones} renglones y ${n(j.cajas)} cajas` +
          (j.omitidos ? ` (${j.omitidos} renglones del archivo no se pudieron amarrar).` : ".") +
          avisos,
      );
      cancelar();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  function cancelar() {
    setPacking(null);
    setCasado(null);
    setArchivo(null);
    setForm({ numero: "", numeroNaviera: "", naviera: "", fechaSalida: "", fechaLlegadaEst: "", estado: "en_transito" });
    if (input.current) input.current.value = "";
  }

  const puedeConfirmar =
    Boolean(casado && form.numero.trim() && casado.totales.cajasAsignar > 0) && !cargando;

  return (
    <section className="tarjeta p-4">
      <h2 className="font-semibold">Subir un packing list</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
        Sube el packing list de la fábrica tal como te llega. De ahí salen el número
        de contenedor, los pedidos y las cajas de cada modelo y color; el ERP los
        amarra con los pedidos ya cargados y te enseña cómo quedó antes de guardar.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          accept=".xls,.xlsx"
          disabled={cargando}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) previsualizar(f);
          }}
          className="text-sm"
        />
        {cargando && !casado ? (
          <span className="text-sm" style={{ color: "var(--ink-2)" }}>
            Leyendo el archivo…
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
      {exito ? (
        <p className="mt-3 text-sm" style={{ color: "var(--exito-texto)" }}>
          {exito}
        </p>
      ) : null}

      {packing && casado ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          style={{ background: "rgba(0,0,0,.45)" }}
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar el packing list"
        >
          <div className="tarjeta my-8 w-full max-w-5xl p-5" style={{ background: "var(--surface-1)" }}>
            <h3 className="text-lg font-semibold">Esto es lo que va a entrar al contenedor</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
              Archivo {archivo?.name}
              {packing.referencia ? ` · embarque ${packing.referencia}` : ""}
              {packing.sello ? ` · sello ${packing.sello}` : ""} · pedidos{" "}
              {packing.pedidos.length ? packing.pedidos.join(", ") : "sin número en el archivo"}
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Campo etiqueta="Nuestro ID del contenedor">
                <input
                  value={form.numero}
                  onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value.toUpperCase() }))}
                  onBlur={() => {
                    if (archivo && form.numero.trim() && form.numero.trim() !== casado.numero) {
                      previsualizar(archivo, form.numero.trim());
                    }
                  }}
                  placeholder="MIEU3920536 o C-2026-01"
                  className="w-full rounded-lg border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                />
              </Campo>
              <Campo etiqueta="Núm. de la naviera">
                <input
                  value={form.numeroNaviera}
                  onChange={(e) => setForm((f) => ({ ...f, numeroNaviera: e.target.value.toUpperCase() }))}
                  className="w-full rounded-lg border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                />
              </Campo>
              <Campo etiqueta="Naviera (opcional)">
                <input
                  value={form.naviera}
                  onChange={(e) => setForm((f) => ({ ...f, naviera: e.target.value }))}
                  className="w-full rounded-lg border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                />
              </Campo>
              <Campo etiqueta="Estado">
                <select
                  value={form.estado}
                  onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value }))}
                  className="w-full rounded-lg border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                >
                  <option value="en_transito">En tránsito</option>
                  <option value="en_aduana">En aduana</option>
                  <option value="recibido">Recibido</option>
                </select>
              </Campo>
              <Campo etiqueta="Salida">
                <input
                  type="date"
                  value={form.fechaSalida}
                  onChange={(e) => setForm((f) => ({ ...f, fechaSalida: e.target.value }))}
                  className="w-full rounded-lg border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                />
              </Campo>
              <Campo etiqueta="Llegada estimada">
                <input
                  type="date"
                  value={form.fechaLlegadaEst}
                  onChange={(e) => setForm((f) => ({ ...f, fechaLlegadaEst: e.target.value }))}
                  className="w-full rounded-lg border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                />
              </Campo>
            </div>

            {casado.contenedorExistente ? (
              <p
                className="mt-3 rounded-lg p-3 text-sm"
                style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
              >
                El contenedor <strong>{casado.numero}</strong> ya existe: se le agregan estos
                renglones y los que ya traía del mismo pedido se dejan como dice el archivo.
              </p>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Dato titulo="Cajas en el archivo" valor={n(casado.totales.cajasArchivo)} />
              <Dato titulo="Cajas que entran" valor={n(casado.totales.cajasAsignar)} />
              <Dato titulo="Renglones listos" valor={String(casado.totales.renglonesOk)} />
              <Dato
                titulo="Con problema"
                valor={String(casado.totales.renglonesConProblema)}
                color={casado.totales.renglonesConProblema ? "var(--estado-critico)" : undefined}
              />
            </div>

            {casado.avisos.length ? (
              <ul
                className="mt-3 flex flex-col gap-1 rounded-lg p-3 text-sm"
                style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
              >
                {casado.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3 max-h-96 overflow-auto">
              <table className="datos">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Modelo</th>
                    <th>Color</th>
                    <th>Talla</th>
                    <th className="num">Cajas archivo</th>
                    <th className="num">Del pedido</th>
                    <th className="num">En otros</th>
                    <th className="num">Entran</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {casado.lineas.map((l, i) => {
                    const e = ETIQUETA[l.estado];
                    return (
                      <tr key={i}>
                        <td className="text-xs">
                          {l.pedidoErp ?? l.pedidoArchivo ?? <span style={{ color: "var(--ink-muted)" }}>—</span>}
                          {l.pedidoArchivo && l.pedidoErp && l.pedidoArchivo !== l.pedidoErp ? (
                            <div className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                              {l.pedidoArchivo}
                            </div>
                          ) : null}
                        </td>
                        <td className="font-medium">{l.modelo}</td>
                        <td>{l.color || "—"}</td>
                        <td className="cifra">
                          {l.talla || <span style={{ color: "var(--ink-muted)" }}>corrida</span>}
                        </td>
                        <td className="num cifra">{n(l.cajas)}</td>
                        <td className="num cifra">{l.pedidoLineaId ? n(l.cajasPedido) : "—"}</td>
                        <td className="num cifra">{l.enOtros ? n(l.enOtros) : "—"}</td>
                        <td
                          className="num cifra font-medium"
                          style={{ color: l.cajasAsignar > 0 ? "var(--ink-1)" : "var(--estado-critico)" }}
                        >
                          {n(l.cajasAsignar)}
                        </td>
                        <td>
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                            style={{
                              background: `color-mix(in oklab, ${e.color} 15%, transparent)`,
                              color: e.color,
                            }}
                            title={l.detalle ?? undefined}
                          >
                            {e.texto}
                          </span>
                          {l.detalle ? (
                            <div className="mt-0.5 max-w-64 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                              {l.detalle}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-sm" style={{ color: "var(--ink-2)" }}>
                Se van <strong className="cifra">{n(casado.totales.cajasAsignar)}</strong> cajas en
                el contenedor {form.numero || "…"}.
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={cancelar}
                  disabled={cargando}
                  className="rounded-lg border px-3 py-2 text-sm font-medium"
                  style={{ borderColor: "var(--borde)" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmar}
                  disabled={!puedeConfirmar}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: "var(--acento)" }}
                >
                  {cargando ? "Guardando…" : "Guardar contenedor"}
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs" style={{ color: "var(--ink-muted)" }}>
              Los renglones con problema no se guardan. Si el pedido no está cargado, súbelo
              primero en <strong>Cargar pedidos</strong> y vuelve a subir este archivo.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <span className="block text-xs" style={{ color: "var(--ink-2)" }}>
        {etiqueta}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Dato({ titulo, valor, color }: { titulo: string; valor: string; color?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
        {titulo}
      </div>
      <div className="cifra mt-0.5 font-semibold" style={color ? { color } : undefined}>
        {valor}
      </div>
    </div>
  );
}
