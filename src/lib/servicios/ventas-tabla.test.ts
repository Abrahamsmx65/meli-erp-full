import { describe, expect, it } from "vitest";
import type { FilaModelo } from "./ventas-monitor";
import {
  compactarFilasModelo,
  prepararFilasTabla,
  totalizarFilasTabla,
  type ClaveTablaVentas,
} from "./ventas-tabla";

const base: FilaModelo[] = [
  { modelo: "GT114", categoria: "Botas", colores: 3, unidadesHoy: 2, unidades7: 12, unidades7Prev: 8, importe7: 2400, neto7: 1800, publicidad7: 100, ganancia7: 700 },
  { modelo: "ALFA", categoria: null, colores: 1, unidadesHoy: 0, unidades7: 4, unidades7Prev: 7, importe7: 700, neto7: 500, publicidad7: null, ganancia7: null },
  { modelo: "BETA", categoria: "Tenis", colores: 2, unidadesHoy: 1, unidades7: 9, unidades7Prev: 9, importe7: 1500, neto7: 1100, publicidad7: 0, ganancia7: -50 },
];

function referencia(
  filas: FilaModelo[],
  busqueda: string,
  categoria: string,
  orden: { clave: ClaveTablaVentas; desc: boolean },
) {
  const q = busqueda.trim().toUpperCase();
  const valor = (f: FilaModelo) => orden.clave === "cambio" ? f.unidades7 - f.unidades7Prev : f[orden.clave];
  const dir = orden.desc ? -1 : 1;
  return filas.filter((f) => {
    if (categoria && (f.categoria ?? "Sin categoría") !== categoria) return false;
    return !q || f.modelo.toUpperCase().includes(q) || q.startsWith(f.modelo.toUpperCase() + "-");
  }).sort((a, b) => {
    const va = valor(a);
    const vb = valor(b);
    if (va == null && vb == null) return a.modelo.localeCompare(b.modelo, "es");
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" || typeof vb === "string") return dir * String(va).localeCompare(String(vb), "es");
    return dir * (va - vb) || a.modelo.localeCompare(b.modelo, "es");
  });
}

describe("tabla de ventas compacta", () => {
  it("conserva búsqueda por modelo/SKU, filtros, todos los órdenes y totales", () => {
    const compactas = compactarFilasModelo(base);
    const consultas = [
      { q: "", categoria: "" },
      { q: "GT114-NEGRO-25", categoria: "" },
      { q: "", categoria: "Sin categoría" },
      { q: "be", categoria: "Tenis" },
    ];
    const claves: ClaveTablaVentas[] = ["modelo", "categoria", "colores", "unidadesHoy", "unidades7", "unidades7Prev", "cambio", "importe7", "neto7", "publicidad7", "ganancia7"];

    for (const consulta of consultas) {
      for (const clave of claves) {
        for (const desc of [false, true]) {
          const orden = { clave, desc };
          const actual = prepararFilasTabla(compactas, consulta.q, consulta.categoria, orden);
          const esperado = referencia([...base], consulta.q, consulta.categoria, orden);
          expect(actual).toEqual(esperado);
          expect(totalizarFilasTabla(actual)).toEqual(totalizarFilasTabla(esperado));
        }
      }
    }
  });

  it("reduce el payload serializado y procesa un catálogo 10 veces mayor", () => {
    const grande = Array.from({ length: 5_000 }, (_, i): FilaModelo => ({
      ...base[i % base.length],
      modelo: `${base[i % base.length].modelo}-${String(i).padStart(4, "0")}`,
    }));
    const compacto = compactarFilasModelo(grande);
    const bytesAntes = Buffer.byteLength(JSON.stringify(grande));
    const bytesDespues = Buffer.byteLength(JSON.stringify(compacto));
    expect(bytesDespues).toBeLessThan(bytesAntes * 0.55);

    const inicio = performance.now();
    const resultado = prepararFilasTabla(compacto, "", "", { clave: "ganancia7", desc: true });
    const duracion = performance.now() - inicio;
    expect(resultado).toHaveLength(grande.length);
    expect(duracion).toBeLessThan(250);
  });
});