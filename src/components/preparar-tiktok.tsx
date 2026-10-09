"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Keyboard, ScanLine, Volume2, VolumeX } from "lucide-react";
import { Aviso, Ayuda } from "@/components/ui/pagina";
import { codigosDeProducto } from "@/lib/tiktok/codigos";
import type { PaqueteNumerado } from "@/lib/tiktok/despacho";
import { avanzar, darPorBueno, estadoInicial, fraseDeCompletado, fraseParaVoz, type EstadoEscaneo } from "@/lib/tiktok/preparar";
import {
  MS_REINTENTO_COLA,
  agregarACola,
  esErrorDeRed,
  guardarCola,
  leerCola,
  quitarDeCola,
  textoDeCola,
  type PendienteGuardar,
} from "@/lib/tiktok/cola-preparados";
import { hablar, pitar } from "./sonido-tiktok";

function almacenLocal(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
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
  // En una tablet, el escáner teclea solo: el campo recibe el código sin que
  // haga falta el teclado en pantalla, que tapa todo. Se apaga con
  // inputMode="none" y se enciende solo cuando alguien quiere teclear.
  const [teclado, setTeclado] = useState(false);
  // El paquete al que se le está pidiendo la clave de supervisor (cuadro
  // propio con teclado de DÍGITOS, no `window.prompt`: en la tablet el
  // prompt abría el teclado completo; pedido del dueño, 29-sep-2026).
  const [pidiendoClave, setPidiendoClave] = useState<PaqueteNumerado | null>(null);
  const [clave, setClave] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // La COLA de constancias que no alcanzaron a llegar al servidor por falta
  // de señal (`cola-preparados.ts`): el paquete se da por preparado en este
  // dispositivo y se manda solo cuando vuelve el wifi. `colaRef` es la copia
  // viva para que el reintento no trabaje con una lista vieja.
  const [cola, setCola] = useState<PendienteGuardar[]>([]);
  const colaRef = useRef<PendienteGuardar[]>([]);
  const enviandoCola = useRef(false);
  const [enLinea, setEnLinea] = useState(true);
  const [sinGuardar, setSinGuardar] = useState<string[]>([]);
  const destino = urlGuardar ?? `/api/tiktok/cortes/${corteId}/preparar`;

  function fijarCola(siguiente: PendienteGuardar[]) {
    colaRef.current = siguiente;
    setCola(siguiente);
    guardarCola(almacenLocal(), corteId, siguiente);
  }

  /** Manda UNA constancia. Lanza TypeError (red) o Error (el servidor la rechazó). */
  async function mandarConstancia(datos: { numero: number; orderId: string; packageId: string; escaneos: string[] }) {
    const r = await fetch(destino, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
  }

  /** Reintenta la cola en orden; se detiene en el primer fallo de red y sigue cuando vuelva. */
  async function vaciarCola() {
    if (enviandoCola.current || !colaRef.current.length) return;
    enviandoCola.current = true;
    try {
      for (const p of [...colaRef.current]) {
        try {
          await mandarConstancia({ numero: p.numero, orderId: p.orderId, packageId: p.packageId, escaneos: p.escaneos });
          fijarCola(quitarDeCola(colaRef.current, p));
        } catch (e) {
          if (esErrorDeRed(e)) break;
          // El servidor la rechazó: no es cosa de señal, se saca de la cola y se avisa.
          fijarCola(quitarDeCola(colaRef.current, p));
          setSinGuardar((prev) => [...prev, `#${p.numero}: ${(e as Error).message}`]);
        }
      }
    } finally {
      enviandoCola.current = false;
    }
  }

  useEffect(() => {
    // Lo que quedó en este dispositivo de una sesión anterior sigue contando
    // como preparado y se vuelve a intentar.
    const guardada = leerCola(almacenLocal(), corteId);
    if (guardada.length) {
      colaRef.current = guardada;
      setCola(guardada);
      setPreparados((p) => new Set([...p, ...guardada.map((x) => x.numero)]));
    }
    setEnLinea(typeof navigator === "undefined" ? true : navigator.onLine);
    const alVolver = () => {
      setEnLinea(true);
      void vaciarCola();
    };
    const alCaer = () => setEnLinea(false);
    window.addEventListener("online", alVolver);
    window.addEventListener("offline", alCaer);
    const reloj = window.setInterval(() => void vaciarCola(), MS_REINTENTO_COLA);
    void vaciarCola();
    return () => {
      window.removeEventListener("online", alVolver);
      window.removeEventListener("offline", alCaer);
      window.clearInterval(reloj);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corteId]);

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
    } else if (voz && siguiente.paso === "listo" && siguiente.paquete) {
      hablar(fraseDeCompletado(siguiente.paquete));
    }

    if (siguiente.paso === "listo" && siguiente.paquete) {
      setGuardando(true);
      const datos = {
        numero: siguiente.paquete.numero,
        orderId: siguiente.paquete.orderId,
        packageId: siguiente.paquete.packageId,
        escaneos: siguiente.escaneos,
      };
      try {
        await mandarConstancia(datos);
        setPreparados((p) => new Set([...p, datos.numero]));
        setEstado({ ...estadoInicial(), indicacion: siguiente.indicacion });
        setEnLinea(true);
        void vaciarCola();
      } catch (e) {
        if (esErrorDeRed(e)) {
          // Sin señal: la constancia se queda en este dispositivo y el
          // paquete cuenta como preparado; se manda sola al volver el wifi.
          fijarCola(agregarACola(colaRef.current, { ...datos, en: new Date().toISOString() }));
          setPreparados((p) => new Set([...p, datos.numero]));
          setEnLinea(false);
          setEstado({
            ...estadoInicial(),
            indicacion: `#${datos.numero} PREPARADO (sin señal: guardado en este dispositivo, se manda solo al volver el wifi). Escanea la siguiente etiqueta.`,
          });
        } else {
          pitar(false);
          setEstado({ ...siguiente, paso: "listo", error: (e as Error).message });
        }
      } finally {
        setGuardando(false);
      }
      return;
    }
    setEstado(siguiente);
  }

  const escanear = (valor: string) => aplicar(avanzar(estado, valor, numero, paquetes, preparados));

  /**
   * Sin escanear, con la clave del supervisor: para cuando el código no se
   * deja leer. El servidor valida la clave y lo deja registrado como
   * SUPERVISOR en la constancia, no como escaneo.
   */
  function confirmarConClave(p: PaqueteNumerado) {
    setPidiendoClave(p);
    setClave("");
  }

  async function enviarClave() {
    const p = pidiendoClave;
    const pin = clave.trim();
    if (!p || !pin) return;
    setGuardando(true);
    try {
      const r = await fetch(urlGuardar ?? `/api/tiktok/cortes/${corteId}/preparar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero: p.numero, orderId: p.orderId, packageId: p.packageId, sinEscanear: true, pin }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      pitar(true, 1);
      if (voz) hablar(`${p.numero} confirmado con clave`);
      setPreparados((prev) => new Set([...prev, p.numero]));
      setPidiendoClave(null);
      setClave("");
      setEstado({ ...estadoInicial(), indicacion: `#${p.numero} confirmado con clave, sin escanear. Escanea la siguiente etiqueta.` });
    } catch (e) {
      pitar(false);
      // La clave la valida el servidor: sin señal no hay cómo, y se dice.
      const m = esErrorDeRed(e) ? "Sin señal: la clave de supervisor se valida en el servidor. Inténtalo cuando vuelva el wifi (o escanea el paquete)." : (e as Error).message;
      if (esErrorDeRed(e)) setEnLinea(false);
      setEstado({ ...estado, error: m });
    } finally {
      setGuardando(false);
    }
  }

  const manual = () => aplicar(darPorBueno(estado));
  const avisoCola = textoDeCola(cola.length, enLinea);
  const hayManuales = estado.paso === "producto" && estado.faltantes.some((f) => !f.codigos.length && f.faltan > 0);

  const hechos = paquetes.filter((p) => preparados.has(p.numero)).length;
  const colorPaso =
    estado.error ? "var(--estado-critico)" : estado.paso === "inicio" ? "var(--ink-1)" : "var(--acento)";

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <section className="tarjeta p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="seccion-titulo">Corte #{numero}</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={alternarVoz}
              aria-pressed={voz}
              title={voz ? "Silenciar la voz" : "Encender la voz"}
              className="boton boton-borde boton-chico"
              style={{ color: voz ? "var(--acento)" : "var(--ink-2)" }}
            >
              {voz ? <Volume2 size={14} /> : <VolumeX size={14} />}
              {voz ? "Voz" : "Sin voz"}
            </button>
            <span className="cifra text-sm texto-2">
              {hechos} / {paquetes.length} preparados
            </span>
          </div>
        </div>
        {avisoCola || !enLinea ? (
          <Aviso tono="alerta" className="mt-2">
            {enLinea ? "" : "Sin señal de wifi. Puedes seguir escaneando: lo preparado se guarda en este dispositivo. "}
            {avisoCola ?? ""}
          </Aviso>
        ) : null}
        {sinGuardar.length ? (
          <Aviso tono="critico" className="mt-2">
            El servidor rechazó {sinGuardar.length === 1 ? "una constancia" : `${sinGuardar.length} constancias`}: {sinGuardar.join(" · ")}
          </Aviso>
        ) : null}

        <div
          className="mt-4 rounded-lg p-4"
          style={{ background: estado.error ? "var(--critico-suave)" : "var(--acento-suave)" }}
        >
          <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] texto-tenue">
            {estado.paso === "inicio" ? "Etiqueta" : estado.paso === "etiqueta" ? "Etiqueta" : estado.paso === "producto" ? "Producto" : "Listo"}
          </div>
          <p className="mt-1 text-base font-semibold" style={{ color: colorPaso }}>
            {estado.error ?? estado.indicacion}
          </p>
          {estado.paquete && estado.paso !== "inicio" ? (
            <ul className="mt-2 text-sm">
              {estado.paquete.pares.map((x) => {
                const f = estado.faltantes.find((y) => y.sku === x.sku);
                const codigos = f?.codigos ?? codigosDeProducto(x);
                return (
                  <li key={x.sku}>
                    <span className="font-medium">{x.sku}</span> × {x.pares}
                    {codigos.length ? (
                      <span className="texto-2"> · {codigos.join(" o ")}</span>
                    ) : (
                      <span style={{ color: "var(--estado-alerta)" }}> · sin código: "Dar por bueno"</span>
                    )}
                    {f && estado.paso === "producto" ? <span className="texto-2"> · faltan {f.faltan}</span> : null}
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
          <ScanLine size={18} className="texto-2" />
          <input
            ref={input}
            value={codigo}
            inputMode={teclado ? "text" : "none"}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Escanea aquí"
            autoComplete="off"
            className="flex-1 rounded-lg border px-3 py-2 text-lg"
            style={{ borderColor: "var(--grid)" }}
          />
          <button type="submit" className="boton boton-borde">
            Enter
          </button>
          <button
            type="button"
            onClick={() => {
              setTeclado((t) => !t);
              window.setTimeout(() => input.current?.focus(), 0);
            }}
            aria-pressed={teclado}
            title={teclado ? "Ocultar el teclado en pantalla" : "Teclear a mano"}
            className="boton boton-borde px-2"
            style={{ color: teclado ? "var(--acento)" : "var(--ink-2)" }}
          >
            <Keyboard size={16} />
          </button>
          <button
            type="button"
            onClick={() => setEstado(estadoInicial())}
            className="boton boton-borde"
          >
            Reiniciar
          </button>
        </form>
        {estado.paquete && estado.paso !== "inicio" && estado.paso !== "listo" ? (
          <button
            type="button"
            onClick={() => confirmarConClave(estado.paquete as PaqueteNumerado)}
            disabled={guardando}
            className="boton boton-borde mt-3 mr-2"
          >
            Confirmar #{estado.paquete.numero} sin escanear (clave)
          </button>
        ) : null}
        {hayManuales ? (
          <button
            type="button"
            onClick={manual}
            disabled={guardando}
            className="boton boton-borde mt-3 whitespace-normal text-left"
            style={{ borderColor: "var(--estado-alerta)", color: "var(--alerta-texto)" }}
          >
            Dar por bueno sin escanear los que no tienen FNSKU (queda registrado como manual)
          </button>
        ) : null}
        <div className="mt-3">
          <Ayuda titulo="¿Cómo se prepara?">
            <p>
              Escanea la etiqueta: el sistema dice qué va adentro y pita una vez por par. Luego el producto, un escaneo por
              par. Si algo no cuadra suena grave y no avanza. También puedes empezar por el renglón de la hoja.
            </p>
          </Ayuda>
        </div>
      </section>

      {pidiendoClave ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enviarClave();
          }}
          className="tarjeta p-4"
          style={{ borderColor: "var(--acento)" }}
        >
          <p className="text-sm font-semibold">
            Confirmar #{pidiendoClave.numero} sin escanear
          </p>
          <p className="mt-1 text-xs texto-2">
            {pidiendoClave.pares.map((x) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ")} · pedido {pidiendoClave.orderId}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              autoFocus
              value={clave}
              onChange={(e) => setClave(e.target.value.replace(/\D/g, ""))}
              placeholder="Clave de supervisor"
              className="cifra w-48 rounded-lg border px-3 py-2 text-lg tracking-widest"
              style={{ borderColor: "var(--grid)" }}
            />
            <button
              type="submit"
              disabled={guardando || !clave}
              className="boton boton-primario"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => {
                setPidiendoClave(null);
                setClave("");
                input.current?.focus();
              }}
              className="boton boton-borde"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <h2 className="seccion-titulo px-4 pt-4">Renglones</h2>
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
                {!hecho ? (
                  <button
                    type="button"
                    onClick={() => confirmarConClave(p)}
                    disabled={guardando}
                    title="Dar por preparado sin escanear, con la clave de supervisor"
                    className="boton boton-borde boton-chico"
                  >
                    Clave
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
