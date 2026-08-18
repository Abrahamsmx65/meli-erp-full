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
    </div>
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
