/**
 * El orden del despacho: por modelo, luego color, luego talla.
 *
 * Es el orden en que se camina la bodega: todos los GT135 juntos, dentro
 * de ellos por color, y dentro del color de la talla chica a la grande. La
 * lista de empaque y el PDF de etiquetas van en ESTE orden y con LOS MISMOS
 * números, para que la etiqueta #12 sea el renglón #12 sin buscar.
 */

export interface ParDespacho {
  /** SKU del ERP (MODELO-COLOR-TALLA); si no se amarró, el de TikTok */
  sku: string;
  pares: number;
}

export interface PaqueteDespacho {
  orderId: string;
  packageId: string;
  destinatario: string | null;
  pares: ParDespacho[];
}

export interface PaqueteNumerado extends PaqueteDespacho {
  /** el número que se imprime en la etiqueta y en la lista */
  numero: number;
  modelo: string;
  color: string;
  talla: string;
}

/** MODELO-COLOR-TALLA → sus tres pedazos; lo que no cuadre se va al final. */
export function partirSku(sku: string): { modelo: string; color: string; talla: string } {
  const partes = String(sku ?? "").trim().split("-").filter(Boolean);
  // Sufijo de país al final (GT135-DK BROWN-26-MX): fuera.
  if (partes.length >= 4 && /^(MX|MLM|US)$/i.test(partes[partes.length - 1])) partes.pop();
  if (partes.length < 3) {
    return { modelo: partes[0] ?? "", color: partes.slice(1).join("-"), talla: "" };
  }
  return {
    modelo: partes[0],
    color: partes.slice(1, -1).join("-"),
    talla: partes[partes.length - 1],
  };
}

function tallaNumerica(t: string): number {
  const n = Number(String(t).replace(",", "."));
  return Number.isFinite(n) ? n : 999;
}

function compararSku(a: string, b: string): number {
  const x = partirSku(a);
  const y = partirSku(b);
  return (
    x.modelo.localeCompare(y.modelo, "es") ||
    x.color.localeCompare(y.color, "es") ||
    tallaNumerica(x.talla) - tallaNumerica(y.talla) ||
    a.localeCompare(b, "es")
  );
}

/**
 * Ordena y numera los paquetes. El paquete se ordena por su PRIMER par (ya
 * ordenado); un paquete con dos tallas cae donde cae la menor.
 */
export function numerarPaquetes(paquetes: PaqueteDespacho[]): PaqueteNumerado[] {
  const conOrden = paquetes.map((p) => ({
    ...p,
    pares: [...p.pares].sort((a, b) => compararSku(a.sku, b.sku)),
  }));
  conOrden.sort(
    (a, b) =>
      compararSku(a.pares[0]?.sku ?? "", b.pares[0]?.sku ?? "") || a.orderId.localeCompare(b.orderId),
  );
  return conOrden.map((p, i) => {
    const primero = partirSku(p.pares[0]?.sku ?? "");
    return { ...p, numero: i + 1, ...primero };
  });
}

/** El texto que va abajo a la derecha de la etiqueta: "#12 · GT135-DK BROWN-26". */
export function textoDeEtiqueta(p: PaqueteNumerado): string {
  const skus = p.pares.map((x) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(" · ");
  return `#${p.numero} · ${skus}`;
}

export interface GrupoModelo {
  modelo: string;
  pares: number;
  paquetes: PaqueteNumerado[];
}

/** La lista de empaque: por modelo, en el mismo orden y con los mismos números. */
export function agruparPorModelo(numerados: PaqueteNumerado[]): GrupoModelo[] {
  const grupos: GrupoModelo[] = [];
  for (const p of numerados) {
    const ultimo = grupos[grupos.length - 1];
    const pares = p.pares.reduce((a, x) => a + x.pares, 0);
    if (ultimo && ultimo.modelo === p.modelo) {
      ultimo.paquetes.push(p);
      ultimo.pares += pares;
    } else {
      grupos.push({ modelo: p.modelo, pares, paquetes: [p] });
    }
  }
  return grupos;
}
