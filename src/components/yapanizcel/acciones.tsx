"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { estiloInput } from "./comunes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function leer(r: Response): Promise<any> {
  const texto = await r.text();
  try {
    return JSON.parse(texto);
  } catch {
    if (r.status === 504 || /timed? ?out|FUNCTION_INVOCATION_TIMEOUT/i.test(texto)) {
      throw new Error("Se pasó del tiempo máximo. Vuelve a darle: retoma donde se quedó.");
    }
    throw new Error(`El servidor contestó algo que no se pudo leer (${r.status}).`);
  }
}

function Mensajes({ aviso, error }: { aviso: string | null; error: string | null }) {
  return (
    <>
      {aviso ? (
        <p className="mt-3 text-sm" style={{ color: "var(--exito-texto)" }}>
          {aviso}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
    </>
  );
}

const btn = "rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60";
const btnPrimario = { background: "var(--acento)", color: "#fff" } as const;
const btnSecundario = { border: "1px solid var(--borde)", color: "var(--ink-1)" } as const;

export function BotonSincronizar() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function correr() {
    setOcupado(true);
    setAviso(null);
    setError(null);
    try {
      const r = await fetch("/api/yapanizcel/sincronizar", { method: "POST" });
      const j = await leer(r);
      if (!r.ok) throw new Error(j.error ?? "Falló la sincronización.");
      const s = j.resumen;
      setAviso(
        `Listo (${s.cuenta}): ${s.catalogo.skus} SKUs` +
          (s.catalogo.pendientes ? ` (${s.catalogo.pendientes} pendientes de SKU, se resuelven solos)` : "") +
          `, ${s.stock.skus} con stock leído, ${s.ventas.ordenes} órdenes.` +
          (s.ventas.sinSku ? ` ${s.ventas.sinSku} renglones de orden sin SKU.` : ""),
      );
      // Los SKUs pendientes se resuelven en segundo plano.
      fetch("/api/yapanizcel/skus-pendientes", { method: "POST" }).catch(() => {});
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <button onClick={correr} disabled={ocupado} className={btn} style={btnPrimario}>
        {ocupado ? "Sincronizando…" : "Sincronizar con Mercado Libre"}
      </button>
      <Mensajes aviso={aviso} error={error} />
    </div>
  );
}

export function BotonSheets({ configurado }: { configurado: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<"sync" | "ver" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<string[] | null>(null);

  async function correr(modo: "sync" | "ver") {
    setOcupado(modo);
    setAviso(null);
    setError(null);
    setDetalle(null);
    try {
      const r = await fetch("/api/yapanizcel/sheets", { method: modo === "sync" ? "POST" : "GET" });
      const j = await leer(r);
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer el sheet.");
      const hojas = (j.hojas as { nombre: string; formato: string; renglones: number }[])
        .map((h) => `${h.nombre}: ${h.formato === "sin_datos" ? "sin datos reconocibles" : `${h.renglones} renglones (${h.formato})`}`);
      setAviso(
        modo === "sync"
          ? `Bodega actualizada: ${j.renglones} SKUs, ${j.unidades.toLocaleString("es-MX")} unidades en ${j.hojas.length} pestañas.`
          : `Se leerían ${j.renglones} SKUs y ${j.unidades.toLocaleString("es-MX")} unidades. Nada se guardó.`,
      );
      const avisos = (j.avisos as ({ hoja: string; fila: number | null; mensaje: string } | string)[]).map((a) =>
        typeof a === "string" ? a : `${a.hoja}${a.fila ? ` · fila ${a.fila}` : ""}: ${a.mensaje}`,
      );
      setDetalle([...hojas, ...avisos.slice(0, 30)]);
      if (modo === "sync") router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  if (!configurado) {
    return (
      <p className="text-sm" style={{ color: "var(--estado-serio)" }}>
        Falta <code>YAPANIZCEL_SHEET_URL</code> en las variables de entorno: la URL del sheet de inventario,
        compartido como «cualquiera con el enlace puede ver».
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => correr("sync")} disabled={ocupado !== null} className={btn} style={btnPrimario}>
          {ocupado === "sync" ? "Leyendo…" : "Actualizar bodega desde el sheet"}
        </button>
        <button onClick={() => correr("ver")} disabled={ocupado !== null} className={btn} style={btnSecundario}>
          {ocupado === "ver" ? "Leyendo…" : "Solo ver qué se leería"}
        </button>
      </div>
      <Mensajes aviso={aviso} error={error} />
      {detalle?.length ? (
        <ul className="mt-2 list-disc pl-5 text-xs" style={{ color: "var(--ink-2)" }}>
          {detalle.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SubirCostos() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const datos = new FormData(form);
    setOcupado(true);
    setAviso(null);
    setError(null);
    try {
      const r = await fetch("/api/yapanizcel/costos", { method: "POST", body: datos });
      const j = await leer(r);
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer el archivo.");
      setAviso(`${j.modelos} modelos con costo guardados.` + (j.avisos?.length ? ` Avisos: ${j.avisos.join(" · ")}` : ""));
      form.reset();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" name="archivo" accept=".xlsx,.xls,.csv" required className="text-sm" />
        <button type="submit" disabled={ocupado} className={btn} style={btnPrimario}>
          {ocupado ? "Leyendo…" : "Subir costos"}
        </button>
      </div>
      <Mensajes aviso={aviso} error={error} />
    </form>
  );
}

export function FormularioParametros({
  valores,
}: {
  valores: { diasVenta: number; diasObjetivo: number; multiploEnvio: number; minimoEnvio: number; diasCaducidadEnvio: number };
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.currentTarget).entries());
    setOcupado(true);
    setAviso(null);
    setError(null);
    try {
      const r = await fetch("/api/yapanizcel/parametros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });
      const j = await leer(r);
      if (!r.ok) throw new Error(j.error ?? "No se guardó.");
      setAviso("Parámetros guardados.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const campo = (nombre: keyof typeof valores, etiqueta: string, ayuda: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{etiqueta}</span>
      <input type="number" name={nombre} defaultValue={valores[nombre]} min={1} className="w-28 rounded-lg border px-2 py-1" style={estiloInput} />
      <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
        {ayuda}
      </span>
    </label>
  );

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {campo("diasVenta", "Días de venta que se miden", "La ventana con la que se calcula la venta diaria (30).")}
        {campo("diasObjetivo", "Días de cobertura en Full", "Cuántos días de venta se quieren dejar en Full (30).")}
        {campo("multiploEnvio", "Múltiplo de envío", "Las unidades se mandan en múltiplos de esto (10 = decenas cerradas).")}
        {campo("minimoEnvio", "Mínimo por SKU", "Debajo de esto no se manda nada de ese SKU.")}
        {campo("diasCaducidadEnvio", "Días que cuenta un envío", "Un envío registrado deja de contar como «en camino» después de estos días.")}
      </div>
      <div>
        <button type="submit" disabled={ocupado} className={btn} style={btnPrimario}>
          {ocupado ? "Guardando…" : "Guardar parámetros"}
        </button>
        <Mensajes aviso={aviso} error={error} />
      </div>
    </form>
  );
}
