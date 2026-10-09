"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Eye, FileText, PackageX, Printer, RefreshCw, ScanLine, Scissors, ShieldCheck } from "lucide-react";
import { agruparErrores } from "@/lib/tiktok/despacho";
import { contarSinTiempo, hayQueSeguir } from "@/lib/tiktok/lunes";
import { avanceDeTomos, tomosDeCorte } from "@/lib/tiktok/despacho";
import { etiquetaDeModelos, type PendientesPorModelo } from "@/lib/tiktok/corte-modelos";
import { Aviso, Ayuda, Seccion } from "@/components/ui/pagina";

/** Cuántos tomos de etiquetas se bajan a la vez al imprimir (cada uno ~21 MB). */
const TOMOS_A_LA_VEZ = 3;

export interface CorteResumen {
  id: number;
  numero: number;
  creadoEn: string;
  pedidos: number;
  pares: number;
  handover: string;
  errores: { orderId: string; error: string }[];
  /** paquetes que ya pasaron los tres escaneos; null = no se pudo leer */
  preparados: number | null;
  /** pedidos cancelados después del corte: conservan su número, ya no faltan */
  cancelados?: number;
  /** pedidos que ya se fueron con el repartidor sin escanearse: resueltos, ya no faltan */
  enviados?: number;
  /** filtro de modelos con el que nació (corte por modelo); null = corte general */
  modelos?: string[] | null;
}

/** Los pedidos del corte que siguen vivos: los que entraron menos los cancelados después. */
function vivosDe(c: CorteResumen): number {
  return Math.max(0, c.pedidos - (c.cancelados ?? 0));
}

/** Lo que ya no falta: escaneado en la estación, o ya en camino sin escanear. */
function listosDe(c: CorteResumen): number | null {
  return c.preparados == null ? null : c.preparados + (c.enviados ?? 0);
}

function cuando(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * La rutina de la mañana en un botón. "Hacer corte" confirma en TikTok todo
 * lo pendiente y lo deja guardado; de cada corte salen las etiquetas y la
 * lista de empaque, en el mismo orden y con los mismos números, y se
 * reimprimen cuantas veces haga falta.
 */
export function DespachoTikTok({ pendientes, cortes, porModelo }: { pendientes: number; cortes: CorteResumen[]; porModelo: PendientesPorModelo }) {
  const router = useRouter();
  const [handover, setHandover] = useState<"PICKUP" | "DROP_OFF">("PICKUP");
  // Corte por MODELO (dueño, 5-oct-2026): marcar uno o varios modelos y el
  // corte toma solo los paquetes que son únicamente de esos modelos; los
  // revueltos se quedan para el corte general. Se apaga solo al terminar.
  const [soloModelos, setSoloModelos] = useState<string[]>([]);
  const [preparandoTodo, setPreparandoTodo] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ronda, setRonda] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulacion, setSimulacion] = useState<any>(null);
  const [simulando, setSimulando] = useState(false);
  // Los faltantes de cada corte, según se piden: el renglón del corte los
  // enseña abiertos abajo, sin cambiar de pantalla.
  const [faltantes, setFaltantes] = useState<Record<number, any>>({});
  const [pidiendoFaltantes, setPidiendoFaltantes] = useState<number | null>(null);
  const [actualizando, setActualizando] = useState(false);
  // Confirmar aunque el stock diga cero: se apaga solo después de cada corte.
  const [sinDefensa, setSinDefensa] = useState(false);
  // Las etiquetas de un corte grande: el servidor arma tomos de 200 guías y
  // aquí se juntan en UN PDF antes de abrirlo. Texto de avance por corte.
  const [armandoEtiquetas, setArmandoEtiquetas] = useState<Record<number, string>>({});
  // Qué tomos ya están guardados por corte (el servidor los arma por atrás
  // en cuanto termina el corte; ver `calentarEtiquetas`).
  const [etiquetas, setEtiquetas] = useState<Record<number, { tomos: number; listos: number; completo: boolean; ocupado?: boolean; guiasSinBajar?: number }>>({});
  const calentando = useRef<Set<number>>(new Set());
  /** cuántos pendientes entrarían con el filtro de modelo marcado */
  const pendientesFiltrados = porModelo.modelos.filter((m) => soloModelos.includes(m.modelo)).reduce((a, m) => a + m.pedidos, 0);

  /**
   * UN solo PDF con todas las etiquetas del corte. El servidor arma (y
   * guarda) cada tomo de `PAQUETES_POR_TOMO` guías por separado —entero no
   * cabe en la función de Vercel: el #36 del 22-sep-2026 eran 916 guías,
   * ~96 MB— y el navegador los junta con pdf-lib y lo abre para imprimir
   * (decisión del dueño: «por atrás se hagan 200 guías cada vez y el PDF
   * sí me lo presentes junto»). Los tomos ya guardados se bajan DIRECTO del
   * bucket con un enlace firmado, varios a la vez (por la función de Vercel
   * cada uno tardaba ~10 s: 28-sep-2026, «me metí y me sale otra vez eso»).
   * La pestaña se abre en el clic (si no, el navegador la bloquea) y recibe
   * el PDF cuando está listo.
   */
  async function imprimirEtiquetas(c: CorteResumen) {
    const total = tomosDeCorte(c.pedidos);
    const ventana = window.open("", "_blank");
    if (ventana) {
      ventana.document.write(`<p style="font-family:sans-serif;padding:24px">Bajando las etiquetas del corte #${c.numero}… no cierres esta pestaña.</p>`);
    }
    const avance = (t: string) => {
      setArmandoEtiquetas((a) => ({ ...a, [c.id]: t }));
      if (ventana && !ventana.closed) {
        const p = ventana.document.querySelector("p");
        if (p) p.textContent = `Corte #${c.numero}: ${t}`;
      }
    };
    // Un tomo: si ya está guardado, el servidor contesta un ENLACE al bucket
    // y se baja directo de ahí (por la función de Vercel un tomo de 21 MB
    // tardaba ~10 s); si no, el servidor lo arma y manda el PDF.
    const bajarTomo = async (tomo: number): Promise<ArrayBuffer> => {
      const r = await fetch(`/api/tiktok/cortes/${c.id}/etiquetas?tomo=${tomo}&formato=enlace`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `No se pudo armar el tomo ${tomo} de ${total}.`);
      }
      const tipo = r.headers.get("content-type") ?? "";
      if (tipo.includes("application/json")) {
        const { url } = (await r.json()) as { url?: string };
        if (!url) throw new Error(`El servidor no dio el enlace del tomo ${tomo} de ${total}.`);
        const d = await fetch(url);
        if (!d.ok) throw new Error(`No se pudo bajar el tomo ${tomo} de ${total} del almacén (${d.status}).`);
        return d.arrayBuffer();
      }
      return r.arrayBuffer();
    };
    try {
      // Varios tomos a la vez (cada uno es una descarga independiente) y se
      // unen en orden cuando están todos.
      const partes: (ArrayBuffer | null)[] = Array.from({ length: total }, () => null);
      let siguiente = 0;
      let bajados = 0;
      avance(avanceDeTomos(0, total, "bajando"));
      const trabajador = async () => {
        for (;;) {
          const i = siguiente++;
          if (i >= total) return;
          partes[i] = await bajarTomo(i + 1);
          bajados++;
          avance(avanceDeTomos(bajados, total, "bajando"));
        }
      };
      await Promise.all(Array.from({ length: Math.min(TOMOS_A_LA_VEZ, total) }, trabajador));

      const { PDFDocument } = await import("pdf-lib");
      const junto = await PDFDocument.create();
      junto.setTitle(`Corte ${c.numero} · etiquetas TikTok`);
      for (let tomo = 1; tomo <= total; tomo++) {
        const bytes = partes[tomo - 1];
        if (!bytes) throw new Error(`Faltó el tomo ${tomo} de ${total}.`);
        if (total > 1) avance(avanceDeTomos(tomo, total, "uniendo"));
        const parte = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const paginas = await junto.copyPages(parte, parte.getPageIndices());
        for (const pagina of paginas) junto.addPage(pagina);
      }
      const bytes = await junto.save();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      if (ventana && !ventana.closed) ventana.location.href = url;
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `corte-${c.numero}-etiquetas.pdf`;
        a.click();
      }
      setArmandoEtiquetas((a) => {
        const { [c.id]: _quitado, ...resto } = a;
        return resto;
      });
    } catch (e) {
      if (ventana && !ventana.closed) ventana.close();
      setArmandoEtiquetas((a) => ({ ...a, [c.id]: `No se pudieron armar las etiquetas: ${(e as Error).message}` }));
    }
  }

  /**
   * Deja las etiquetas del corte armadas y guardadas en el servidor sin
   * abrir nada, y enseña el avance en el renglón del corte: el servidor
   * trabaja un rato por llamada (baja guías, arma tomos) y contesta qué
   * tomos ya están; se le vuelve a llamar hasta que estén todos. Se lanza
   * al terminar un corte y al abrir la pantalla si un corte reciente no
   * tiene sus etiquetas completas. El corte también lo arranca solo del
   * lado del servidor y el cron lo termina si esta pestaña se cierra.
   */
  function calentarEtiquetas(corteId: number) {
    if (calentando.current.has(corteId)) return;
    calentando.current.add(corteId);
    void (async () => {
      try {
        for (let intento = 0; intento < 60; intento++) {
          const r = await fetch(`/api/tiktok/cortes/${corteId}/calentar`, { method: "POST" }).catch(() => null);
          const j = r && r.ok ? await r.json().catch(() => null) : null;
          if (j && typeof j.tomos === "number") {
            setEtiquetas((e) => ({ ...e, [corteId]: { tomos: j.tomos, listos: (j.listos ?? []).length, completo: Boolean(j.completo), ocupado: Boolean(j.ocupado), guiasSinBajar: j.guiasSinBajar } }));
            if (j.completo) return;
          }
          // Ocupado (el servidor o el cron ya lo están armando) o sin
          // respuesta: se espera y se vuelve a preguntar.
          await new Promise((res) => setTimeout(res, j?.ocupado || !j ? 15_000 : 2_000));
        }
      } finally {
        calentando.current.delete(corteId);
      }
    })();
  }

  /**
   * Tira los tomos guardados del corte y los vuelve a armar por atrás: para
   * cuando una hoja salió mal («SIN GUÍA») y el tomo ya estaba guardado.
   * Las guías de cada paquete se quedan; solo se vuelven a juntar.
   */
  async function rearmarEtiquetas(c: CorteResumen) {
    if (!window.confirm(`¿Rearmar las etiquetas del corte #${c.numero}? Se tiran los tomos guardados y se vuelven a armar por atrás.`)) return;
    const r = await fetch(`/api/tiktok/cortes/${c.id}/calentar`, { method: "DELETE" }).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    if (!j || typeof j.tomos !== "number") {
      const e = r && !r.ok ? await r.json().catch(() => ({})) : {};
      setArmandoEtiquetas((a) => ({ ...a, [c.id]: `No se pudieron armar las etiquetas: ${e.error ?? "no se pudieron tirar los tomos"}` }));
      return;
    }
    setEtiquetas((e) => ({ ...e, [c.id]: { tomos: j.tomos, listos: (j.listos ?? []).length, completo: Boolean(j.completo) } }));
    calentarEtiquetas(c.id);
  }

  // Al abrir la pantalla Y cada vez que aparece un corte nuevo en la lista:
  // los cortes de las últimas 24 h que no tengan sus etiquetas completas se
  // terminan de armar por atrás. Antes solo al montar: si el navegador
  // soltaba la conexión a medio corte (Safari, «Load failed»), la ronda que
  // reintentaba volvía con `corteId: null` y nadie calentaba el corte que
  // sí se había guardado (el #45 del 1-oct-2026 se quedó así 64 minutos).
  const revisados = useRef<Set<number>>(new Set());
  const idsCortes = cortes.map((c) => c.id).join(",");
  useEffect(() => {
    const recientes = cortes.filter((c) => Date.now() - new Date(c.creadoEn).getTime() < 24 * 3_600_000);
    for (const c of recientes) {
      if (revisados.current.has(c.id)) continue;
      revisados.current.add(c.id);
      void fetch(`/api/tiktok/cortes/${c.id}/calentar`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j || typeof j.tomos !== "number") return;
          setEtiquetas((e) => ({ ...e, [c.id]: { tomos: j.tomos, listos: (j.listos ?? []).length, completo: Boolean(j.completo) } }));
          if (!j.completo) calentarEtiquetas(c.id);
        })
        .catch(() => undefined);
    }
    // Se vuelve a correr cuando cambia la lista de cortes (router.refresh
    // al terminar el corte); lo ya revisado no se vuelve a preguntar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsCortes]);

  /** Pide (o cierra) la lista de lo que quedó sin preparar en un corte. */
  async function verFaltantes(corteId: number) {
    if (faltantes[corteId]) {
      setFaltantes((f) => {
        const { [corteId]: _fuera, ...resto } = f;
        return resto;
      });
      return;
    }
    setPidiendoFaltantes(corteId);
    setError(null);
    try {
      const r = await fetch(`/api/tiktok/cortes/${corteId}/faltantes`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudieron leer los faltantes.");
      setFaltantes((f) => ({ ...f, [corteId]: j }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPidiendoFaltantes(null);
    }
  }

  async function simular() {
    setSimulando(true);
    setError(null);
    try {
      const r = await fetch(`/api/tiktok/cortes/simular${soloModelos.length ? `?modelos=${encodeURIComponent(soloModelos.join(","))}` : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo simular.");
      setSimulacion(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSimulando(false);
    }
  }

  /** Lo que se dice de un corte ya hecho. */
  function resumenDeCorte(j: any): string {
    // Sin corte guardado (nadie entró): el porqué va aquí mismo, agrupado,
    // porque no hay renglón en la lista que lo enseñe.
    if (j.corteId == null) {
      const grupos = agruparErrores(j.errores ?? []);
      const motivos = grupos.filter((g) => g.pedidos.length).map((g) => `${g.pedidos.length} ${g.pedidos.length === 1 ? "pedido" : "pedidos"}: ${g.ejemplo}`);
      return ["Ningún pedido entró al corte; no se guardó ninguno.", ...motivos].join(" ");
    }
    const partes = [
      j.unido
        ? `Se unió al corte #${j.numero} (continuaba lo que se quedó por tiempo): ${j.pedidos} pedidos y ${j.pares} pares más, confirmados en TikTok.`
        : `Corte #${j.numero}${etiquetaDeModelos(j.modelos) ? ` (${etiquetaDeModelos(j.modelos)})` : ""}: ${j.pedidos} pedidos, ${j.pares} pares confirmados en TikTok.`,
    ];
    if (j.publicados) partes.push(`${j.publicados} SKU republicados.`);
    if (j.dropOff) partes.push(`${j.dropOff} salieron como entrega en paquetería.`);
    if (j.cancelados?.length) {
      const completos = j.cancelados.filter((c: any) => c.completo).length;
      partes.push(`Defensa: ${j.cancelados.length} renglones cancelados en TikTok (${j.cancelados.map((c: any) => `${c.sku} ×${c.pares}`).join(", ")})${completos ? `, ${completos} pedidos completos` : ""}.`);
    }
    const fuera = (j.errores ?? []).filter((e: any) => e.orderId).length;
    if (fuera) partes.push(`${fuera} pedidos no entraron (abajo el motivo).`);
    if (j.al3pl?.sinEndpoint) partes.push("Salidas al 3PL: Industher todavía no tiene el endpoint; se reintentan solas.");
    else if (j.al3pl?.error) partes.push(`Salidas al 3PL: ${j.al3pl.error}`);
    else if (j.al3pl?.confirmadas) {
      // Se dicen PARES, que es lo que se descuenta del estante: el #38
      // (24-sep-2026) decía «683 salidas» contra 696 pares confirmados y
      // parecía que faltaban 13, cuando eran 13 renglones de dos pares.
      const pares = j.al3pl.paresConfirmados ?? j.al3pl.confirmadas;
      partes.push(`${pares} pares descontados en Industher (${j.al3pl.confirmadas} renglones pedido + SKU).`);
    }
    return partes.join(" ");
  }

  /**
   * «Actualizar»: vuelve a leer en TikTok lo que sigue sin preparar en los
   * cortes que se ven y dice qué dejó de faltar. Los faltantes abiertos se
   * vuelven a pedir para que la lista de abajo también cambie.
   */
  async function actualizar() {
    setActualizando(true);
    setAviso(null);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/cortes/releer", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo actualizar.");
      const partes: string[] = [];
      if (!j.releidos) partes.push("No había pedidos sin preparar que releer.");
      else {
        partes.push(`Se releyeron ${j.releidos} pedidos de ${j.cortes} cortes.`);
        if (j.enviados?.length) partes.push(`${j.enviados.length} ya salieron sin escanearse: ${j.enviados.join(", ")}.`);
        if (j.cancelados?.length) partes.push(`${j.cancelados.length} se cancelaron: ${j.cancelados.join(", ")}.`);
        if (!j.enviados?.length && !j.cancelados?.length) partes.push("Nada cambió: lo que falta sigue faltando.");
      }
      for (const a of j.avisos ?? []) partes.push(String(a));
      setAviso(partes.join(" "));
      const abiertos = Object.keys(faltantes).map(Number);
      setFaltantes({});
      router.refresh();
      for (const id of abiertos) {
        const rf = await fetch(`/api/tiktok/cortes/${id}/faltantes`);
        if (rf.ok) {
          const jf = await rf.json();
          setFaltantes((f) => ({ ...f, [id]: jf }));
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActualizando(false);
    }
  }

  /**
   * Un clic, todas las rondas. Cada llamada confirma ~300 pedidos en los 5
   * minutos de Vercel; si dejó pedidos por tiempo, la pantalla vuelve a
   * lanzar el corte sola, sin tope de rondas (decisión del dueño,
   * 22-sep-2026: «que no tenga que picarle otra vez», «no quiero que
   * pongas máximos»), y el servidor une cada ronda al mismo corte.
   * Hay que dejar la pestaña abierta: la pantalla es la que encadena.
   */
  async function hacerCorte(modo?: "lunes" | "ayer") {
    setOcupado(true);
    setAviso(null);
    setError(null);
    setRonda(null);
    const resumenes: string[] = [];
    try {
      // Sin tope de rondas (decisión del dueño): se sigue hasta que no quede
      // nada por tiempo, o hasta que una ronda no avance.
      for (let n = 1; ; n++) {
        const cuerpo = JSON.stringify({
          handover,
          ...(modo ? { modo } : {}),
          ...(sinDefensa ? { sinDefensa: true } : {}),
          ...(soloModelos.length ? { soloModelos } : {}),
        });
        // El corte tarda hasta 5 min y el navegador (Safari en el iPhone,
        // sobre todo) suelta la conexión a medias con «Load failed» aunque
        // el servidor siga trabajando y guarde el corte. Si eso pasa, se
        // espera y se vuelve a pedir: mientras el corte anterior siga en
        // curso el servidor contesta 409 y se sigue esperando; cuando
        // termine, la siguiente ronda toma lo que quedó (y se une al mismo
        // corte). Hasta 20 min de espera (la función del corte vive hasta 800 s); después sí es error.
        // La función del corte vive hasta 800 s: la espera por un 409 o una
        // conexión perdida tiene que aguantar más que eso.
        const limiteEspera = Date.now() + 20 * 60_000;
        let j: any;
        let r: Response | null = null;
        for (;;) {
          try {
            r = await fetch("/api/tiktok/cortes", { method: "POST", headers: { "Content-Type": "application/json" }, body: cuerpo });
            j = await r.json();
          } catch (e) {
            if (Date.now() > limiteEspera) throw new Error(`Se perdió la conexión con el servidor (${(e as Error).message}). Revisa la lista de cortes: el corte pudo haberse guardado; vuelve a darle al botón para seguir con lo que falte.`);
            setRonda(`Se perdió la conexión con el servidor; el corte sigue trabajando por atrás. Reintentando en 15 s… no cierres esta pestaña.`);
            await new Promise((res) => setTimeout(res, 15_000));
            continue;
          }
          if (r.status === 409) {
            if (Date.now() > limiteEspera) throw new Error(j.error ?? "Hay un corte en curso.");
            setRonda(`Hay un corte en curso en el servidor; se espera a que termine para seguir con lo que falte… no cierres esta pestaña.`);
            await new Promise((res) => setTimeout(res, 15_000));
            continue;
          }
          break;
        }
        if (!r || !r.ok) throw new Error(j?.error ?? "No se pudo hacer el corte.");
        const cortesRonda: any[] = j.modo === "lunes" || j.modo === "ayer" ? (j.cortes ?? []) : [j];
        resumenes.push(...cortesRonda.map((c: any) => resumenDeCorte(c)));
        // La lista de cortes se refresca UNA vez, al terminar la cadena (o al
        // fallar): refrescar en cada ronda volvía a armar la pantalla entera
        // mientras el servidor seguía cortando. Lo de cada ronda se dice
        // arriba en el aviso.
        // Los tomos de etiquetas se arman por atrás desde ya (el servidor
        // guarda cada uno); al darle a «Etiquetas PDF» solo se juntan.
        for (const c of cortesRonda) if (c.corteId != null && !hayQueSeguir([c])) calentarEtiquetas(c.corteId);
        if (!hayQueSeguir(cortesRonda)) {
          if (j.aviso) resumenes.push(j.aviso);
          break;
        }
        const faltan = cortesRonda.reduce((a: number, c: any) => a + contarSinTiempo(c.errores ?? []), 0);
        setRonda(`Ronda ${n} lista; quedaron ${faltan} pedidos por tiempo. Se vuelve a lanzar el corte solo (ronda ${n + 1})… no cierres esta pestaña.`);
        setAviso(resumenes.join(" · "));
      }
      setAviso(resumenes.join(" · "));
      setSimulacion(null);
      setSinDefensa(false);
      setSoloModelos([]);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      if (resumenes.length) {
        setAviso(resumenes.join(" · "));
        // Alguna ronda sí guardó su corte: que aparezca en la lista.
        router.refresh();
      }
    } finally {
      setRonda(null);
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Seccion
        titulo={pendientes ? `${pendientes} pedidos por despachar` : "Nada por despachar"}
        acciones={
          <>
            <select
              value={handover}
              onChange={(e) => setHandover(e.target.value as "PICKUP" | "DROP_OFF")}
              className="rounded-lg border px-2 py-1.5 text-sm"
              aria-label="Cómo se entregan los paquetes"
            >
              <option value="PICKUP">Pasa el repartidor</option>
              <option value="DROP_OFF">Los llevo a la paquetería</option>
            </select>
            <button
              onClick={actualizar}
              disabled={actualizando}
              className="boton boton-borde boton-chico"
              title="Vuelve a leer en TikTok lo que sigue sin preparar en los cortes recientes: lo que ya se envió o se canceló deja de faltar"
            >
              <RefreshCw size={14} className={actualizando ? "animate-spin" : undefined} />
              {actualizando ? "Leyendo TikTok…" : "Actualizar"}
            </button>
            <button
              onClick={simular}
              disabled={simulando || !pendientes}
              className="boton boton-borde boton-chico"
              title="Ver qué haría el corte sin confirmar nada"
            >
              <Eye size={14} />
              {simulando ? "Simulando…" : "Simular"}
            </button>
          </>
        }
      >
        {/* Barra del corte: los tres botones, el filtro por modelo y «sin defensa» juntos. */}
        <div className="rounded-lg border" style={{ borderColor: "var(--grid)" }}>
          <div className="flex flex-wrap items-center gap-2 p-3">
            <span className="texto-2 mr-1 text-xs font-semibold">Corte</span>
            <button
              onClick={() => hacerCorte("ayer")}
              disabled={ocupado || !pendientes}
              className="boton boton-borde"
              title="Un corte con todo lo pendiente hasta ayer a las 23:59 (hora de México) y lo más viejo; lo de hoy se queda pendiente para ir adelantando un día. Si se acaba el tiempo, se relanza solo hasta terminar"
            >
              <CalendarClock size={14} />
              {ocupado ? "Confirmando…" : "Corte ayer"}
            </button>
            <button
              onClick={() => hacerCorte("lunes")}
              disabled={ocupado || !pendientes}
              className="boton boton-borde"
              title="Dos cortes: primero TODO lo pendiente hasta el domingo a las 23:59 (viernes, sábado, domingo y lo más viejo) y luego solo lo del lunes"
            >
              <CalendarClock size={14} />
              {ocupado ? "Confirmando…" : "Corte lunes"}
            </button>
            <button
              onClick={() => hacerCorte()}
              disabled={ocupado || !pendientes}
              className="boton boton-primario"
            >
              <Scissors size={14} />
              {ocupado ? "Confirmando en TikTok…" : soloModelos.length ? `Hacer corte ${etiquetaDeModelos(soloModelos)} (${pendientesFiltrados})` : `Hacer corte (${pendientes})`}
            </button>
          </div>
          {porModelo.modelos.length ? (
            <div className="hairline border-t p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  Solo estos modelos
                  {soloModelos.length ? (
                    <span className="ml-2 font-normal texto-2">
                      {etiquetaDeModelos(soloModelos)} · {pendientesFiltrados} pedidos
                    </span>
                  ) : (
                    <span className="ml-2 font-normal texto-2">
                      marca uno o varios para despacharlos aparte
                    </span>
                  )}
                </span>
                {soloModelos.length ? (
                  <button onClick={() => setSoloModelos([])} disabled={ocupado} className="boton boton-fantasma boton-chico">
                    Quitar filtro
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {porModelo.modelos.map((m) => {
                  const marcado = soloModelos.includes(m.modelo);
                  return (
                    <button
                      key={m.modelo}
                      type="button"
                      disabled={ocupado}
                      onClick={() =>
                        setSoloModelos((s) => (s.includes(m.modelo) ? s.filter((x) => x !== m.modelo) : [...s, m.modelo]))
                      }
                      className="rounded-full border px-3 py-1 text-xs disabled:opacity-60"
                      style={{
                        borderColor: marcado ? "var(--acento)" : "var(--grid)",
                        background: marcado ? "var(--acento-suave)" : "transparent",
                        color: marcado ? "var(--acento)" : "var(--ink-1)",
                        fontWeight: marcado ? 600 : 400,
                      }}
                      aria-pressed={marcado}
                      title={`${m.pedidos} pedidos de solo ${m.modelo} (${m.pares} pares)`}
                    >
                      {m.modelo} · {m.pedidos}
                    </button>
                  );
                })}
                {porModelo.revueltos.pedidos ? (
                  <span className="texto-2 rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--grid)" }} title="Paquetes con más de un modelo: siempre van con el corte general">
                    revueltos · {porModelo.revueltos.pedidos}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          <label
            className="hairline flex items-center gap-2 border-t p-3 text-xs"
            style={{ color: sinDefensa ? "var(--estado-critico)" : "var(--ink-2)" }}
          >
            <input type="checkbox" checked={sinDefensa} onChange={(e) => setSinDefensa(e.target.checked)} disabled={ocupado} />
            <span>
              <span className="font-semibold">Sin defensa:</span> confirmar todo aunque no haya stock físico (el kardex puede
              quedar en negativo). Se apaga solo después del corte.
            </span>
          </label>
        </div>

        <div className="mt-3">
          <Ayuda titulo="¿Qué hace cada corte?">
            <p>
              Hacer corte confirma todos los envíos en TikTok de un jalón, descuenta del almacén, republica y deja el corte
              guardado con sus etiquetas y su lista. Corte ayer toma solo lo de hasta ayer a las 23:59 (hora de México) y deja
              lo de hoy pendiente, para adelantar un día. Corte lunes hace dos cortes: viernes a domingo (y lo más viejo) y
              luego lo del lunes.
            </p>
            <p>
              Defensa automática: si un SKU no tiene stock físico para todos los pedidos que lo piden, se cancela en TikTok
              solo ese renglón (los pedidos más nuevos primero) y se confirma lo demás; si TikTok no acepta la cancelación, el
              pedido entero se queda fuera y se avisa.
            </p>
            <p>
              Sin defensa libera los bloqueos por stock: el kardex puede quedar en negativo y la alarma lo va a gritar.
            </p>
            <p>
              Corte por modelo: solo paquetes de un solo modelo; los revueltos van con el corte general.
            </p>
          </Ayuda>
        </div>

        {ronda ? <p className="mt-3 text-xs font-semibold texto-2">{ronda}</p> : null}
        {aviso ? <Aviso tono="bien" className="mt-3">{aviso}</Aviso> : null}
        {error ? <Aviso tono="critico" className="mt-3">{error}</Aviso> : null}

        {simulacion ? (
          <div className="mt-4 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--grid)" }}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                Simulación{etiquetaDeModelos(simulacion.modelos) ? ` (${etiquetaDeModelos(simulacion.modelos)})` : ""}: {simulacion.pedidos.length} pedidos · {simulacion.totalPares} pares
              </span>
              <button onClick={() => setSimulacion(null)} className="boton boton-fantasma boton-chico">
                Cerrar
              </button>
            </div>
            {simulacion.tandas && simulacion.tandas.urgentes ? (
              <p className="mt-1 text-xs texto-2">
                Corte ayer: {simulacion.tandas.urgentes} pedidos hasta el {simulacion.tandas.corte} a las 23:59 (hora de
                México; ayer y lo más viejo){simulacion.tandas.resto ? `, y los ${simulacion.tandas.resto} de hoy se quedan pendientes` : ""}.
                {simulacion.tandas.resto
                  ? ` Corte lunes: los mismos ${simulacion.tandas.urgentes} en el primer corte y los ${simulacion.tandas.resto} de hoy en el segundo.`
                  : ""}
              </p>
            ) : null}
            <ul className="mt-2 flex flex-col gap-1">
              {simulacion.pedidos.map((p: any) => (
                <li key={p.orderId} className="flex flex-wrap items-center gap-2">
                  <span className="cifra text-xs texto-2">{p.orderId}</span>
                  <span>{p.pares.map((x: any) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ")}</span>
                  {p.bloqueados?.length ? (
                    <span className="chip" style={{ background: "var(--critico-suave)", color: "var(--critico-texto)" }}>
                      se cancela: {p.bloqueados.map((x: any) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ")}
                    </span>
                  ) : null}
                  <span
                    className="chip"
                    style={{
                      background: p.recoleccion === true ? "var(--bien-suave)" : p.recoleccion === false ? "var(--alerta-suave)" : "var(--grid)",
                      color: p.recoleccion === true ? "var(--exito-texto)" : p.recoleccion === false ? "var(--alerta-texto)" : "var(--ink-2)",
                    }}
                  >
                    {p.recoleccion === true ? "recolección disponible" : p.recoleccion === false ? "solo drop-off" : "sin dato"}
                  </span>
                  {p.aviso ? <span className="text-xs texto-2">{p.aviso}</span> : null}
                </li>
              ))}
            </ul>
            <div className="mt-3 text-xs texto-2">
              Al 3PL se mandarían: {simulacion.salidasAl3pl.map((x: any) => `${x.sku} ×${x.pares}`).join(", ") || "nada"}
              {" · "}endpoint: {simulacion.endpoint3pl ?? "sin configurar"}
            </div>
            <p className="mt-1 text-xs texto-2">
              Nada se ha confirmado: es solo lo que pasaría.
            </p>
          </div>
        ) : null}
      </Seccion>

      <Seccion titulo="Cortes" sinRelleno>
        <div className="px-4 pt-3">
          <Ayuda titulo="¿En qué orden van las hojas?">
            <p>Surtido: pares por SKU en orden alfabético, para jalar de bodega.</p>
            <p>
              En los cortes nuevos, etiquetas y lista de empaque van PRIMERO con los paquetes de un solo modelo (una pieza o
              varias del mismo modelo) y al final los revueltos; dentro de cada modelo, primero los de un solo color y al
              final los que mezclan colores, y dentro de cada bloque en orden de modelo → color → talla, con el mismo número.
              Un corte ya hecho conserva el orden y los números con los que se imprimió.
            </p>
            <p>
              En la etiqueta va el CÓDIGO DEL PEDIDO en barras: escanearlo en la estación enseña qué empacar, y luego se
              escanea el FNSKU de cada caja. Si un corte quedó a medias, «Faltantes» dice qué pedidos y qué productos
              quedaron sin preparar.
            </p>
          </Ayuda>
        </div>
        <ul className="mt-3 divide-y" style={{ borderColor: "var(--grid)" }}>
          {cortes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hairline">
              <div>
                <div className="text-sm font-semibold">
                  Corte #{c.numero}
                  {etiquetaDeModelos(c.modelos) ? (
                    <span className="chip ml-2" style={{ background: "var(--acento-suave)", color: "var(--acento)" }}>
                      {etiquetaDeModelos(c.modelos)}
                    </span>
                  ) : null}
                  <span className="ml-2 text-xs font-normal texto-2">
                    {cuando(c.creadoEn)} · {c.pedidos} pedidos · {c.pares} pares ·{" "}
                    {c.handover === "DROP_OFF" ? "a la paquetería" : "pasa el repartidor"}
                  </span>
                  <span
                    className="chip ml-2"
                    style={{
                      background: listosDe(c) != null && (listosDe(c) as number) >= vivosDe(c) && vivosDe(c) > 0 ? "var(--bien-suave)" : "var(--grid)",
                      color: listosDe(c) != null && (listosDe(c) as number) >= vivosDe(c) && vivosDe(c) > 0 ? "var(--exito-texto)" : "var(--ink-2)",
                    }}
                  >
                    {listosDe(c) ?? "—"} / {vivosDe(c)} preparados
                    {c.enviados ? ` · ${c.enviados} ${c.enviados === 1 ? "ya enviado sin escanear" : "ya enviados sin escanear"}` : ""}
                    {c.cancelados ? ` · ${c.cancelados} ${c.cancelados === 1 ? "cancelado" : "cancelados"}` : ""}
                  </span>
                </div>
                {armandoEtiquetas[c.id] ? (
                  <p className="mt-1 text-xs font-semibold" style={{ color: armandoEtiquetas[c.id].startsWith("No se pudieron") ? "var(--estado-critico)" : "var(--ink-2)" }}>
                    {armandoEtiquetas[c.id]}
                  </p>
                ) : etiquetas[c.id] ? (
                  <p className="mt-1 text-xs" style={{ color: etiquetas[c.id].completo ? "var(--exito-texto)" : "var(--ink-2)" }}>
                    {etiquetas[c.id].completo
                      ? "Etiquetas listas para imprimir."
                      : `Armando las etiquetas por atrás: ${etiquetas[c.id].listos} de ${etiquetas[c.id].tomos} ${etiquetas[c.id].tomos === 1 ? "tomo" : "tomos"} guardados${
                          etiquetas[c.id].guiasSinBajar ? ` · ${etiquetas[c.id].guiasSinBajar} guías que TikTok aún no da (se reintentan)` : ""
                        }${etiquetas[c.id].ocupado ? " · el servidor las está armando" : ""}…`}
                    {etiquetas[c.id].completo ? (
                      <button
                        type="button"
                        onClick={() => rearmarEtiquetas(c)}
                        title="Tira los tomos guardados y los vuelve a armar por atrás (si alguna hoja salió SIN GUÍA)"
                        className="boton boton-borde boton-chico ml-2"
                      >
                        Rearmar etiquetas
                      </button>
                    ) : null}
                  </p>
                ) : null}
                {c.errores?.filter((e) => !e.error.includes("solo drop-off")).length ? (
                  <ul className="mt-1 text-xs" style={{ color: "var(--estado-critico)" }}>
                    {agruparErrores(c.errores.filter((e) => !e.error.includes("solo drop-off"))).map((g) => (
                      <li
                        key={g.mensaje}
                        title={g.pedidos.length > 1 ? g.ejemplo : undefined}
                        // Un renglón sin pedido es una nota del corte entero (por
                        // ejemplo, que salió como recolección sin horario): no es rojo.
                        style={g.pedidos.length ? undefined : { color: "var(--ink-2)" }}
                      >
                        {g.pedidos.length > 1
                          ? `${g.pedidos.length} pedidos: ${g.mensaje}`
                          : g.pedidos.length === 1
                            ? `Pedido ${g.pedidos[0]}: ${g.ejemplo}`
                            : g.ejemplo}
                        {g.pedidos.length > 1 ? (
                          <details className="inline">
                            <summary className="enlace ml-1 inline cursor-pointer">
                              ver cuáles
                            </summary>
                            <span className="cifra ml-1 texto-2">{g.pedidos.join(", ")}</span>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/tiktok/despacho/${c.id}/preparar`}
                  className="boton boton-secundario boton-chico"
                >
                  <ScanLine size={14} /> Preparar pedidos
                </Link>
                {vivosDe(c) > 0 && listosDe(c) != null && (listosDe(c) as number) < vivosDe(c) ? (
                  <button
                    type="button"
                    disabled={pidiendoFaltantes === c.id}
                    onClick={() => verFaltantes(c.id)}
                    title="Los pedidos de este corte que todavía no se preparan, con sus productos"
                    className="boton boton-borde boton-chico"
                    style={{ borderColor: "var(--estado-alerta)" }}
                  >
                    <PackageX size={14} />
                    {pidiendoFaltantes === c.id
                      ? "Buscando…"
                      : faltantes[c.id]
                        ? "Ocultar faltantes"
                        : `Faltantes (${vivosDe(c) - (listosDe(c) ?? 0)})`}
                  </button>
                ) : null}
                {vivosDe(c) > 0 && listosDe(c) != null && (listosDe(c) as number) < vivosDe(c) ? (
                  <button
                    type="button"
                    disabled={preparandoTodo === c.id}
                    onClick={async () => {
                      const faltan = vivosDe(c) - (listosDe(c) ?? 0);
                      const pin = window.prompt(
                        `Dar por preparado TODO el corte #${c.numero} sin escanear (faltan ${faltan}). Clave de supervisor:`,
                      );
                      if (pin == null) return;
                      setPreparandoTodo(c.id);
                      try {
                        const r = await fetch(`/api/tiktok/cortes/${c.id}/preparar-todo`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ pin }),
                        });
                        const j = await r.json();
                        if (!r.ok) throw new Error(j.error ?? "No se pudo.");
                        router.refresh();
                      } catch (e) {
                        alert((e as Error).message);
                      } finally {
                        setPreparandoTodo(null);
                      }
                    }}
                    title="Da por preparados todos los paquetes pendientes del corte, con constancia SUPERVISOR"
                    className="boton boton-borde boton-chico"
                  >
                    <ShieldCheck size={14} /> {preparandoTodo === c.id ? "Preparando…" : "Todo con clave"}
                  </button>
                ) : null}
                <a
                  href={`/api/tiktok/cortes/${c.id}/surtido`}
                  target="_blank"
                  rel="noreferrer"
                  className="boton boton-borde boton-chico"
                >
                  Lista de surtido
                </a>
                <button
                  onClick={() => imprimirEtiquetas(c)}
                  disabled={Boolean(armandoEtiquetas[c.id]) && !armandoEtiquetas[c.id].startsWith("No se pudieron")}
                  className="boton boton-secundario boton-chico"
                  title={
                    tomosDeCorte(c.pedidos) > 1
                      ? `El servidor arma ${tomosDeCorte(c.pedidos)} tomos de 200 guías y aquí se juntan en un solo PDF`
                      : "Las guías del corte en orden, con #n y el código del pedido"
                  }
                >
                  <Printer size={14} />{" "}
                  {armandoEtiquetas[c.id] && !armandoEtiquetas[c.id].startsWith("No se pudieron")
                    ? "Armando…"
                    : etiquetas[c.id] && !etiquetas[c.id].completo
                      ? "Etiquetas PDF (armándose…)"
                      : "Etiquetas PDF"}
                </button>
                <a
                  href={`/api/tiktok/cortes/${c.id}/salidas`}
                  className="boton boton-borde boton-chico"
                  title="Las salidas del corte para el 3PL (CSV)"
                >
                  Salidas 3PL
                </a>
                <a
                  href={`/api/tiktok/cortes/${c.id}/lista`}
                  target="_blank"
                  rel="noreferrer"
                  className="boton boton-borde boton-chico"
                >
                  <FileText size={14} /> Lista de empaque
                </a>
              </div>
              {faltantes[c.id] ? (
                <div className="w-full rounded-lg border p-3 text-sm" style={{ borderColor: "var(--grid)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      Faltan {faltantes[c.id].faltantes.length} de {faltantes[c.id].total} paquetes ·{" "}
                      {faltantes[c.id].pares.reduce((a: number, x: any) => a + x.pares, 0)} pares
                      {faltantes[c.id].enviados
                        ? ` · ${faltantes[c.id].enviados} ${faltantes[c.id].enviados === 1 ? "ya enviado sin escanear" : "ya enviados sin escanear"}`
                        : ""}
                      {faltantes[c.id].cancelados
                        ? ` · ${faltantes[c.id].cancelados} ${faltantes[c.id].cancelados === 1 ? "cancelado después del corte" : "cancelados después del corte"}`
                        : ""}
                    </span>
                    <a
                      href={`/api/tiktok/cortes/${c.id}/faltantes?formato=pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="enlace flex items-center gap-1.5 text-xs"
                    >
                      <Printer size={12} /> Imprimir la hoja
                    </a>
                  </div>
                  {faltantes[c.id].pares.length ? (
                    <p className="mt-1 text-xs texto-2">
                      Por surtir:{" "}
                      {faltantes[c.id].pares.map((x: any) => `${x.sku} ×${x.pares}`).join(" · ")}
                    </p>
                  ) : null}
                  <ul className="mt-2 flex flex-col gap-1">
                    {faltantes[c.id].faltantes.map((f: any) => (
                      <li key={`${f.orderId}-${f.packageId}`} className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold">#{f.numero}</span>
                        <span className="cifra text-xs texto-2">
                          {f.orderId}
                        </span>
                        <span>
                          {f.pares.map((x: any) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ")}
                        </span>
                        {f.revuelto ? (
                          <span className="chip texto-2" style={{ background: "var(--grid)" }}>
                            revuelto
                          </span>
                        ) : null}
                      </li>
                    ))}
                    {!faltantes[c.id].faltantes.length ? (
                      <li className="text-xs texto-2">
                        Nada pendiente: el corte se preparó completo.
                      </li>
                    ) : null}
                  </ul>
                  {faltantes[c.id].rechazados?.length ? (
                    <div className="mt-2 text-xs" style={{ color: "var(--estado-critico)" }}>
                      Además, TikTok no aceptó estos pedidos al hacer el corte (nunca tuvieron guía):{" "}
                      {faltantes[c.id].rechazados.map((r: any) => r.orderId).join(", ")}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
          {!cortes.length ? (
            <li className="px-4 py-6 text-center text-sm texto-2">
              Todavía no hay cortes.
            </li>
          ) : null}
        </ul>
      </Seccion>
    </div>
  );
}
