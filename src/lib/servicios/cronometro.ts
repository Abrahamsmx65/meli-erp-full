/**
 * Cronómetro de fases para diagnosticar renders lentos EN PRODUCCIÓN.
 *
 * Escribe una sola línea a los logs de Vercel por carga de página:
 *   [tiempo] /pedidos total=2140ms plan@310ms inventario@840ms compra@2100ms
 *
 * Cada marca lleva el momento (desde el inicio) en que su fase TERMINÓ, así
 * las fases en paralelo se leen bien. Cuesta nada y deja de adivinarse dónde
 * se van los segundos: se miden.
 */
export interface Cronometro {
  marca(nombre: string): void;
  /** Envuelve una promesa y marca cuándo terminó. */
  medir<T>(nombre: string, p: Promise<T>): Promise<T>;
  fin(): void;
}

export function cronometro(pagina: string): Cronometro {
  const t0 = Date.now();
  const marcas: string[] = [];
  const marca = (nombre: string) => {
    marcas.push(`${nombre}@${Date.now() - t0}ms`);
  };
  return {
    marca,
    medir<T>(nombre: string, p: Promise<T>): Promise<T> {
      return p.then(
        (x) => {
          marca(nombre);
          return x;
        },
        (err) => {
          marca(`${nombre}!`);
          throw err;
        },
      );
    },
    fin() {
      console.log(`[tiempo] ${pagina} total=${Date.now() - t0}ms ${marcas.join(" ")}`);
    },
  };
}
