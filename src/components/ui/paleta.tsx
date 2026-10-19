"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Clock, CornerDownLeft, Search } from "lucide-react";
import { entradaDeRuta, entradasDelMenu, type EntradaMenu } from "@/components/menu-lateral";
import type { Rol } from "@/lib/acceso/roles";

/**
 * Paleta de búsqueda (⌘K / Ctrl+K; 19-oct-2026): brincar a cualquier
 * pantalla tecleando un pedazo de su nombre, sin abrir secciones del menú.
 * No hay barra de búsqueda a la vista: se abre con el atajo o con «Buscar»
 * al pie del menú. Busca en las MISMAS entradas del menú y respeta lo que el
 * rol puede ver (`entradasDelMenu` → `entradaVisible`). Sin texto, primero
 * las pantallas que se abrieron hace poco (recordadas en el navegador).
 */

const LLAVE_RECIENTES = "paleta-recientes";
const MAX_RECIENTES = 5;

function leerRecientes(): string[] {
  try {
    const raw = window.localStorage.getItem(LLAVE_RECIENTES);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function guardarReciente(href: string) {
  try {
    const v = [href, ...leerRecientes().filter((h) => h !== href)].slice(0, MAX_RECIENTES);
    window.localStorage.setItem(LLAVE_RECIENTES, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: no hay recientes, nada más */
  }
}

/** Minúsculas y sin acentos: «auditoria» encuentra «Auditoría». */
function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** ¿Las letras de `q` aparecen en orden dentro de `t`? («rbfl» → «Reabasto a Full») */
function enOrden(q: string, t: string): boolean {
  let i = 0;
  for (const c of t) if (c === q[i]) i++;
  return i === q.length;
}

/**
 * Puntaje de una entrada contra lo tecleado (menor = mejor; null = fuera).
 * Cada palabra tecleada tiene que estar en el nombre, la sección o la
 * explicación; el nombre pesa más que lo demás. Una sola palabra también
 * vale como letras en orden sobre el nombre completo.
 */
function puntaje(e: EntradaMenu, consulta: string): number | null {
  const nombre = normalizar(e.texto);
  const completo = normalizar(`${e.completo} ${e.grupo} ${e.grupoCorto}`);
  const extra = normalizar(e.ayuda ?? "");
  const palabras = consulta.split(/\s+/).filter(Boolean);
  if (!palabras.length) return 0;

  let total = 0;
  for (const p of palabras) {
    if (nombre.startsWith(p)) total += 0;
    else if (new RegExp(`(^|[\\s·(/-])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(nombre)) total += 1;
    else if (nombre.includes(p)) total += 2;
    else if (completo.includes(p)) total += 3;
    else if (extra.includes(p)) total += 6;
    else if (palabras.length === 1 && enOrden(p, nombre.replace(/\s+/g, ""))) total += 8;
    else return null;
  }
  return total;
}

export function Paleta({ rol = "dueño" }: { rol?: Rol }) {
  const router = useRouter();
  const ruta = usePathname();
  const idLista = useId();
  const [abierta, setAbierta] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [indice, setIndice] = useState(0);
  const [recientes, setRecientes] = useState<string[]>([]);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const focoPrevio = useRef<HTMLElement | null>(null);

  const entradas = useMemo(() => entradasDelMenu(rol), [rol]);

  // Cada pantalla que se abre (por el menú, la paleta o un enlace) cuenta
  // como reciente.
  useEffect(() => {
    const e = entradaDeRuta(ruta, entradas);
    if (e) guardarReciente(e.href);
  }, [ruta, entradas]);

  const abrir = useCallback(() => {
    focoPrevio.current = document.activeElement as HTMLElement | null;
    setRecientes(leerRecientes());
    setConsulta("");
    setIndice(0);
    setAbierta(true);
  }, []);

  const cerrar = useCallback(() => {
    setAbierta(false);
    // El foco regresa a donde estaba (el botón «Buscar», o la página).
    requestAnimationFrame(() => focoPrevio.current?.focus?.());
  }, []);

  // ⌘K / Ctrl+K abre y cierra; «Buscar» del menú manda un evento.
  useEffect(() => {
    function tecla(ev: KeyboardEvent) {
      if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        if (abierta) cerrar();
        else abrir();
      }
    }
    window.addEventListener("keydown", tecla);
    window.addEventListener("getac:abrir-paleta", abrir);
    return () => {
      window.removeEventListener("keydown", tecla);
      window.removeEventListener("getac:abrir-paleta", abrir);
    };
  }, [abierta, abrir, cerrar]);

  useEffect(() => {
    if (abierta) entrada.current?.focus();
  }, [abierta]);

  const actual = entradaDeRuta(ruta, entradas)?.href ?? null;

  // Sin texto: recientes (sin la pantalla en la que ya estás) y luego todo,
  // en el orden del menú. Con texto: lo que coincide, lo mejor arriba.
  const { renglones, cuantosRecientes } = useMemo(() => {
    const q = normalizar(consulta.trim());
    if (!q) {
      const porHref = new Map(entradas.map((e) => [e.href, e]));
      const rec = recientes
        .filter((h) => h !== actual)
        .map((h) => porHref.get(h))
        .filter((e): e is EntradaMenu => !!e);
      const usados = new Set(rec.map((e) => e.href));
      return { renglones: [...rec, ...entradas.filter((e) => !usados.has(e.href))], cuantosRecientes: rec.length };
    }
    const con = entradas
      .map((e, orden) => ({ e, orden, p: puntaje(e, q) }))
      .filter((x): x is { e: EntradaMenu; orden: number; p: number } => x.p !== null)
      .sort((a, b) => a.p - b.p || a.orden - b.orden)
      .map((x) => x.e);
    return { renglones: con, cuantosRecientes: 0 };
  }, [consulta, entradas, recientes, actual]);

  useEffect(() => {
    setIndice(0);
  }, [consulta]);

  // El renglón elegido siempre a la vista al moverse con las flechas.
  useEffect(() => {
    if (!abierta) return;
    const el = lista.current?.querySelector<HTMLElement>(`[data-indice="${indice}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [indice, abierta]);

  function ir(e: EntradaMenu | undefined) {
    if (!e) return;
    guardarReciente(e.href);
    setAbierta(false);
    if (e.href !== ruta) router.push(e.href);
  }

  function teclaEnEntrada(ev: React.KeyboardEvent<HTMLInputElement>) {
    const n = renglones.length;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (n) setIndice((i) => (i + 1) % n);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (n) setIndice((i) => (i - 1 + n) % n);
    } else if (ev.key === "Home" && n) {
      ev.preventDefault();
      setIndice(0);
    } else if (ev.key === "End" && n) {
      ev.preventDefault();
      setIndice(n - 1);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      ir(renglones[indice]);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cerrar();
    } else if (ev.key === "Tab") {
      // El foco se queda en la búsqueda: la paleta no tiene más controles.
      ev.preventDefault();
    }
  }

  if (!abierta) return null;

  const idRenglon = (i: number) => `${idLista}-r${i}`;

  return (
    <div className="no-imprimir fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] sm:pt-[14vh]">
      <div
        className="absolute inset-0 transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none"
        style={{ background: "rgba(42,32,25,.32)" }}
        onClick={cerrar}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ir a una pantalla"
        className="relative flex max-h-[min(32rem,72dvh)] w-full max-w-[34rem] origin-top flex-col overflow-hidden rounded-xl border transition-[opacity,transform] duration-150 ease-[var(--ease-out,cubic-bezier(0.23,1,0.32,1))] starting:scale-[0.97] starting:opacity-0 motion-reduce:transition-none"
        style={{
          background: "var(--surface-1)",
          borderColor: "var(--borde)",
          boxShadow: "0 24px 48px -12px rgba(42,32,25,.28), 0 2px 6px rgba(42,32,25,.08)",
        }}
      >
        <div className="flex items-center gap-2.5 border-b px-4" style={{ borderColor: "var(--borde)" }}>
          <Search size={17} strokeWidth={2} aria-hidden="true" className="shrink-0" style={{ color: "var(--ink-muted)" }} />
          <input
            ref={entrada}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={renglones.length ? idRenglon(indice) : undefined}
            aria-label="Buscar pantalla"
            placeholder="Ir a… (ventas amazon, despacho, costeo)"
            value={consulta}
            onChange={(ev) => setConsulta(ev.target.value)}
            onKeyDown={teclaEnEntrada}
            autoComplete="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-[15px] shadow-none outline-none hover:border-0 focus:shadow-none focus:outline-none"
            style={{ color: "var(--ink-1)" }}
          />
          <kbd
            className="hidden rounded border px-1.5 py-px font-sans text-[11px] font-medium sm:inline"
            style={{ borderColor: "var(--borde)", color: "var(--ink-2)" }}
          >
            Esc
          </kbd>
        </div>

        <ul ref={lista} id={idLista} role="listbox" aria-label="Pantallas" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {renglones.length === 0 ? (
            <li role="presentation" className="px-3 py-8 text-center text-[13px]" style={{ color: "var(--ink-2)" }}>
              Ninguna pantalla se llama así.
            </li>
          ) : null}
          {renglones.map((e, i) => {
            const elegido = i === indice;
            const Icono = e.icono;
            const encabezado =
              !consulta.trim() && cuantosRecientes > 0 && (i === 0 || i === cuantosRecientes)
                ? i === 0
                  ? "Recientes"
                  : "Todas"
                : null;
            const esReciente = !consulta.trim() && i < cuantosRecientes;
            return (
              <li key={`${esReciente ? "r" : "t"}-${e.href}`} role="presentation">
                {encabezado ? (
                  <div
                    role="presentation"
                    className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase"
                    style={{ color: "var(--ink-2)", letterSpacing: "0.07em" }}
                  >
                    {encabezado}
                  </div>
                ) : null}
                <div
                  id={idRenglon(i)}
                  role="option"
                  aria-selected={elegido}
                  data-indice={i}
                  onMouseMove={() => {
                    if (!elegido) setIndice(i);
                  }}
                  onClick={() => ir(e)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[14px]"
                  style={{ background: elegido ? "var(--sidebar-activo)" : "transparent", color: "var(--ink-1)" }}
                >
                  {esReciente ? (
                    <Clock size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0" style={{ color: "var(--ink-muted)" }} />
                  ) : (
                    <Icono
                      size={16}
                      strokeWidth={1.8}
                      aria-hidden="true"
                      className="shrink-0"
                      style={{ color: elegido ? "var(--acento)" : "var(--ink-muted)" }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{e.texto}</span>
                  <span className="shrink-0 truncate text-[12px]" style={{ color: "var(--ink-2)" }}>
                    {e.grupo === "GETAC" ? "" : e.grupoCorto}
                  </span>
                  <CornerDownLeft
                    size={14}
                    aria-hidden="true"
                    className="shrink-0"
                    style={{ color: "var(--ink-muted)", visibility: elegido ? "visible" : "hidden" }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
