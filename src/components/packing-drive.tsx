"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ArchivoDriveVista {
  nombre: string;
  estado: string;
  motivo: string | null;
  procesadoEn: string;
  contenedor: string | null;
}

/**
 * Packing lists que llegan solos desde la carpeta de Drive de la fábrica:
 * qué archivo entró, cuál se omitió y por qué, y el botón para traerlos
 * ahora sin esperar al cron de la mañana.
 */
export function PackingDrive({
  archivos,
  configurado,
  conLlave = false,
  borradores = [],
}: {
  archivos: ArchivoDriveVista[];
  configurado: boolean;
  conLlave?: boolean;
  /** contenedores que entraron desde Drive y esperan tu revisión */
  borradores?: string[];
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [resumen, setResumen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verDetalle, setVerDetalle] = useState(false);
  // Un packing list que entró pero dejó cajas fuera es lo único que compite
  // con "hay contenedores por revisar" por la atención del dueño.
  const incompletos = archivos.filter((a) => a.estado === "importado" && a.motivo);

  async function traer(forzar: boolean) {
    setOcupado(true);
    setError(null);
    setResumen(null);
    try {
      const r = await fetch(`/api/contenedores/drive${forzar ? "?forzar=1" : ""}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer Drive.");
      // Solo lo que le cambia el trabajo al dueño: lo que ENTRÓ. Lo demás
      // (omitidos, archivos que no son packing list) vive en el detalle.
      const correos = (j.correos ?? []).filter((c: { enviado: boolean }) => c.enviado).length;
      setResumen(
        j.importados.length
          ? `Entraron ${j.importados.length}: ${j.importados.join(" · ")}` +
              (correos ? ` · ${correos} correo(s) de fotos enviados` : "")
          : `Nada nuevo (${j.revisados} archivo(s) revisados).`,
      );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">Packing lists desde Drive</h2>
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {configurado
            ? `Se leen solos cada mañana y entran como borrador.${conLlave ? "" : " Carpeta pública, sin llave."}`
            : "Sin configurar: falta la llave de Google Drive en el entorno."}
        </span>
        <span className="flex-1" />
        <button
          onClick={() => traer(false)}
          disabled={ocupado || !configurado}
          className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--borde)" }}
        >
          {ocupado ? "Leyendo Drive…" : "Traer de Drive ahora"}
        </button>
        <button
          onClick={() => traer(true)}
          disabled={ocupado || !configurado}
          className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
          style={{ borderColor: "var(--borde)", color: "var(--ink-2)" }}
          title="Vuelve a leer también los archivos que no cambiaron"
        >
          Releer todo
        </button>
      </header>
      {resumen ? (
        <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>
          {resumen}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
      {/* Decisión del dueño (10-sep-2026): aquí solo se avisa si hay algo NUEVO
          que revisar; los renglones de importado, omitido y error no se
          enseñan salvo que él los pida. */}
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {borradores.length ? (
          <span
            className="rounded-full px-2 py-0.5 font-medium"
            style={{
              background: "color-mix(in oklab, var(--estado-alerta) 15%, transparent)",
              color: "var(--estado-alerta)",
            }}
          >
            Hay cambios: {borradores.length} contenedor(es) por revisar · {borradores.join(" · ")}
          </span>
        ) : (
          <span style={{ color: "var(--ink-muted)" }}>Nada nuevo por revisar.</span>
        )}
        {incompletos.length ? (
          <span
            className="rounded-full px-2 py-0.5 font-medium"
            style={{
              background: "color-mix(in oklab, var(--estado-critico) 12%, transparent)",
              color: "var(--estado-critico)",
            }}
            title={incompletos.map((a) => `${a.contenedor ?? a.nombre}: ${a.motivo}`).join("\n")}
          >
            {incompletos.length} entraron con cajas de menos
          </span>
        ) : null}
        {archivos.length ? (
          <button
            onClick={() => setVerDetalle((v) => !v)}
            className="underline"
            style={{ color: "var(--ink-2)" }}
          >
            {verDetalle ? "Ocultar detalle" : "Ver detalle"}
          </button>
        ) : null}
      </p>
      {verDetalle && archivos.length ? (
        <ul className="mt-3 flex flex-col gap-1 text-xs">
          {archivos.map((a) => (
            <li key={a.nombre + a.procesadoEn} className="flex flex-wrap gap-x-3">
              <span className="font-medium">{a.nombre}</span>
              <span
                style={{
                  color:
                    a.estado === "importado"
                      ? "var(--exito-texto)"
                      : a.estado === "error"
                        ? "var(--estado-critico)"
                        : "var(--ink-muted)",
                }}
              >
                {a.estado}
                {a.contenedor ? ` → ${a.contenedor}` : ""}
              </span>
              {a.motivo ? <span style={{ color: "var(--ink-2)" }}>{a.motivo}</span> : null}
              <span className="cifra" style={{ color: "var(--ink-muted)" }}>
                {a.procesadoEn.slice(0, 16).replace("T", " ")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
