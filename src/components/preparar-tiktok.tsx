"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, ScanLine, Volume2, VolumeX } from "lucide-react";
import type { PaqueteNumerado } from "@/lib/tiktok/despacho";
import { avanzar, darPorBueno, estadoInicial, fraseParaVoz, type EstadoEscaneo } from "@/lib/tiktok/preparar";

/**
 * Pitidos sin archivos: agudo si bien —uno por par: dos pares, dos
 * pitidos, para que se oiga cuántos van en la caja—, grave y doble si mal.
 */
function pitar(bien: boolean, veces = 1) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const tono = (f: number, t0: number, dur: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime + t0);
      o.start(ctx.currentTime + t0);
      o.stop(ctx.currentTime + t0 + dur);
    };
    if (bien) {
      const n = Math.min(Math.max(1, veces), 6);
      for (let i = 0; i < n; i++) tono(1200, i * 0.16, 0.09);
    } else {
      tono(300, 0, 0.15);
      tono(300, 0.2, 0.15);
    }
  } catch {
    /* sin audio, sin drama */
  }
}

/**
 * La bocina dice cuántos pares y de qué, con la voz en español del propio
 * navegador. Corta lo que estuviera diciendo: el siguiente escaneo manda.
 */
function hablar(texto: string) {
  try {
    const s = window.speechSynthesis;
    if (!s) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = "es-MX";
    const voz = s.getVoices().find((v) => v.lang.toLowerCase().startsWith("es-mx")) ??
      s.getVoices().find((v) => v.lang.toLowerCase().startsWith("es"));
    if (voz) u.voice = voz;
    u.rate = 1.05;
    s.speak(u);
  } catch {
    /* sin voz, sin drama */
  }
}

/**
 * La estación de preparar: un solo campo que recibe lo que dispare el
 * escáner (el escáner teclea el código y manda Enter). La lógica de qué
 * sigue vive en `avanzar`, probada aparte; aquí solo se muestra y se guarda.
 */
export function PrepararTikTok({
  corteId,
  numero,
  paquetes,
  preparadosIniciales,
  urlGuardar,
}: {
  corteId: number;
  numero: number;
  paquetes: PaqueteNumerado[];
  preparadosIniciales: number[];
  /** a dónde se manda la constancia; con sesión o con el link de empleados */
  urlGuardar?: string;
}) {
  const [estado, setEstado] = useState<EstadoEscaneo>(estadoInicial());
  const [preparados, setPreparados] = useState<Set<number>>(new Set(preparadosIniciales));
  const [codigo, setCodigo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [voz, setVoz] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setVoz(localStorage.getItem("tiktok-voz") !== "no");
      // Algunos navegadores cargan las voces tarde: pedirlas una vez las despierta.
      window.speechSynthesis?.getVoices();
    } catch {
      /* sin localStorage, la voz queda encendida */
    }
  }, []);

  function alternarVoz() {
    setVoz((v) => {
      try {
        localStorage.setItem("tiktok-voz", v ? "no" : "si");
      } catch {
        /* nada */
      }
      return !v;
    });
  }

  useEffect(() => {
    input.current?.focus();
  }, [estado.paso]);

  async function aplicar(siguiente: EstadoEscaneo) {
    setCodigo("");
    if (siguiente.error) {
      pitar(false);
      if (voz) hablar("No cuadra");
      setEstado(siguiente);
      return;
    }
    pitar(true, siguiente.pitidos);

    // Al identificar el paquete (llegar a "producto" desde otro paso o con
    // otro paquete), la bocina dice cuántos pares y de qué.
    const recienIdentificado =
      siguiente.paso === "producto" &&
      siguiente.paquete &&
      (estado.paso !== "producto" || estado.paquete?.numero !== siguiente.paquete.numero);
    if (voz && recienIdentificado && siguiente.paquete) {
      window.setTimeout(() => hablar(fraseParaVoz(siguiente.paquete as NonNullable<typeof siguiente.paquete>)), siguiente.pitidos * 160);
    } else if (voz && siguiente.paso === "listo") {
      hablar("Listo");
    }

    if (siguiente.paso === "listo" && siguiente.paquete) {
      setGuardando(true);
      try {
        const r = await fetch(urlGuardar ?? `/api/tiktok/cortes/${corteId}/preparar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            numero: siguiente.paquete.numero,
            orderId: siguiente.paquete.orderId,
            packageId: siguiente.paquete.packageId,
            escaneos: siguiente.escaneos,
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
        setPreparados((p) => new Set([...p, siguiente.paquete!.numero]));
        setEstado({ ...estadoInicial(), indicacion: siguiente.indicacion });
      } catch (e) {
        pitar(false);
        setEstado({ ...siguiente, paso: "listo", error: (e as Error).message });
      } finally {
        setGuardando(false);
      }
      return;
    }
    setEstado(siguiente);
  }

  const escanear = (valor: string) => aplicar(avanzar(estado, valor, numero, paquetes, preparados));
  const manual = () => aplicar(darPorBueno(estado));
  const hayManuales = estado.paso === "producto" && estado.faltantes.some((f) => !f.fnsku && f.faltan > 0);

  const hechos = paquetes.filter((p) => preparados.has(p.numero)).length;
  const colorPaso =
    estado.error ? "var(--estado-critico)" : estado.paso === "inicio" ? "var(--ink-1)" : "var(--acento)";

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <section className="tarjeta p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Corte #{numero}</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={alternarVoz}
              aria-pressed={voz}
              title={voz ? "Silenciar la voz" : "Encender la voz"}
              className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs"
              style={{ borderColor: "var(--grid)", color: voz ? "var(--acento)" : "var(--ink-2)" }}
            >
              {voz ? <Volume2 size={14} /> : <VolumeX size={14} />}
              {voz ? "Voz" : "Sin voz"}
            </button>
            <span className="cifra text-sm" style={{ color: "var(--ink-2)" }}>
              {hechos} / {paquetes.length} preparados
            </span>
          </div>
        </div>

        <div
          className="mt-4 rounded-lg p-4"
          style={{ background: estado.error ? "color-mix(in oklab, var(--estado-critico) 12%, transparent)" : "var(--acento-suave)" }}
        >
          <div className="text-[10px] font-extrabold uppercase tracking-[0.12em]" style={{ color: "var(--ink-muted)" }}>
            {estado.paso === "inicio" ? "Etiqueta" : estado.paso === "etiqueta" ? "Etiqueta" : estado.paso === "producto" ? "Producto" : "Listo"}
          </div>
          <p className="mt-1 text-base font-semibold" style={{ color: colorPaso }}>
            {estado.error ?? estado.indicacion}
          </p>
          {estado.paquete && estado.paso !== "inicio" ? (
            <ul className="mt-2 text-sm">
              {estado.paquete.pares.map((x) => {
                const f = estado.faltantes.find((y) => y.sku === x.sku);
                return (
                  <li key={x.sku}>
                    <span className="font-medium">{x.sku}</span> × {x.pares}
                    {x.fnsku ? <span style={{ color: "var(--ink-2)" }}> · {x.fnsku}</span> : <span style={{ color: "var(--estado-alerta)" }}> · sin FNSKU</span>}
                    {f && estado.paso === "producto" ? <span style={{ color: "var(--ink-2)" }}> · faltan {f.faltan}</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!guardando) void escanear(codigo);
          }}
        >
          <ScanLine size={18} style={{ color: "var(--ink-2)" }} />
          <input
            ref={input}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Escanea aquí"
            autoComplete="off"
            className="flex-1 rounded-lg border px-3 py-2 text-lg"
            style={{ borderColor: "var(--grid)" }}
          />
          <button type="submit" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--grid)" }}>
            Enter
          </button>
          <button
            type="button"
            onClick={() => setEstado(estadoInicial())}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--grid)" }}
          >
            Reiniciar
          </button>
        </form>
        {hayManuales ? (
          <button
            type="button"
            onClick={manual}
            disabled={guardando}
            className="mt-3 rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "var(--estado-alerta)", color: "var(--estado-alerta)" }}
          >
            Dar por bueno sin escanear (queda registrado como manual)
          </button>
        ) : null}
        <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>
          Escanea la etiqueta: el sistema dice qué va adentro y pita una vez por par. Luego el
          producto, un escaneo por par. Si algo no cuadra suena grave y no avanza. También puedes
          empezar por el renglón de la hoja.
        </p>
      </section>

      <section className="tarjeta overflow-hidden">
        <h2 className="px-4 pt-4 text-sm font-semibold">Renglones</h2>
        <ul className="mt-2 max-h-[70vh] overflow-y-auto">
          {paquetes.map((p) => {
            const hecho = preparados.has(p.numero);
            const actual = estado.paquete?.numero === p.numero && estado.paso !== "inicio";
            return (
              <li
                key={`${p.orderId}-${p.packageId}`}
                className="flex items-center gap-2 px-4 py-1.5 text-sm hairline"
                style={{ background: actual ? "var(--acento-suave)" : "transparent", color: hecho ? "var(--ink-2)" : "var(--ink-1)" }}
              >
                {hecho ? <CheckCircle2 size={15} style={{ color: "var(--exito-texto)" }} /> : <Circle size={15} style={{ color: "var(--grid)" }} />}
                <span className="cifra w-8">#{p.numero}</span>
                <span className="min-w-0 flex-1 truncate">
                  {p.pares.map((x) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ")}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
