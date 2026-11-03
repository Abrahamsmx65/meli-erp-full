"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Copy, RotateCcw, Share2 } from "lucide-react";
import { horaEnPalabras, ritmoEnPalabras, textoParaCompartir, type Wrapped } from "@/lib/servicios/wrapped";

/**
 * GETAC Wrapped: el año en tarjetas que se pasan como historias. Se avanza
 * tocando la mitad derecha (o con las flechas del teclado) y se regresa con
 * la izquierda. La última tarjeta copia el resumen para mandarlo por WhatsApp.
 */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("es-MX");
}
const n = (x: number) => Math.round(x).toLocaleString("es-MX");
const pct = (x: number) => `${Math.round(x * 100)} %`;
function fechaLarga(f: string): string {
  return `${Number(f.slice(8, 10))} de ${MESES[Number(f.slice(5, 7)) - 1]}`;
}
function mesLargo(periodo: string): string {
  const m = MESES[Number(periodo.slice(5, 7)) - 1];
  return `${m[0].toUpperCase()}${m.slice(1)} ${periodo.slice(0, 4)}`;
}

/** Un número que sube desde cero al aparecer la tarjeta. */
function Cuenta({ valor, formato = n }: { valor: number; formato?: (x: number) => string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(valor);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / 1200);
      setV(valor * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor]);
  return <>{formato(v)}</>;
}

interface Tarjeta {
  id: string;
  fondo: string;
  tinta?: string;
  contenido: ReactNode;
}

const FONDOS = {
  cafe: "linear-gradient(160deg, #3b2716 0%, #8b6640 100%)",
  caramelo: "linear-gradient(160deg, #a35f1c 0%, #e0a15a 100%)",
  mostaza: "linear-gradient(160deg, #d3a52e 0%, #f3dc8c 100%)",
  verde: "linear-gradient(160deg, #1f6b44 0%, #2f9c63 100%)",
  mezclilla: "linear-gradient(160deg, #1e3f6b 0%, #3a72b8 100%)",
  crema: "linear-gradient(160deg, #f6eee2 0%, #e4d3bb 100%)",
  noche: "linear-gradient(160deg, #1a1410 0%, #4a3320 100%)",
};

function Ceja({ children }: { children: ReactNode }) {
  return <p className="wr-ceja">{children}</p>;
}
function Grande({ children }: { children: ReactNode }) {
  return <p className="wr-grande">{children}</p>;
}
function Titulo({ children }: { children: ReactNode }) {
  return <h2 className="wr-titulo">{children}</h2>;
}
function Nota({ children }: { children: ReactNode }) {
  return <p className="wr-nota">{children}</p>;
}

function armarTarjetas(w: Wrapped, nombre: string, fotos: { estrella?: string | null; dejo?: string | null }): Tarjeta[] {
  const lista: Tarjeta[] = [];

  lista.push({
    id: "portada",
    fondo: FONDOS.cafe,
    contenido: (
      <>
        <Ceja>GETAC Wrapped</Ceja>
        <Titulo>Tu año en el negocio</Titulo>
        <Nota>{nombre}</Nota>
        <p className="wr-pista">Toca para empezar →</p>
      </>
    ),
  });

  lista.push({
    id: "unidades",
    fondo: FONDOS.caramelo,
    contenido: (
      <>
        <Ceja>Este año vendiste</Ceja>
        <Grande>
          <Cuenta valor={w.unidades} />
        </Grande>
        <Titulo>unidades</Titulo>
        <Nota>
          Por <strong>{pesos(w.ventaBruta)}</strong>
          {w.segundosPorUnidad ? (
            <>
              . Eso es <strong>{ritmoEnPalabras(w.segundosPorUnidad)}</strong>, de día y de noche.
            </>
          ) : (
            "."
          )}
        </Nota>
      </>
    ),
  });

  if (w.pares > 0) {
    lista.push({
      id: "fila",
      fondo: FONDOS.mezclilla,
      contenido: (
        <>
          <Ceja>Si pusieras en fila los</Ceja>
          <Grande>
            <Cuenta valor={w.pares} />
          </Grande>
          <Titulo>pares de calzado</Titulo>
          <Nota>
            harías una fila de <strong>{w.kmEnFila.toLocaleString("es-MX", { maximumFractionDigits: 1 })} km</strong> de cajas
            {w.vueltasZocalo >= 1 ? (
              <>
                : le darías <strong>{n(w.vueltasZocalo)} vueltas</strong> al Zócalo.
              </>
            ) : (
              "."
            )}
          </Nota>
          <div className="wr-cajas" aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} style={{ animationDelay: `${i * 70}ms` }} />
            ))}
          </div>
        </>
      ),
    });
  }

  if (w.modeloEstrella) {
    lista.push({
      id: "estrella",
      fondo: FONDOS.mostaza,
      tinta: "#2b1d10",
      contenido: (
        <>
          <Ceja>Tu modelo estrella</Ceja>
          {fotos.estrella ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fotos.estrella} alt={w.modeloEstrella.modelo} className="wr-foto" />
          ) : null}
          <Grande>{w.modeloEstrella.modelo}</Grande>
          <Nota>
            <strong>{n(w.modeloEstrella.unidades)}</strong> vendidos · {pesos(w.modeloEstrella.importe)}
            <br />
            {w.modeloEstrella.categoria}
          </Nota>
        </>
      ),
    });
  }

  if (w.modeloQueMasDejo && w.modeloQueMasDejo.modelo !== w.modeloEstrella?.modelo) {
    lista.push({
      id: "dejo",
      fondo: FONDOS.verde,
      contenido: (
        <>
          <Ceja>Pero el que más dinero te dejó fue</Ceja>
          {fotos.dejo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fotos.dejo} alt={w.modeloQueMasDejo.modelo} className="wr-foto" />
          ) : null}
          <Grande>{w.modeloQueMasDejo.modelo}</Grande>
          <Nota>
            <strong>{pesos(w.modeloQueMasDejo.ganancia)}</strong> de ganancia con {n(w.modeloQueMasDejo.unidades)} unidades
          </Nota>
        </>
      ),
    });
  } else if (w.modeloQueMasDejo) {
    lista.push({
      id: "dejo",
      fondo: FONDOS.verde,
      contenido: (
        <>
          <Ceja>Y además fue el que más dinero te dejó</Ceja>
          <Grande>
            <Cuenta valor={w.modeloQueMasDejo.ganancia} formato={pesos} />
          </Grande>
          <Nota>de ganancia, nadie le ganó</Nota>
        </>
      ),
    });
  }

  if (w.mejorDia) {
    lista.push({
      id: "dia",
      fondo: FONDOS.noche,
      contenido: (
        <>
          <Ceja>Tu mejor día fue un {w.mejorDia.diaSemana}</Ceja>
          <Titulo>el {fechaLarga(w.mejorDia.fecha)}</Titulo>
          <Grande>
            <Cuenta valor={w.mejorDia.importe} formato={pesos} />
          </Grande>
          <Nota>
            {n(w.mejorDia.unidades)} unidades en {n(w.mejorDia.ordenes)} pedidos, en un solo día 🔥
          </Nota>
        </>
      ),
    });
  }

  if (w.horaPico || w.diaSemanaFavorito) {
    lista.push({
      id: "hora",
      fondo: FONDOS.mezclilla,
      contenido: (
        <>
          <Ceja>Tus clientes compran más</Ceja>
          {w.diaSemanaFavorito ? <Titulo>los {w.diaSemanaFavorito.dia}</Titulo> : null}
          {w.horaPico ? (
            <>
              <Grande>{horaEnPalabras(w.horaPico.hora).split(" ")[0]}</Grande>
              <Titulo>{horaEnPalabras(w.horaPico.hora).split(" ").slice(1).join(" ")}</Titulo>
            </>
          ) : null}
          <Nota>
            {w.horaPico ? <>A esa hora entra el {pct(w.horaPico.parte)} de lo que vendes en el día. </> : null}
            {w.diaSemanaFavorito ? <>El {w.diaSemanaFavorito.dia} se lleva el {pct(w.diaSemanaFavorito.parte)} de la semana.</> : null}
          </Nota>
        </>
      ),
    });
  }

  if (w.canalFavorito) {
    lista.push({
      id: "canal",
      fondo: FONDOS.crema,
      tinta: "#2b1d10",
      contenido: (
        <>
          <Ceja>Tu canal favorito</Ceja>
          <Grande>{w.canalFavorito.nombre}</Grande>
          <Nota>
            se llevó el <strong>{pct(w.canalFavorito.parte)}</strong> de la venta
          </Nota>
          <div className="wr-barras">
            {w.canales.map((k, i) => (
              <div key={k.nombre} className="wr-barra">
                <span className="wr-barra-nombre">{k.nombre}</span>
                <span className="wr-barra-fondo">
                  <span style={{ width: `${Math.max(2, k.parte * 100)}%`, background: k.color, animationDelay: `${i * 150}ms` }} />
                </span>
                <span className="wr-barra-pct">{pct(k.parte)}</span>
              </div>
            ))}
          </div>
        </>
      ),
    });
  }

  if (w.categoriaReina) {
    lista.push({
      id: "categoria",
      fondo: FONDOS.caramelo,
      contenido: (
        <>
          <Ceja>La categoría reina</Ceja>
          <Grande>{w.categoriaReina.categoria}</Grande>
          <Nota>
            {pct(w.categoriaReina.parte)} de todo lo vendido, entre <strong>{n(w.modelos)}</strong> modelos distintos que se
            movieron este año
          </Nota>
        </>
      ),
    });
  }

  if (w.mejorMes && w.mejorMes.utilidadNeta > 0) {
    lista.push({
      id: "mes",
      fondo: FONDOS.verde,
      contenido: (
        <>
          <Ceja>Tu mejor mes</Ceja>
          <Grande>{mesLargo(w.mejorMes.periodo)}</Grande>
          <Nota>
            <strong>{pesos(w.mejorMes.utilidadNeta)}</strong> de utilidad neta con {pesos(w.mejorMes.ventaBruta)} de venta
          </Nota>
        </>
      ),
    });
  }

  lista.push({
    id: "final",
    fondo: FONDOS.cafe,
    contenido: (
      <>
        <Ceja>Y lo que de verdad importa</Ceja>
        <Grande>
          <Cuenta valor={w.utilidadNeta} formato={pesos} />
        </Grande>
        <Titulo>de utilidad neta{w.margen != null ? `, ${pct(w.margen)} de la venta` : ""}</Titulo>
        <Nota>
          {nombre} · hasta el {fechaLarga(w.hasta)}. ¡Gracias por otro año, GETAC! 🥿
        </Nota>
      </>
    ),
  });

  return lista;
}

export function WrappedGetac({
  datos,
  nombreEjercicio,
  fotos,
}: {
  datos: Wrapped;
  nombreEjercicio: string;
  fotos: { estrella?: string | null; dejo?: string | null };
}) {
  const tarjetas = armarTarjetas(datos, nombreEjercicio, fotos);
  const [i, setI] = useState(0);
  const [copiado, setCopiado] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const ultima = i === tarjetas.length - 1;

  const ir = useCallback((d: number) => setI((x) => Math.min(tarjetas.length - 1, Math.max(0, x + d))), [tarjetas.length]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        ir(1);
      } else if (e.key === "ArrowLeft") ir(-1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ir]);

  const texto = textoParaCompartir(datos, nombreEjercicio, pesos);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };

  const t = tarjetas[i];
  return (
    <div className="wr-marco">
      <div
        ref={caja}
        className="wr-tarjeta"
        style={{ background: t.fondo, color: t.tinta ?? "#fff8ee" }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          ir(e.clientX - r.left < r.width / 3 ? -1 : 1);
        }}
        role="group"
        aria-roledescription="tarjeta"
        aria-label={`Tarjeta ${i + 1} de ${tarjetas.length}`}
      >
        <div className="wr-progreso" aria-hidden="true">
          {tarjetas.map((x, k) => (
            <span key={x.id} className={k <= i ? "lleno" : ""} />
          ))}
        </div>
        <div key={t.id} className="wr-contenido">
          {t.contenido}
        </div>
      </div>

      <div className="wr-controles">
        <button type="button" className="boton boton-borde boton-chico" onClick={() => ir(-1)} disabled={i === 0} aria-label="Anterior">
          <ChevronLeft size={16} />
        </button>
        <span className="texto-tenue text-xs cifra">
          {i + 1} / {tarjetas.length}
        </span>
        {ultima ? (
          <>
            <button type="button" className="boton boton-borde boton-chico" onClick={() => setI(0)}>
              <RotateCcw size={14} /> Otra vez
            </button>
            <button type="button" className="boton boton-borde boton-chico" onClick={copiar}>
              <Copy size={14} /> {copiado ? "¡Copiado!" : "Copiar resumen"}
            </button>
            <a
              className="boton boton-primario boton-chico"
              href={`https://wa.me/?text=${encodeURIComponent(texto)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Share2 size={14} /> WhatsApp
            </a>
          </>
        ) : (
          <button type="button" className="boton boton-borde boton-chico" onClick={() => ir(1)} aria-label="Siguiente">
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
