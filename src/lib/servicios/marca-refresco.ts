/**
 * «Esta pantalla se sirvió con datos viejos» (dueño, 9-oct-2026: «cada vez
 * que me meto a una pestaña me sale la información no actualizada y tengo
 * que actualizar para que salga bien»).
 *
 * `servirConCacheApp` sirve el renglón guardado aunque esté viejo y lo
 * refresca en `after()`: la primera vista siempre salía vieja y solo un F5
 * enseñaba lo nuevo. Ahora deja aquí la marca (memoria POR REQUEST con
 * `cache` de React; fuera de un render de servidor no guarda nada) y
 * `<Pagina>` monta `RefrescoAlTerminar`, que vuelve a pedir la pantalla
 * cuando el fondo ya terminó.
 */
import { cache } from "react";

const marcas = cache(() => ({ refrescando: false }));

export function marcarRefrescando(): void {
  marcas().refrescando = true;
}

export function seEstaRefrescando(): boolean {
  return marcas().refrescando;
}
