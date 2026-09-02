"use client";

import { useEffect, useRef, useState } from "react";
import { formatearFolio } from "@/lib/codigos";
import { fechaCorta } from "@/lib/formato";
import type { Escaneo } from "@/lib/tipos";
import { accionEscanear } from "../acciones";

type Resultado = Escaneo | { error: string };

const TEXTO: Record<Escaneo["resultado"], { titulo: string; tono: "bien" | "alerta" | "mal" }> = {
  ok: { titulo: "✅ Pasa", tono: "bien" },
  ya_usado: { titulo: "⛔ Ya entró", tono: "alerta" },
  no_existe: { titulo: "❌ Boleto no existe", tono: "mal" },
  cancelado: { titulo: "❌ Boleto cancelado", tono: "mal" },
  no_pagado: { titulo: "❌ Pago sin confirmar", tono: "mal" },
};

const FONDO = { bien: "var(--bien)", alerta: "var(--alerta)", mal: "var(--mal)" };
const ID_LECTOR = "lector-qr";

export function Escaner() {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [errorCamara, setErrorCamara] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [contador, setContador] = useState(0);
  const ultimo = useRef<{ texto: string; en: number }>({ texto: "", en: 0 });
  const ocupado = useRef(false);

  async function procesar(texto: string) {
    // El lector dispara varias veces por segundo el mismo QR: se ignora
    // la repetición durante 4 s y nunca se manda uno mientras otro viaja.
    const ahora = Date.now();
    if (ocupado.current) return;
    if (ultimo.current.texto === texto && ahora - ultimo.current.en < 4000) return;
    ultimo.current = { texto, en: ahora };
    ocupado.current = true;
    setProcesando(true);
    try {
      const r = await accionEscanear(texto);
      setResultado(r);
      if (!("error" in r)) {
        if (r.resultado === "ok") setContador((n) => n + 1);
        vibrar(r.resultado === "ok" ? [80] : [120, 60, 120]);
        pitar(r.resultado === "ok");
      }
    } finally {
      ocupado.current = false;
      setProcesando(false);
    }
  }

  useEffect(() => {
    let lector: import("html5-qrcode").Html5Qrcode | null = null;
    let cancelado = false;

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelado) return;
        lector = new Html5Qrcode(ID_LECTOR, { verbose: false });
        await lector.start(
          { facingMode: "environment" },
          { fps: 8, qrbox: (w, h) => { const l = Math.min(w, h) * 0.75; return { width: l, height: l }; } },
          (texto) => void procesar(texto),
          () => {},
        );
      } catch (e) {
        setErrorCamara(
          "No se pudo abrir la cámara. Revisa el permiso del navegador; el sitio debe abrirse por HTTPS. " +
            (e instanceof Error ? e.message : ""),
        );
      }
    })();

    return () => {
      cancelado = true;
      if (lector?.isScanning) lector.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const info = resultado && !("error" in resultado) ? TEXTO[resultado.resultado] : null;

  return (
    <div className="grid gap-4">
      <div className="tarjeta overflow-hidden">
        <div id={ID_LECTOR} className="w-full" style={{ minHeight: 240, background: "#000" }} />
        {errorCamara && <div className="aviso aviso-alerta m-3">{errorCamara}</div>}
      </div>

      <div
        className="rounded-2xl p-5 text-white transition-colors"
        style={{ background: info ? FONDO[info.tono] : "var(--tinta-2)", minHeight: 120 }}
        aria-live="polite"
      >
        {!resultado && <div className="text-lg font-bold">{procesando ? "Verificando…" : "Esperando un QR…"}</div>}
        {resultado && "error" in resultado && <div className="text-lg font-bold">⚠️ {resultado.error}</div>}
        {resultado && !("error" in resultado) && info && (
          <>
            <div className="text-2xl font-extrabold">{info.titulo}</div>
            {resultado.nombre && (
              <div className="mt-2 text-lg font-semibold">{resultado.nombre}</div>
            )}
            <div className="mt-1 text-sm opacity-90">
              {resultado.folio && <>Boleto {formatearFolio(resultado.folio)} · </>}
              {resultado.evento}
              {resultado.cantidad && resultado.cantidad > 1 && <> · pedido de {resultado.cantidad} boletos</>}
            </div>
            {resultado.resultado === "ya_usado" && resultado.usado_en && (
              <div className="mt-1 text-sm opacity-90">Entró {fechaCorta(resultado.usado_en)}{resultado.usado_por && ` · ${resultado.usado_por}`}</div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between text-sm" style={{ color: "var(--tinta-suave)" }}>
        <span>Entradas en esta sesión: <strong>{contador}</strong></span>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            void procesar(manual.trim());
            setManual("");
          }
        }}
      >
        <input
          className="mono flex-1 rounded-xl border px-3 py-2 text-sm uppercase"
          style={{ borderColor: "var(--borde)" }}
          placeholder="O escribe el código del boleto"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button className="boton boton-suave !py-2" disabled={procesando}>Validar</button>
      </form>
    </div>
  );
}

function vibrar(patron: number[]) {
  try {
    navigator.vibrate?.(patron);
  } catch {}
}

function pitar(bien: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = bien ? 1200 : 300;
    osc.type = "sine";
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (bien ? 0.12 : 0.35));
    osc.onended = () => ctx.close();
  } catch {}
}
