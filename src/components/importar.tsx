"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Aviso } from "@/components/ui/pagina";

/**
 * Paneles de /importar: Industher por API, corridas del sheet y el Excel de
 * corridas de respaldo. La página (servidor) pone el encabezado.
 */
export function PanelesImportar() {
  const router = useRouter();
  const [corridas, setCorridas] = useState<File | null>(null);
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function subir(e: React.FormEvent) {
    e.preventDefault();
    if (!corridas) {
      setError("Elige el archivo de corridas.");
      return;
    }

    setCargando(true);
    setError(null);
    setResultado(null);

    const form = new FormData();
    form.append("corridas", corridas);

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
    <>
      <SeccionIndusther />

      <SeccionCorridasSheets />

      <form onSubmit={subir} className="tarjeta flex flex-col gap-5 p-5">
        <Campo
          titulo="Corridas desde Excel (respaldo)"
          descripcion="Columnas: PEDIDO, MODELO, COLOR y una por talla."
          archivo={corridas}
          onChange={setCorridas}
        />

        <button
          type="submit"
          disabled={cargando}
          className="boton boton-borde self-start"
        >
          {cargando ? "Importando…" : "Importar corridas"}
        </button>
      </form>

      {error ? (
        <Aviso tono="critico">{error}</Aviso>
      ) : null}

      {resultado ? (
        <div className="tarjeta flex flex-col gap-3 p-5">
          <h2 className="seccion-titulo" style={{ color: "var(--exito-texto)" }}>
            Importación lista
          </h2>

          {resultado.resumen?.corridas ? (
            <p className="text-sm">
              <strong>{resultado.resumen.corridas.leidas}</strong> corridas guardadas · tallas
              detectadas: {resultado.resumen.corridas.tallas.join(", ")}
            </p>
          ) : null}

          {resultado.avisos?.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer" style={{ color: "var(--alerta-texto)" }}>
                {resultado.avisos.length} avisos
              </summary>
              <ul className="mt-2 flex flex-col gap-1 pl-4 texto-2">
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
    </>
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
      if (!r.ok) {
        throw new Error(j.error ?? "El API de Industher no contestó bien.");
      }
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
        <h2 className="seccion-titulo">Inventario Industher (API)</h2>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => llamar("GET")}
          disabled={probando || sincronizando}
          className="boton boton-borde"
        >
          {probando ? "Probando…" : "Probar conexión"}
        </button>
        <button
          type="button"
          onClick={() => llamar("POST")}
          disabled={probando || sincronizando}
          className="boton boton-primario"
        >
          {sincronizando ? "Sincronizando…" : "Sincronizar inventario"}
        </button>
      </div>

      {error ? (
        <p className="text-sm" style={{ color: "var(--critico-texto)" }}>
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
              <summary className="cursor-pointer texto-2">
                Muestra de los primeros renglones
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

/**
 * Corridas desde Google Sheets: el sheet (compartido con enlace, solo
 * lectura) se baja como Excel y pasa por el mismo importador de siempre. La
 * URL vive en CORRIDAS_SHEET_URL.
 */
function SeccionCorridasSheets() {
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
      const r = await fetch("/api/corridas/sheets", { method: metodo });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer el sheet de corridas.");
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
        <h2 className="seccion-titulo">Corridas desde Google Sheets</h2>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => llamar("GET")}
          disabled={probando || sincronizando}
          className="boton boton-borde"
        >
          {probando ? "Probando…" : "Probar lectura"}
        </button>
        <button
          type="button"
          onClick={() => llamar("POST")}
          disabled={probando || sincronizando}
          className="boton boton-primario"
        >
          {sincronizando ? "Sincronizando…" : "Sincronizar corridas"}
        </button>
      </div>

      {error ? (
        <p className="text-sm" style={{ color: "var(--critico-texto)" }}>
          {error}
        </p>
      ) : null}

      {prueba ? (
        <div className="flex flex-col gap-2 text-sm">
          <p style={{ color: "var(--exito-texto)" }}>
            Lectura buena: <strong>{prueba.corridas}</strong> corridas en la pestaña{" "}
            <strong>{prueba.hoja}</strong> · tallas: {prueba.tallas?.join(", ")}
          </p>
          <ResumenCampos avisos={prueba.avisos} />
        </div>
      ) : null}

      {resumen ? (
        <div className="flex flex-col gap-2 text-sm">
          <p style={{ color: "var(--exito-texto)" }}>
            Corridas sincronizadas: <strong>{resumen.corridas}</strong> desde la pestaña{" "}
            <strong>{resumen.hoja}</strong>
          </p>
          <ResumenCampos avisos={resumen.avisos} />
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
        <p className="texto-2">
          Campos reconocidos:{" "}
          {Object.entries(detectados)
            .map(([nuestro, delApi]) => `${nuestro} ← ${delApi}`)
            .join(" · ")}
        </p>
      ) : null}
      {ignorados?.length ? (
        <p style={{ color: "var(--alerta-texto)" }}>
          Campos del API que se ignoraron: {ignorados.join(", ")}
        </p>
      ) : null}
      {avisos?.length ? (
        <ul className="flex flex-col gap-1 pl-4" style={{ color: "var(--alerta-texto)" }}>
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
      <span className="text-xs texto-2">
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
