"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Importar() {
  const router = useRouter();
  const [corridas, setCorridas] = useState<File | null>(null);
  const [existencias, setExistencias] = useState<File | null>(null);
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function subir(e: React.FormEvent) {
    e.preventDefault();
    if (!corridas && !existencias) {
      setError("Elige al menos un archivo.");
      return;
    }

    setCargando(true);
    setError(null);
    setResultado(null);

    const form = new FormData();
    if (corridas) form.append("corridas", corridas);
    if (existencias) form.append("existencias", existencias);

    try {
      const r = await fetch("/api/importar", { method: "POST", body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo importar.");
      setResultado(j);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Importar inventario</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Sube tus dos reportes de siempre. Se leen por nombre de columna, así que
          pueden traer columnas de más o venir en otro orden.
        </p>
      </div>

      <form onSubmit={subir} className="tarjeta flex flex-col gap-5 p-5">
        <Campo
          titulo="CORRIDAS BASE"
          descripcion="La receta de tallas de cada caja. Columnas: PEDIDO, MODELO, COLOR y una columna por talla. Se acumula: las corridas viejas siguen sirviendo."
          archivo={corridas}
          onChange={setCorridas}
        />

        <Campo
          titulo="Existencias globales"
          descripcion="Cuántas cajas hay y dónde. Columnas: Almacén, SKU, N-Pedido, Modelo, Color, Talla, Cajas disponibles, Pares por caja. Reemplaza por completo lo anterior: es la foto del momento."
          archivo={existencias}
          onChange={setExistencias}
        />

        <button
          type="submit"
          disabled={cargando}
          className="self-start rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--acento)" }}
        >
          {cargando ? "Importando…" : "Importar"}
        </button>
      </form>

      {error ? (
        <div className="tarjeta p-4 text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </div>
      ) : null}

      {resultado ? (
        <div className="tarjeta flex flex-col gap-3 p-5">
          <h2 className="font-semibold" style={{ color: "var(--exito-texto)" }}>
            Importación lista
          </h2>

          {resultado.resumen?.corridas ? (
            <p className="text-sm">
              <strong>{resultado.resumen.corridas.leidas}</strong> corridas guardadas · tallas
              detectadas: {resultado.resumen.corridas.tallas.join(", ")}
            </p>
          ) : null}

          {resultado.resumen?.existencias ? (
            <p className="text-sm">
              <strong>{resultado.resumen.existencias.leidas}</strong> renglones de existencias ·{" "}
              <strong>{resultado.resumen.existencias.cajasDisponibles.toLocaleString("es-MX")}</strong>{" "}
              cajas disponibles · almacenes: {resultado.resumen.existencias.almacenes.join(", ")}
            </p>
          ) : null}

          {resultado.avisos?.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer" style={{ color: "var(--estado-alerta)" }}>
                {resultado.avisos.length} avisos que vale la pena revisar
              </summary>
              <ul className="mt-2 flex flex-col gap-1 pl-4" style={{ color: "var(--ink-2)" }}>
                {resultado.avisos.map((a: string, i: number) => (
                  <li key={i} className="list-disc">
                    {a}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <SeccionIndusther />
    </div>
  );
}

/**
 * Sincronización directa contra el API de inventarios de Industher: la misma
 * foto de existencias que el Excel, pero sin subir archivo. "Probar conexión"
 * enseña qué campos reconoce el normalizador antes de escribir nada.
 */
function SeccionIndusther() {
  const router = useRouter();
  const [probando, setProbando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [prueba, setPrueba] = useState<any>(null);
  const [resumen, setResumen] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function llamar(metodo: "GET" | "POST") {
    const esPrueba = metodo === "GET";
    (esPrueba ? setProbando : setSincronizando)(true);
    setError(null);
    if (esPrueba) setPrueba(null);
    else setResumen(null);

    try {
      const r = await fetch("/api/industher", { method: metodo });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "El API de Industher no contestó bien.");
      if (esPrueba) {
        setPrueba(j);
      } else {
        setResumen(j.resumen);
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      (esPrueba ? setProbando : setSincronizando)(false);
    }
  }

  return (
    <div className="tarjeta flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-semibold">Inventario Industher (API)</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Trae las existencias directo del sistema del almacén, sin subir Excel.
          Reemplaza solo los almacenes que el API reporta. Prueba primero la
          conexión para ver qué campos llegan.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => llamar("GET")}
          disabled={probando || sincronizando}
          className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ borderColor: "var(--borde)" }}
        >
          {probando ? "Probando…" : "Probar conexión"}
        </button>
        <button
          type="button"
          onClick={() => llamar("POST")}
          disabled={probando || sincronizando}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--acento)" }}
        >
          {sincronizando ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
      </div>

      {error ? (
        <p className="text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}

      {prueba ? (
        <div className="flex flex-col gap-2 text-sm">
          <p style={{ color: "var(--exito-texto)" }}>
            Conexión buena: <strong>{prueba.renglones}</strong> renglones ·{" "}
            <strong>{prueba.cajasDisponibles?.toLocaleString("es-MX")}</strong> cajas
            disponibles · almacenes: {prueba.almacenes?.join(", ")}
          </p>
          <ResumenCampos
            detectados={prueba.camposDetectados}
            ignorados={prueba.camposIgnorados}
            avisos={prueba.avisos}
          />
          {prueba.muestra?.length ? (
            <details>
              <summary className="cursor-pointer" style={{ color: "var(--ink-2)" }}>
                Muestra de los primeros renglones (ya normalizados)
              </summary>
              <pre
                className="mt-2 overflow-x-auto rounded-lg p-3 text-xs"
                style={{ background: "var(--surface-1)", border: "1px solid var(--borde)" }}
              >
                {JSON.stringify(prueba.muestra, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}

      {resumen ? (
        <div className="flex flex-col gap-2 text-sm">
          <p style={{ color: "var(--exito-texto)" }}>
            Inventario sincronizado: <strong>{resumen.renglones}</strong> renglones ·{" "}
            <strong>{resumen.cajasDisponibles?.toLocaleString("es-MX")}</strong> cajas
            disponibles · almacenes: {resumen.almacenes?.join(", ")}
          </p>
          <ResumenCampos
            detectados={resumen.camposDetectados}
            ignorados={resumen.camposIgnorados}
            avisos={resumen.avisos}
          />
        </div>
      ) : null}
    </div>
  );
}

function ResumenCampos({
  detectados,
  ignorados,
  avisos,
}: {
  detectados?: Record<string, string>;
  ignorados?: string[];
  avisos?: string[];
}) {
  return (
    <>
      {detectados && Object.keys(detectados).length ? (
        <p style={{ color: "var(--ink-2)" }}>
          Campos reconocidos:{" "}
          {Object.entries(detectados)
            .map(([nuestro, delApi]) => `${nuestro} ← ${delApi}`)
            .join(" · ")}
        </p>
      ) : null}
      {ignorados?.length ? (
        <p style={{ color: "var(--estado-alerta)" }}>
          Campos del API que se ignoraron: {ignorados.join(", ")}
        </p>
      ) : null}
      {avisos?.length ? (
        <ul className="flex flex-col gap-1 pl-4" style={{ color: "var(--estado-alerta)" }}>
          {avisos.map((a, i) => (
            <li key={i} className="list-disc">
              {a}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Campo({
  titulo,
  descripcion,
  archivo,
  onChange,
}: {
  titulo: string;
  descripcion: string;
  archivo: File | null;
  onChange: (f: File | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{titulo}</span>
      <span className="text-xs" style={{ color: "var(--ink-2)" }}>
        {descripcion}
      </span>
      <input
        type="file"
        accept=".xlsx,.xlsm,.xls"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="mt-1 text-sm"
      />
      {archivo ? (
        <span className="text-xs" style={{ color: "var(--exito-texto)" }}>
          {archivo.name} ({Math.round(archivo.size / 1024)} KB)
        </span>
      ) : null}
    </label>
  );
}
