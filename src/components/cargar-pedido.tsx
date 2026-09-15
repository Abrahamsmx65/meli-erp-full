"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { VentanaProforma, overridesDeAjustes, type Ajustes, type Proforma } from "./ventana-proforma";

/**
 * Carga de una proforma, en dos pasos.
 *
 * Primero se lee el archivo y se muestra exactamente lo que va a entrar; solo
 * después se guarda. La separación importa porque cargar un pedido también da
 * de alta sus corridas, y las corridas son las que el planeador usa para
 * decidir qué cajas mandar a Full. Un archivo equivocado soltado sin querer
 * acabaría moviendo producto real.
 */
export function CargarPedido() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [previsualizacion, setPrevisualizacion] = useState<Proforma | null>(null);
  const [yaExiste, setYaExiste] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  async function previsualizar(f: File) {
    setCargando(true);
    setError(null);
    setExito(null);
    setPrevisualizacion(null);

    try {
      const fd = new FormData();
      fd.append("archivo", f);
      fd.append("accion", "previsualizar");

      const r = await fetch("/api/pedidos", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer el archivo.");

      setArchivo(f);
      setPrevisualizacion(j.proforma);
      setYaExiste(Boolean(j.yaExiste));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function confirmar(ajustes: Ajustes) {
    if (!archivo) return;
    setCargando(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("archivo", archivo);
      fd.append("accion", "confirmar");
      const overrides = overridesDeAjustes(ajustes);
      if (overrides.length) fd.append("overrides", JSON.stringify(overrides));

      const r = await fetch("/api/pedidos", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar el pedido.");

      setExito(
        `Pedido ${j.pedido} cargado: ${j.lineasCreadas} renglones y ${j.corridasCreadas} corridas dadas de alta.`,
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
    setPrevisualizacion(null);
    setArchivo(null);
    setYaExiste(false);
    if (input.current) input.current.value = "";
  }

  return (
    <section className="tarjeta p-4">
      <h2 className="font-semibold">Cargar un pedido nuevo</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
        Sube la Proforma Invoice de la fábrica tal como te llega. De ahí salen el
        pedido, sus modelos y colores, y <strong>las corridas</strong> — el reparto de
        tallas por caja ya viene en el archivo, así que no hay que capturarlo.
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
        {cargando && !previsualizacion ? (
          <span className="text-sm" style={{ color: "var(--ink-2)" }}>
            Leyendo el archivo…
          </span>
        ) : null}
      </div>

      {error && !previsualizacion ? (
        <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
      {exito ? (
        <p className="mt-3 text-sm" style={{ color: "var(--exito-texto)" }}>
          {exito}
        </p>
      ) : null}

      {previsualizacion && archivo ? (
        <VentanaProforma
          proforma={previsualizacion}
          archivoNombre={archivo.name}
          yaExiste={yaExiste}
          cargando={cargando}
          error={error}
          onConfirmar={confirmar}
          onCancelar={cancelar}
        />
      ) : null}
    </section>
  );
}
