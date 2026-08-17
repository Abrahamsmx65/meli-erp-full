/**
 * Generador de datos sintéticos.
 *
 * Sirve para dos cosas: probar la app sin conectar Mercado Libre, y —más
 * importante— verificar el motor. Como aquí SÍ conocemos la demanda real de
 * cada SKU (la usamos para simular), podemos comprobar que el sistema la
 * recupera aunque el producto haya estado agotado la mitad del periodo.
 */
import { aISO, sumarDias } from "./engine/fechas";
import type {
  Caja,
  ISODate,
  InventarioPropio,
  OperacionStock,
  SnapshotStock,
  StockFull,
  VentaDiaria,
} from "./engine/types";

/** PRNG determinista: mismos datos en cada corrida. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Muestra de Poisson (Knuth para lambda chico, normal para lambda grande). */
function poisson(rand: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rand();
    } while (p > L && k < 1000);
    return k - 1;
  }
  const u1 = Math.max(1e-9, rand());
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
}

export interface SkuSintetico {
  sku: string;
  titulo: string;
  /** demanda diaria REAL usada para simular — la verdad que el motor debe recuperar */
  demandaReal: number;
  /** crecimiento diario compuesto (1.0 = plano) */
  tendencia: number;
  /** qué tan seguido se queda sin stock: 0 = nunca, 1 = mucho */
  severidadQuiebre: number;
}

export const SKUS_DEMO: SkuSintetico[] = [
  { sku: "TAZ-BLA-350", titulo: "Taza cerámica blanca 350ml",        demandaReal: 22, tendencia: 1.000, severidadQuiebre: 0.0 },
  { sku: "TAZ-NEG-350", titulo: "Taza cerámica negra 350ml",         demandaReal: 14, tendencia: 1.004, severidadQuiebre: 0.6 },
  { sku: "TER-ACE-1L",  titulo: "Termo acero inoxidable 1L",         demandaReal: 31, tendencia: 1.006, severidadQuiebre: 0.8 },
  { sku: "TER-ACE-500", titulo: "Termo acero inoxidable 500ml",      demandaReal: 18, tendencia: 0.998, severidadQuiebre: 0.2 },
  { sku: "VAS-VID-500", titulo: "Vaso vidrio templado 500ml",        demandaReal: 9,  tendencia: 1.000, severidadQuiebre: 0.0 },
  { sku: "VAS-VID-330", titulo: "Vaso vidrio templado 330ml",        demandaReal: 5,  tendencia: 0.995, severidadQuiebre: 0.1 },
  { sku: "PLA-BAM-25",  titulo: "Plato bambú 25cm",                  demandaReal: 12, tendencia: 1.008, severidadQuiebre: 0.4 },
  { sku: "PLA-BAM-20",  titulo: "Plato bambú 20cm",                  demandaReal: 7,  tendencia: 1.000, severidadQuiebre: 0.0 },
  { sku: "CUB-SET-24",  titulo: "Set cubiertos 24 piezas",           demandaReal: 3,  tendencia: 1.000, severidadQuiebre: 0.3 },
  { sku: "TAB-MAD-40",  titulo: "Tabla de madera 40cm",              demandaReal: 1.5,tendencia: 1.000, severidadQuiebre: 0.0 },
];

export interface DatosDemo {
  skus: { sku: string; titulo: string }[];
  stockActual: StockFull[];
  ventas: VentaDiaria[];
  snapshots: SnapshotStock[];
  operaciones: OperacionStock[];
  inventarioPropio: InventarioPropio[];
  cajas: Caja[];
  hoy: ISODate;
  /**
   * Demanda real por SKU AL FINAL de la ventana — solo para verificación.
   * Es la referencia correcta contra la cual medir un pronóstico: lo que
   * importa no es el promedio histórico sino a qué ritmo va vendiendo hoy.
   */
  verdad: Map<string, number>;
}

export function generarDatosDemo(opts?: {
  dias?: number;
  hoy?: ISODate;
  seed?: number;
}): DatosDemo {
  const dias = opts?.dias ?? 90;
  const hoy = opts?.hoy ?? aISO(new Date());
  const rand = mulberry32(opts?.seed ?? 20260817);
  const desde = sumarDias(hoy, -(dias - 1));

  const ventas: VentaDiaria[] = [];
  const snapshots: SnapshotStock[] = [];
  const stockActual: StockFull[] = [];
  const inventarioPropio: InventarioPropio[] = [];
  const verdad = new Map<string, number>();

  for (const s of SKUS_DEMO) {
    // La verdad que un pronóstico debe acertar es el ritmo AL CIERRE de la
    // ventana, no el promedio del periodo: un SKU que creció 8% al mes no
    // debe reponerse al ritmo que tenía hace tres meses.
    verdad.set(s.sku, s.demandaReal * Math.pow(s.tendencia, dias - 1));

    // Arranca con cobertura razonable; los SKUs propensos a quiebre, con menos.
    let stock = Math.round(s.demandaReal * (s.severidadQuiebre > 0.5 ? 10 : 35));
    let diasDesdeReposicion = 0;

    for (let i = 0; i < dias; i++) {
      const fecha = sumarDias(desde, i);
      const lambda = s.demandaReal * Math.pow(s.tendencia, i);

      // 1) La reposición se recibe en la mañana, antes de vender.
      //    (Importante: si se sumara después del snapshot, la serie diaria
      //    quedaría inconsistente y el motor vería inicios de día falsos.)
      diasDesdeReposicion++;
      const cadaCuanto = s.severidadQuiebre > 0.5 ? 26 : 14;
      const alcanza = s.severidadQuiebre > 0.5 ? 12 : 30;
      if (diasDesdeReposicion >= cadaCuanto && rand() < 0.8) {
        stock += Math.round(s.demandaReal * alcanza * (0.8 + rand() * 0.4));
        diasDesdeReposicion = 0;
      }

      // 2) Demanda que EXISTIÓ ese día (la haya podido surtir o no).
      const demandaDia = poisson(rand, lambda);
      const vendido = Math.min(demandaDia, stock);
      stock -= vendido;

      // 3) Foto al cierre del día.
      ventas.push({ sku: s.sku, fecha, unidades: vendido, ordenes: vendido, importe: vendido * 199 });
      snapshots.push({ sku: s.sku, fecha, disponible: stock, enTransferencia: 0, origen: "snapshot" });
    }

    const enTransferencia = rand() < 0.35 ? Math.round(s.demandaReal * 5) : 0;
    stockActual.push({
      sku: s.sku,
      disponible: stock,
      enTransferencia,
      noDisponible: rand() < 0.2 ? Math.round(rand() * 4) : 0,
      total: stock + enTransferencia,
    });

    inventarioPropio.push({
      sku: s.sku,
      unidades: Math.round(s.demandaReal * (25 + rand() * 40)),
    });
  }

  // Operaciones derivadas de los snapshots (lo que devolvería la API de MELI).
  const operaciones: OperacionStock[] = [];
  const porSku = new Map<string, SnapshotStock[]>();
  for (const s of snapshots) {
    const l = porSku.get(s.sku);
    if (l) l.push(s);
    else porSku.set(s.sku, [s]);
  }
  for (const [sku, lista] of porSku) {
    lista.sort((a, b) => a.fecha.localeCompare(b.fecha));
    let prev = lista[0].disponible;
    for (let i = 1; i < lista.length; i++) {
      const delta = lista[i].disponible - prev;
      if (delta !== 0) {
        operaciones.push({
          sku,
          fecha: `${lista[i].fecha}T12:00:00.000Z`,
          tipo: delta > 0 ? "inbound" : "sale",
          deltaDisponible: delta,
          resultadoDisponible: lista[i].disponible,
        });
      }
      prev = lista[i].disponible;
    }
  }

  // Cajas mixtas: corridas reales suelen agrupar familia de producto.
  const cajas: Caja[] = [
    {
      codigo: "CJ-TAZAS-A",
      nombre: "Corrida tazas surtidas",
      cajasDisponibles: 40,
      items: [
        { sku: "TAZ-BLA-350", piezas: 24 },
        { sku: "TAZ-NEG-350", piezas: 12 },
      ],
    },
    {
      codigo: "CJ-TAZAS-B",
      nombre: "Corrida tazas blancas",
      cajasDisponibles: 30,
      items: [{ sku: "TAZ-BLA-350", piezas: 36 }],
    },
    {
      codigo: "CJ-TERMOS",
      nombre: "Corrida termos mixta",
      cajasDisponibles: 50,
      items: [
        { sku: "TER-ACE-1L", piezas: 18 },
        { sku: "TER-ACE-500", piezas: 12 },
      ],
    },
    {
      codigo: "CJ-TERMO-1L",
      nombre: "Corrida termo 1L",
      cajasDisponibles: 40,
      items: [{ sku: "TER-ACE-1L", piezas: 24 }],
    },
    {
      codigo: "CJ-VIDRIO",
      nombre: "Corrida vidrio surtido",
      cajasDisponibles: 25,
      items: [
        { sku: "VAS-VID-500", piezas: 16 },
        { sku: "VAS-VID-330", piezas: 16 },
      ],
    },
    {
      codigo: "CJ-MESA",
      nombre: "Corrida mesa (bambú + cubiertos)",
      cajasDisponibles: 20,
      items: [
        { sku: "PLA-BAM-25", piezas: 20 },
        { sku: "PLA-BAM-20", piezas: 20 },
        { sku: "CUB-SET-24", piezas: 6 },
      ],
    },
    {
      codigo: "CJ-TABLAS",
      nombre: "Corrida tablas",
      cajasDisponibles: 10,
      items: [{ sku: "TAB-MAD-40", piezas: 12 }],
    },
  ];

  return {
    skus: SKUS_DEMO.map((s) => ({ sku: s.sku, titulo: s.titulo })),
    stockActual,
    ventas,
    snapshots,
    operaciones,
    inventarioPropio,
    cajas,
    hoy,
    verdad,
  };
}
