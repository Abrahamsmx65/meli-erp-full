import { describe, expect, it } from "vitest";
import {
  FOTOS_MINIMAS,
  calcularFaltantes,
  estimarLlegadas,
  resumirRevision,
  type ModeloNuevo,
  type RevisionModelo,
} from "./modelos-nuevos";
import { coloresAmazonDeModelos } from "./modelos-nuevos-revisar";

const revision: RevisionModelo = {
  en: "2026-09-06T10:00:00Z",
  meli: {
    publicaciones: [
      { itemId: "MLM1", color: "BLK", titulo: "GT265 negro", estado: "active", fotos: 6, video: false, permalink: null },
      { itemId: "MLM2", color: "TAN", titulo: "GT265 tan", estado: "active", fotos: 1, video: true, permalink: null },
      { itemId: "MLM3", color: "RED", titulo: "GT265 rojo", estado: "paused", fotos: 0, video: false, permalink: null },
    ],
    error: null,
  },
  amazon: {
    colores: [
      { modelo: "GT265", color: "BLK", asin: "B01", estado: "Active", fotos: 7, aplus: true, url: null },
      { modelo: "GT265", color: "TAN", asin: "B02", estado: "Active", fotos: 1, aplus: false, url: null },
      { modelo: "GT265", color: "RED", asin: "B03", estado: "Inactive", fotos: null, aplus: null, url: null },
    ],
    error: null,
    aplusAviso: null,
  },
};

describe("resumirRevision", () => {
  it("cuenta fotos, video y A+ por lado", () => {
    const r = resumirRevision(revision);
    expect(r.meli).toEqual({
      publicaciones: 3,
      activas: 2,
      fotosMin: 0,
      fotosMax: 6,
      sinFotos: 2,
      conVideo: 1,
    });
    expect(r.amazon).toEqual({
      colores: 3,
      activos: 2,
      fotosMin: 1,
      fotosMax: 7,
      sinFotos: 1,
      conAplus: 1,
      sinAplus: 1,
      aplusDesconocido: 1,
    });
  });

  it("sin revisión no inventa nada", () => {
    expect(resumirRevision(null)).toEqual({ meli: null, amazon: null });
    expect(FOTOS_MINIMAS).toBe(2);
  });
});

describe("estimarLlegadas", () => {
  const pedidos = [
    { id: "p1", pedido: "PI-100", estado: "en_transito" },
    { id: "p2", pedido: "PI-101", estado: "creado" },
    { id: "p3", pedido: "PI-050", estado: "cancelado" },
    { id: "p4", pedido: "PI-099", estado: "recibido" },
  ];
  const lineas = [
    { id: "l1", pedido_id: "p1", modelo: "GT251" },
    { id: "l2", pedido_id: "p1", modelo: "GT252" },
    { id: "l3", pedido_id: "p2", modelo: "GT253" },
    { id: "l4", pedido_id: "p3", modelo: "GT254" },
    { id: "l5", pedido_id: "p4", modelo: "GT229" },
    { id: "l6", pedido_id: "p1", modelo: "gt251" },
  ];
  const contenedores = [
    { id: "c1", numero: "12", estado: "en_transito", fecha_llegada_est: "2026-10-05", fecha_llegada_real: null, lineas: ["l1", "l6"] },
    { id: "c2", numero: "13", estado: "en_transito", fecha_llegada_est: "2026-09-20", fecha_llegada_real: null, lineas: ["l1", "l2"] },
    { id: "c3", numero: "11", estado: "recibido", fecha_llegada_est: "2026-08-01", fecha_llegada_real: "2026-08-03", lineas: ["l5"] },
  ];

  it("toma el contenedor que llega primero", () => {
    const l = estimarLlegadas(pedidos, lineas, contenedores);
    expect(l.get("GT251")).toEqual({
      estado: "en_camino",
      fecha: "2026-09-20",
      texto: "Contenedor 13 · ETA",
      pedidos: ["PI-100"],
    });
  });

  it("un pedido sin contenedor lo dice; uno cancelado no cuenta", () => {
    const l = estimarLlegadas(pedidos, lineas, contenedores);
    expect(l.get("GT253")).toMatchObject({ estado: "sin_contenedor", fecha: null, texto: "Pedido PI-101 sin contenedor" });
    expect(l.has("GT254")).toBe(false);
  });

  it("lo ya recibido dice cuándo llegó", () => {
    const l = estimarLlegadas(pedidos, lineas, contenedores);
    expect(l.get("GT229")).toMatchObject({ estado: "llego", fecha: "2026-08-03", texto: "Llegó en el contenedor 11" });
  });
});

const base: Omit<ModeloNuevo, "faltantes"> = {
  modelo: "GT265",
  titulo: null,
  categoria: "CORCHO FRIO",
  precioNormal: 299,
  precioRelampago: null,
  costoTotal: 80,
  llegadaEstimada: null,
  llegadaAuto: { estado: "en_camino", fecha: "2026-10-01", texto: "Contenedor 12 · ETA", pedidos: ["PI-100"] },
  publicadoMeli: true,
  publicadoAmazon: true,
  imagenesRecibidas: true,
  imagenesEnviadas: true,
  meliClip: true,
  amazonVideo: true,
  aplusCargado: false,
  notas: "",
  listo: false,
  revision,
  revisadoEn: revision.en,
  resumen: resumirRevision(revision),
};

describe("calcularFaltantes", () => {
  it("lee la revisión: fotos que faltan en MELI y Amazon, y el A+ por color", () => {
    expect(calcularFaltantes(base, { hayAmazon: true })).toEqual([
      "MELI: fotos en 2 de 3",
      "Amazon: fotos en 1 de 3",
      "Amazon: A+ en 1 de 3",
    ]);
  });

  it("el A+ ya mandado a cargar deja de faltar", () => {
    expect(calcularFaltantes({ ...base, aplusCargado: true }, { hayAmazon: true })).toEqual([
      "MELI: fotos en 2 de 3",
      "Amazon: fotos en 1 de 3",
    ]);
  });

  it("un modelo sin nada capturado ni publicado lista todo lo básico", () => {
    const vacio: Omit<ModeloNuevo, "faltantes"> = {
      ...base,
      categoria: null,
      precioNormal: null,
      costoTotal: null,
      llegadaAuto: null,
      publicadoMeli: false,
      publicadoAmazon: false,
      imagenesRecibidas: false,
      imagenesEnviadas: false,
      meliClip: false,
      amazonVideo: false,
      revision: null,
      resumen: { meli: null, amazon: null },
    };
    expect(calcularFaltantes(vacio, { hayAmazon: true })).toEqual([
      "Categoría",
      "Costo",
      "Precio de venta",
      "Fecha de llegada",
      "Imágenes de China",
      "Publicar en MELI",
      "Publicar en Amazon",
    ]);
    // Sin cuenta de Amazon, Amazon no se reclama.
    expect(calcularFaltantes(vacio, { hayAmazon: false })).not.toContain("Publicar en Amazon");
  });

  it("publicado pero sin revisar lo pide; con todo en orden no falta nada", () => {
    const sinRevisar = { ...base, revision: null, resumen: { meli: null, amazon: null } };
    expect(calcularFaltantes(sinRevisar, { hayAmazon: true })).toEqual(["MELI: sin revisar", "Amazon: sin revisar"]);

    const completo: RevisionModelo = {
      ...revision,
      meli: { publicaciones: revision.meli!.publicaciones.map((p) => ({ ...p, fotos: 5 })), error: null },
      amazon: { colores: revision.amazon!.colores.map((c) => ({ ...c, fotos: 5, aplus: true })), error: null, aplusAviso: null },
    };
    expect(
      calcularFaltantes({ ...base, revision: completo, resumen: resumirRevision(completo) }, { hayAmazon: true }),
    ).toEqual([]);
  });

  it("la llegada capturada a mano vale aunque no haya contenedor", () => {
    const m = { ...base, llegadaAuto: null, llegadaEstimada: "2026-11-01" };
    expect(calcularFaltantes(m, { hayAmazon: false })).not.toContain("Fecha de llegada");
  });
});

describe("coloresAmazonDeModelos", () => {
  it("un ASIN por color, el activo de la talla más chica, y entiende la talla antes del color", () => {
    const filas = [
      { seller_sku: "GT265-BLK-27-MX", asin: "B27", estado: "Inactive" },
      { seller_sku: "GT265-BLK-23-MX", asin: "B23", estado: "Active" },
      { seller_sku: "GT265-BLK-25-MX", asin: "B25", estado: "Active" },
      { seller_sku: "GT265-24-TAN-MX", asin: "T24", estado: "Inactive" },
      { seller_sku: "GT104-BLK-23-MX", asin: "X", estado: "Active" },
    ];
    const r = coloresAmazonDeModelos(filas, new Set(["GT265"]));
    expect([...r.keys()]).toEqual(["GT265"]);
    const colores = r.get("GT265")!;
    expect(colores.map((c) => [c.color, c.asin, c.estado])).toEqual([
      ["BLK", "B23", "Active"],
      ["TAN", "T24", "Inactive"],
    ]);
  });
});
