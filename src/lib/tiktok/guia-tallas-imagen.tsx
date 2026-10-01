/**
 * La guía de tallas DIBUJADA: un PNG con la tabla talla → centímetros que
 * se sube a TikTok como `size_chart.image` del producto. Mismo camino que
 * la ficha de evidencia de medidas (`next/og`: Satori + resvg, sin
 * navegador; todo con más de un hijo lleva `display: flex`).
 */
import * as React from "react";
import { ImageResponse } from "next/og";
import { FUENTE_CONDENSADA_B64 } from "../etiquetas/fuente-condensada";
import type { RenglonGuiaTallas } from "./guia-tallas";

export const ANCHO_GUIA = 900;
const ALTO_RENGLON = 56;
const NEGRITA = "Condensada";
const TINTA = "#111827";
const TINTA_2 = "#4b5563";
const LINEA = "#e5e7eb";
const CABECERA = "#111827";

export function altoGuia(renglones: RenglonGuiaTallas[]): number {
  return 190 + renglones.length * ALTO_RENGLON + 70;
}

function GuiaTallas({ titulo, renglones }: { titulo: string; renglones: RenglonGuiaTallas[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: ANCHO_GUIA, height: altoGuia(renglones), background: "#ffffff", padding: 40, fontFamily: "Noto Sans", color: TINTA }}>
      <div style={{ display: "flex", fontSize: 40, fontFamily: NEGRITA }}>Guía de tallas</div>
      <div style={{ display: "flex", fontSize: 22, color: TINTA_2, marginTop: 6 }}>{titulo}</div>
      <div style={{ display: "flex", fontSize: 20, color: TINTA_2, marginTop: 4 }}>Mide la plantilla del pie de talón a punta y elige la talla con ese largo.</div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 26, border: `2px solid ${LINEA}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", background: CABECERA, color: "#ffffff", fontSize: 24, fontFamily: NEGRITA, height: ALTO_RENGLON, alignItems: "center" }}>
          <div style={{ display: "flex", width: "50%", justifyContent: "center" }}>Talla MX</div>
          <div style={{ display: "flex", width: "50%", justifyContent: "center" }}>Largo de la plantilla</div>
        </div>
        {renglones.map((r, i) => (
          <div key={r.talla} style={{ display: "flex", height: ALTO_RENGLON, alignItems: "center", fontSize: 26, background: i % 2 ? "#f9fafb" : "#ffffff", borderTop: `1px solid ${LINEA}` }}>
            <div style={{ display: "flex", width: "50%", justifyContent: "center", fontFamily: NEGRITA }}>{r.talla}</div>
            <div style={{ display: "flex", width: "50%", justifyContent: "center" }}>{r.cm}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export async function dibujarGuiaTallas(titulo: string, renglones: RenglonGuiaTallas[]): Promise<Buffer> {
  const res = new ImageResponse(<GuiaTallas titulo={titulo} renglones={renglones} />, {
    width: ANCHO_GUIA,
    height: altoGuia(renglones),
    fonts: [{ name: NEGRITA, data: Buffer.from(FUENTE_CONDENSADA_B64, "base64"), weight: 700, style: "normal" }],
  });
  return Buffer.from(await res.arrayBuffer());
}
