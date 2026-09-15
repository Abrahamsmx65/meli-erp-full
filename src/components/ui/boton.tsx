/**
 * EL botón del sistema. Una sola jerarquía:
 *
 *   primario   la acción principal de la pantalla (una por pantalla)
 *   secundario acción visible pero de menor peso (relleno suave de acento)
 *   borde      acción neutra (el "botón con borde" que había 71 veces a mano)
 *   fantasma   acción de texto
 *   peligro    SOLO destructivas: se ven distintas siempre
 *
 * `cargando` deshabilita, evita el doble clic y cambia el texto: el feedback
 * llega en el mismo clic, no cuando contesta el servidor.
 *
 * No lleva "use client": puede usarse igual en componentes de servidor.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type VarianteBoton = "primario" | "secundario" | "borde" | "fantasma" | "peligro" | "peligro-lleno";

const CLASE: Record<VarianteBoton, string> = {
  primario: "boton boton-primario",
  secundario: "boton boton-secundario",
  borde: "boton boton-borde",
  fantasma: "boton boton-fantasma",
  peligro: "boton boton-peligro",
  "peligro-lleno": "boton boton-peligro-lleno",
};

export function Boton({
  variante = "borde",
  chico,
  cargando,
  textoCargando,
  children,
  className = "",
  disabled,
  type = "button",
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBoton;
  chico?: boolean;
  /** true = deshabilita y muestra `textoCargando` (o el contenido normal) */
  cargando?: boolean;
  textoCargando?: ReactNode;
}) {
  return (
    <button
      type={type}
      className={`${CLASE[variante]}${chico ? " boton-chico" : ""} ${className}`.trim()}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      {...resto}
    >
      {cargando && textoCargando != null ? textoCargando : children}
    </button>
  );
}

/** Enlace con pinta de botón (para navegación y descargas simples). */
export function EnlaceBoton({
  variante = "borde",
  chico,
  className = "",
  children,
  ...resto
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variante?: VarianteBoton;
  chico?: boolean;
}) {
  return (
    <a className={`${CLASE[variante]}${chico ? " boton-chico" : ""} ${className}`.trim()} {...resto}>
      {children}
    </a>
  );
}
