/**
 * La ficha de evidencia dibujada: un PNG por modelo con la foto real de la
 * publicación, la caja de consenso y la tabla de lo que MELI midió en cada
 * talla. Es lo que se linkea en la solicitud de revisión de medidas.
 *
 * Se dibuja con `next/og` (Satori + resvg): JSX a PNG sin navegador. Satori
 * tiene sus reglas: todo elemento con más de un hijo lleva `display: flex`,
 * no hay `grid`, y la letra hay que dársela. La negrita es la Roboto
 * Condensed de las etiquetas (ya incrustada en base64); la regular es la Noto
 * Sans que trae `next/og`. El `import React` es para vitest, que compila el
 * JSX con la transformación clásica; Next lo compila con la automática y ahí
 * simplemente no se usa.
 */
import * as React from "react";
import { ImageResponse } from "next/og";
import { FUENTE_CONDENSADA_B64 } from "../etiquetas/fuente-condensada";
import type { DatosEvidencia, RenglonEvidencia } from "./evidencia-envio";

export const ANCHO_FICHA = 1200;
const ALTO_RENGLON = 34;

/** El alto depende de cuántas tallas se listan. */
export function altoFicha(d: DatosEvidencia): number {
  return 640 + d.renglones.length * ALTO_RENGLON + (d.omitidos ? 30 : 0);
}

const AZUL = "#1d4ed8";
const ROJO = "#b91c1c";
const VERDE = "#15803d";
const TINTA = "#111827";
const TINTA_2 = "#4b5563";
const LINEA = "#e5e7eb";
const NEGRITA = "Condensada";

const pesos = (n: number | null) =>
  n == null ? "—" : `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const unDecimal = (n: number) => String(Math.round(n * 10) / 10);

/** Cajita isométrica con los tres lados rotulados. */
function Caja({ largo, ancho, alto, peso }: { largo: number; ancho: number; alto: number; peso: number }) {
  // Proporciones fijas: lo importante son los números, no la escala.
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 360 }}>
      <svg width="300" height="200" viewBox="0 0 300 200">
        {/* cara frontal */}
        <path d="M40 80 L200 80 L200 170 L40 170 Z" fill="#c8a06a" stroke="#8b5e34" strokeWidth="2" />
        {/* cara superior */}
        <path d="M40 80 L100 40 L260 40 L200 80 Z" fill="#e2c294" stroke="#8b5e34" strokeWidth="2" />
        {/* cara lateral */}
        <path d="M200 80 L260 40 L260 130 L200 170 Z" fill="#a97a48" stroke="#8b5e34" strokeWidth="2" />
        {/* cotas */}
        <path d="M40 185 L200 185" stroke={TINTA} strokeWidth="1.5" />
        <path d="M215 172 L275 132" stroke={TINTA} strokeWidth="1.5" />
        <path d="M25 80 L25 170" stroke={TINTA} strokeWidth="1.5" />
      </svg>
      <div style={{ display: "flex", position: "absolute", left: 100, top: 186, fontSize: 18, fontFamily: NEGRITA, color: TINTA }}>
        {`largo ${unDecimal(largo)} cm`}
      </div>
      <div style={{ display: "flex", position: "absolute", left: 246, top: 150, fontSize: 18, fontFamily: NEGRITA, color: TINTA }}>
        {`ancho ${unDecimal(ancho)}`}
      </div>
      <div style={{ display: "flex", position: "absolute", left: 0, top: 110, fontSize: 18, fontFamily: NEGRITA, color: TINTA }}>
        {`alto ${unDecimal(alto)}`}
      </div>
      <div style={{ display: "flex", marginTop: 34, fontSize: 20, color: TINTA_2 }}>
        {`peso ${Math.round(peso)} g`}
      </div>
    </div>
  );
}

function Renglon({ r, i }: { r: RenglonEvidencia; i: number }) {
  const color = r.mala ? ROJO : TINTA;
  // Satori revienta con `fontFamily: undefined`: la negrita se agrega solo cuando toca.
  const negrita = r.mala ? { fontFamily: NEGRITA } : {};
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: ALTO_RENGLON,
        fontSize: 17,
        color,
        background: r.mala ? "#fef2f2" : i % 2 ? "#f9fafb" : "#ffffff",
        borderBottom: `1px solid ${LINEA}`,
      }}
    >
      <div style={{ display: "flex", width: 250, paddingLeft: 12, ...negrita }}>{r.sku}</div>
      <div style={{ display: "flex", width: 150 }}>{r.itemId}</div>
      <div style={{ display: "flex", width: 70 }}>{r.talla}</div>
      <div style={{ display: "flex", width: 220, ...negrita }}>{`${r.medida} cm`}</div>
      <div style={{ display: "flex", width: 100 }}>{r.peso == null ? "—" : `${r.peso} g`}</div>
      <div style={{ display: "flex", width: 120 }}>{pesos(r.costo)}</div>
      <div style={{ display: "flex", width: 120, color: r.midioMeli ? TINTA_2 : "#92400e", fontSize: 14 }}>
        {r.midioMeli ? "midió MELI" : "declarada"}
      </div>
      <div style={{ display: "flex", flex: 1, fontFamily: NEGRITA, color: r.mala ? ROJO : VERDE }}>
        {r.mala ? "MAL MEDIDA" : "correcta"}
      </div>
    </div>
  );
}

export function FichaEvidencia({ d }: { d: DatosEvidencia }) {
  const m = d.medidaReal;
  const malas = d.renglones.filter((r) => r.mala).length;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: ANCHO_FICHA,
        height: altoFicha(d),
        background: "#ffffff",
        color: TINTA,
        fontFamily: "Noto Sans",
      }}
    >
      {/* cabecera */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "22px 36px",
          background: AZUL,
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 20, opacity: 0.85 }}>Evidencia de medidas · Mercado Envíos Full</div>
          <div style={{ display: "flex", fontSize: 44, fontFamily: NEGRITA }}>{`Modelo ${d.modelo}`}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 18 }}>
          <div style={{ display: "flex" }}>{d.fecha}</div>
          <div style={{ display: "flex", opacity: 0.85 }}>
            {`${d.hermanas} publicaciones medidas por Mercado Libre`}
          </div>
        </div>
      </div>

      {/* foto + caja + texto */}
      <div style={{ display: "flex", padding: "24px 36px 8px", gap: 28 }}>
        <div
          style={{
            display: "flex",
            width: 300,
            height: 300,
            alignItems: "center",
            justifyContent: "center",
            border: `1px solid ${LINEA}`,
            borderRadius: 12,
            background: "#ffffff",
            overflow: "hidden",
          }}
        >
          {d.imagen ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.imagen} width={290} height={290} style={{ objectFit: "contain" }} alt="" />
          ) : (
            <div style={{ display: "flex", fontSize: 18, color: TINTA_2 }}>sin foto</div>
          )}
        </div>

        <div style={{ display: "flex", position: "relative", width: 360, height: 300 }}>
          <Caja largo={m.largo} ancho={m.ancho} alto={m.alto} peso={m.peso} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, fontSize: 19, lineHeight: 1.4 }}>
          <div style={{ display: "flex", fontSize: 24, fontFamily: NEGRITA, marginBottom: 10 }}>
            {`Medida real de la caja: ${unDecimal(m.largo)} × ${unDecimal(m.ancho)} × ${unDecimal(m.alto)} cm · ${Math.round(m.peso)} g`}
          </div>
          <div style={{ display: "flex", color: TINTA_2 }}>
            {`Todas las tallas del modelo ${d.modelo} van en la misma caja. Mercado Libre midió ${d.hermanas} publicaciones al recibirlas en Full y esa es la medida que se repite (mediana lado por lado).`}
          </div>
          <div style={{ display: "flex", marginTop: 12, color: ROJO, fontFamily: NEGRITA }}>
            {`${malas} ${malas === 1 ? "publicación quedó registrada" : "publicaciones quedaron registradas"} con otra medida y ${malas === 1 ? "cobra" : "cobran"} un envío mayor en cada venta`}
            {d.costoNormal != null ? ` (el envío correcto es ${pesos(d.costoNormal)}).` : "."}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {d.itemsMalos.slice(0, 12).map((id) => (
              <div
                key={id}
                style={{
                  display: "flex",
                  padding: "4px 10px",
                  borderRadius: 8,
                  background: "#fee2e2",
                  color: ROJO,
                  fontSize: 17,
                  fontFamily: NEGRITA,
                }}
              >
                {id}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* tabla */}
      <div style={{ display: "flex", flexDirection: "column", padding: "8px 36px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 36,
            fontSize: 15,
            color: TINTA_2,
            borderBottom: `2px solid ${TINTA}`,
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex", width: 250, paddingLeft: 12 }}>SKU</div>
          <div style={{ display: "flex", width: 150 }}>Publicación</div>
          <div style={{ display: "flex", width: 70 }}>Talla</div>
          <div style={{ display: "flex", width: 220 }}>Medida registrada</div>
          <div style={{ display: "flex", width: 100 }}>Peso</div>
          <div style={{ display: "flex", width: 120 }}>Envío</div>
          <div style={{ display: "flex", width: 120 }}>Fuente</div>
          <div style={{ display: "flex", flex: 1 }}>Estado</div>
        </div>
        {d.renglones.map((r, i) => (
          <Renglon key={r.sku} r={r} i={i} />
        ))}
        {d.omitidos > 0 && (
          <div style={{ display: "flex", height: 30, alignItems: "center", fontSize: 15, color: TINTA_2, paddingLeft: 12 }}>
            {`… y ${d.omitidos} publicaciones más del mismo modelo con la medida correcta.`}
          </div>
        )}
      </div>

      {/* pie */}
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          padding: "14px 36px 20px",
          fontSize: 14,
          color: TINTA_2,
          borderTop: `1px solid ${LINEA}`,
        }}
      >
        Medidas tomadas de los atributos PACKAGE_* de cada publicación en Mercado Libre (fuente MEASUREMENT = medida
        por Mercado Libre al recibir en Full). La medida real es la mediana lado por lado entre las publicaciones del
        mismo modelo; los costos de envío son los del simulador de Mercado Libre para esta cuenta.
      </div>
    </div>
  );
}

/** Dibuja la ficha y devuelve el PNG. */
export async function dibujarEvidencia(d: DatosEvidencia): Promise<Buffer> {
  const res = new ImageResponse(<FichaEvidencia d={d} />, {
    width: ANCHO_FICHA,
    height: altoFicha(d),
    fonts: [
      {
        name: NEGRITA,
        data: Buffer.from(FUENTE_CONDENSADA_B64, "base64"),
        weight: 700,
        style: "normal",
      },
    ],
  });
  return Buffer.from(await res.arrayBuffer());
}
