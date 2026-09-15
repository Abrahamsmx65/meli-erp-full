"use client";

/**
 * Botón de descarga con estado: los Excel del ERP pueden tardar minutos
 * (maxDuration de hasta 300 s) y antes eran <a> mudos — el usuario picaba
 * tres veces y generaba tres archivos. Aquí el clic muestra «Generando…»
 * al instante, bloquea repeticiones y baja el archivo como blob; el error
 * llega como aviso legible, no como una pestaña rota.
 */
import { useState } from "react";
import { avisar } from "./avisos";
import { type VarianteBoton, Boton } from "./boton";

export function BotonDescarga({
  href,
  children,
  variante = "borde",
  chico,
  title,
  nombre,
}: {
  /** URL del API que genera el archivo (con los filtros ya serializados) */
  href: string;
  children: React.ReactNode;
  variante?: VarianteBoton;
  chico?: boolean;
  title?: string;
  /** nombre del archivo si el servidor no manda Content-Disposition */
  nombre?: string;
}) {
  const [generando, setGenerando] = useState(false);

  async function descargar() {
    if (generando) return;
    setGenerando(true);
    try {
      const r = await fetch(href);
      if (!r.ok) {
        let mensaje = `No se pudo generar el archivo (${r.status}).`;
        try {
          const j = await r.json();
          if (j?.error) mensaje = j.error;
        } catch {
          if (r.status === 504) mensaje = "El archivo tardó demasiado en generarse. Vuelve a intentar.";
        }
        throw new Error(mensaje);
      }
      const blob = await r.blob();
      const disposicion = r.headers.get("content-disposition") ?? "";
      const delServidor = /filename="?([^";]+)"?/.exec(disposicion)?.[1];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = delServidor ?? nombre ?? "descarga.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      avisar("exito", `Descargado: ${a.download}`);
    } catch (e) {
      avisar("error", (e as Error).message);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <Boton
      variante={variante}
      chico={chico}
      title={title}
      onClick={descargar}
      cargando={generando}
      textoCargando="Generando…"
    >
      {children}
    </Boton>
  );
}
