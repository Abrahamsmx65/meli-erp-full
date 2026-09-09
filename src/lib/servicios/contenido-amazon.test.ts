/**
 * La lista de contenido es un recorte del catálogo de Amazon: del GT054 al
 * GT300, más MY2307 y G650. Estas pruebas protegen las dos cosas que se
 * rompen callando: el rango (dejar entrar un modelo viejo o dejar fuera uno
 * bueno) y el amarre modelo/color, que en Amazon viene con la talla a veces
 * antes del color.
 */
import { describe, expect, it } from "vitest";
import {
  armarContenido,
  asinsDeGrupo,
  enRangoContenido,
  modeloDeSku,
  leerCatalogo,
  urlAmazon,
  type AnotacionModelo,
  type FilaCatalogo,
} from "./contenido-amazon";

function dbCatalogo(
  respuestas: Record<string, { data: any[] | null; error: unknown; count?: number }>,
) {
  return {
    from: (tabla: string) => ({
      select: (_columnas: string, opciones?: { head?: boolean }) => {
        const q: any = {
          eq: () => q,
          order: () => q,
          range: () => q,
          then: (resolver: (valor: unknown) => unknown) => {
            const r = respuestas[tabla] ?? {
              data: null,
              error: { code: "PGRST205", message: `table ${tabla} does not exist` },
            };
            return Promise.resolve(
              opciones?.head ? { ...r, data: null, count: r.count ?? r.data?.length ?? 0 } : r,
            ).then(resolver);
          },
        };
        return q;
      },
    }),
  } as any;
}

const fila = (
  sellerSku: string,
  estado: string | null = "Active",
  extra: Partial<FilaCatalogo> = {},
): FilaCatalogo => ({
  sellerSku,
  asin: `A-${sellerSku}`,
  titulo: `GETAC ${sellerSku}`,
  estado,
  imagenUrl: null,
  ...extra,
});

const anotacion = (modelo: string, extra: Partial<AnotacionModelo> = {}): AnotacionModelo => ({
  modelo,
  categoria: null,
  prioridad: 0,
  imagenes: false,
  aplus: false,
  notas: "",
  eliminado: false,
  ...extra,
});

describe("enRangoContenido", () => {
  it("GT054 entra: es el primero del rango", () => {
    expect(enRangoContenido("GT054")).toBe(true);
  });

  it("GT053 queda fuera: es más viejo", () => {
    expect(enRangoContenido("GT053")).toBe(false);
  });

  it("GT300 entra", () => {
    expect(enRangoContenido("GT300")).toBe(true);
  });

  // Lo nuevo tiene que entrar SOLO: si el rango tuviera tope, cada modelo
  // que se publique quedaría invisible hasta que alguien tocara el código.
  it("GT301 entra: lo que se publique después no se queda fuera", () => {
    expect(enRangoContenido("GT301")).toBe(true);
  });

  it("GT1000 entra: el día que se les acaben los tres dígitos", () => {
    expect(enRangoContenido("GT1000")).toBe(true);
  });

  it("GT148G entra: la letra es variante, no otro modelo", () => {
    expect(enRangoContenido("GT148G")).toBe(true);
  });

  it("MY2307 entra aunque no sea GT", () => {
    expect(enRangoContenido("MY2307")).toBe(true);
  });

  it("MY2304 queda fuera: de los MY solo se trabaja el 2307", () => {
    expect(enRangoContenido("MY2304")).toBe(false);
  });

  it("G650 entra aunque no sea GT", () => {
    expect(enRangoContenido("G650")).toBe(true);
  });

  it("YH100 queda fuera aunque sea calzado", () => {
    expect(enRangoContenido("YH100")).toBe(false);
  });

  it("acepta minúsculas y espacios", () => {
    expect(enRangoContenido(" gt128 ")).toBe(true);
  });
});

describe("leerCatalogo", () => {
  it("conserva una respuesta válida vacía sin inventar catálogo histórico", async () => {
    const db = dbCatalogo({
      amazon_listings: { data: [], error: null },
      amazon_skus: {
        data: [{ seller_sku: "GT128-BLK-25-MX", asin: "HISTORICO" }],
        error: null,
      },
    });

    await expect(leerCatalogo(db, "amz-1")).resolves.toEqual({
      sinRefrescar: false,
      filas: [],
    });
  });

  it("propaga un timeout de listings en vez de fingir catálogo vacío", async () => {
    const db = dbCatalogo({
      amazon_listings: {
        data: null,
        error: { code: "57014", message: "statement timeout" },
      },
    });

    await expect(leerCatalogo(db, "amz-1")).rejects.toThrow(
      "amazon_listings: statement timeout",
    );
  });

  it("usa amazon_skus sólo cuando falta la tabla legacy de listings", async () => {
    const db = dbCatalogo({
      amazon_listings: {
        data: null,
        error: {
          code: "PGRST205",
          message: "Could not find amazon_listings in the schema cache",
        },
      },
      amazon_skus: {
        data: [{ seller_sku: "GT128-BLK-25-MX", asin: "A1", estado: "Active" }],
        error: null,
      },
    });

    await expect(leerCatalogo(db, "amz-1")).resolves.toMatchObject({
      sinRefrescar: true,
      filas: [{ sellerSku: "GT128-BLK-25-MX", asin: "A1" }],
    });
  });
});

describe("modeloDeSku", () => {
  it("saca el modelo del orden normal", () => {
    expect(modeloDeSku("GT110-NAVY-26-MX")).toBe("GT110");
  });

  it("saca el modelo aunque la talla venga antes del color", () => {
    expect(modeloDeSku("GT128-23-BLK-MX")).toBe("GT128");
  });

  it("la sub-variante del modelo no lo convierte en otro modelo", () => {
    expect(modeloDeSku("GT104-1-BLK-25-MX")).toBe("GT104");
  });

  it("aguanta colores con espacio", () => {
    expect(modeloDeSku("GT148G-DK BROWN-18-MX")).toBe("GT148G");
  });

  it("aguanta colores con diagonal", () => {
    expect(modeloDeSku("G650-BLK/RED-26-MX")).toBe("G650");
  });
});

describe("urlAmazon", () => {
  it("no hay link sin ASIN", () => {
    expect(urlAmazon(null, "MX")).toBeNull();
  });

  it("arma el link de la tienda de México", () => {
    expect(urlAmazon("B0F8K9JS8S", "MX")).toBe("https://www.amazon.com.mx/dp/B0F8K9JS8S");
  });

  it("un país desconocido cae a México", () => {
    expect(urlAmazon("B0F8K9JS8S", "ZZ")).toBe("https://www.amazon.com.mx/dp/B0F8K9JS8S");
  });
});

describe("armarContenido", () => {
  const catalogo: FilaCatalogo[] = [
    fila("GT128-23-BLK-MX"),
    fila("GT128-24-BLK-MX", "Inactive"),
    fila("GT128-23-PINK-MX", "Inactive"),
    fila("GT148G-DK BROWN-18-MX"),
    fila("G650-BLK/RED-26-MX"),
    fila("G650-BLK-RED-27-MX"),
    fila("MY2307-BLUE-25-MX"),
    fila("GT053-BLK-25-MX"),
  ];

  const armar = (
    filas = catalogo,
    anotaciones: AnotacionModelo[] = [],
    opciones = {},
  ) => armarContenido(filas, anotaciones, [], "MX", opciones);

  it("deja fuera lo viejo y deja entrar lo nuevo", () => {
    const modelos = armar([...catalogo, fila("GT450-BLK-25-MX")]).modelos.map((m) => m.modelo);
    expect(modelos).not.toContain("GT053");
    expect(modelos).toContain("GT450");
    expect(modelos).toEqual(expect.arrayContaining(["GT128", "GT148G", "G650", "MY2307"]));
  });

  it("agrupa las tallas de un color en un solo renglón de color", () => {
    const gt128 = armar().modelos.find((m) => m.modelo === "GT128")!;
    expect(gt128.skus).toBe(3);
    expect(gt128.colores.map((c) => c.color)).toEqual(["BLK", "PINK"]);
    expect(gt128.colores.find((c) => c.color === "BLK")!.skus).toBe(2);
  });

  it("BLK/RED y BLK-RED son el mismo color", () => {
    const g650 = armar().modelos.find((m) => m.modelo === "G650")!;
    expect(g650.colores).toHaveLength(1);
    expect(g650.colores[0].skus).toBe(2);
  });

  it("cuenta los activos y marca el modelo activo si le queda alguno", () => {
    const gt128 = armar().modelos.find((m) => m.modelo === "GT128")!;
    expect(gt128.activos).toBe(1);
    expect(gt128.activo).toBe(true);
  });

  it("un modelo sin ninguna publicación viva sale inactivo", () => {
    const solos = armar([fila("GT200-BLK-25-MX", "Inactive")]);
    expect(solos.modelos[0].activo).toBe(false);
    expect(solos.totales.inactivos).toBe(1);
  });

  it("el ASIN del color es el de la talla más chica ACTIVA", () => {
    const filas = [
      fila("GT160-BLK-22-MX", "Inactive"),
      fila("GT160-BLK-25-MX"),
      fila("GT160-BLK-26-MX"),
    ];
    const color = armar(filas).modelos[0].colores[0];
    expect(color.asin).toBe("A-GT160-BLK-25-MX");
  });

  it("el link del modelo apunta al color con más publicaciones vivas", () => {
    const gt128 = armar().modelos.find((m) => m.modelo === "GT128")!;
    expect(gt128.url).toBe("https://www.amazon.com.mx/dp/A-GT128-23-BLK-MX");
  });

  it("un modelo sin palomeos sale en ceros", () => {
    const gt128 = armar().modelos.find((m) => m.modelo === "GT128")!;
    expect(gt128).toMatchObject({ prioridad: 0, imagenes: false, aplus: false, categoria: null });
  });

  it("conserva lo palomeado y ordena por prioridad", () => {
    const r = armar(catalogo, [
      anotacion("MY2307", { prioridad: 5, aplus: true, categoria: "SANDALIA", notas: "urge" }),
    ]);
    expect(r.modelos[0].modelo).toBe("MY2307");
    expect(r.modelos[0]).toMatchObject({ prioridad: 5, aplus: true, categoria: "SANDALIA", notas: "urge" });
    expect(r.totales.conAplus).toBe(1);
  });

  it("un modelo eliminado no sale, pero se cuenta", () => {
    const r = armar(catalogo, [anotacion("G650", { eliminado: true })]);
    expect(r.modelos.map((m) => m.modelo)).not.toContain("G650");
    expect(r.totales.eliminados).toBe(1);
    expect(r.totales.modelos).toBe(3);
  });

  it("con verEliminados sí sale", () => {
    const r = armar(catalogo, [anotacion("G650", { eliminado: true })], { verEliminados: true });
    expect(r.modelos.map((m) => m.modelo)).toContain("G650");
  });

  // Lo que ya se anotó no se pierde cuando llegan productos nuevos: la lista
  // se deriva del catálogo y las anotaciones viven aparte, por modelo.
  it("marca como nuevo al que no tiene ni una anotación", () => {
    const r = armar(catalogo, [anotacion("GT128", { imagenes: true })]);
    expect(r.modelos.find((m) => m.modelo === "GT128")!.nuevo).toBe(false);
    expect(r.modelos.find((m) => m.modelo === "G650")!.nuevo).toBe(true);
    expect(r.totales.nuevos).toBe(3);
  });

  it("un modelo que ya se palomeó deja de ser nuevo sin perder lo palomeado", () => {
    const conNuevo = [...catalogo, fila("GT450-BLK-25-MX")];
    const antes = armar(conNuevo).modelos.find((m) => m.modelo === "GT450")!;
    expect(antes).toMatchObject({ nuevo: true, aplus: false });

    const despues = armar(conNuevo, [anotacion("GT450", { aplus: true, prioridad: 3 })]).modelos.find(
      (m) => m.modelo === "GT450",
    )!;
    expect(despues).toMatchObject({ nuevo: false, aplus: true, prioridad: 3 });
  });

  it("el link abre la publicación PADRE cuando ya se resolvió", () => {
    const padres = new Map([
      ["A-GT128-23-BLK-MX", { parentAsin: "B0PADRE128", titulo: "GETAC Zuecos GT128", imagenUrl: "https://img/padre128.jpg" }],
      ["A-GT128-23-PINK-MX", { parentAsin: "B0PADRE128", titulo: "GETAC Zuecos GT128", imagenUrl: "https://img/padre128.jpg" }],
    ]);
    const gt128 = armarContenido(catalogo, [], [], "MX", { padres }).modelos.find(
      (m) => m.modelo === "GT128",
    )!;
    expect(gt128.asin).toBe("B0PADRE128");
    expect(gt128.url).toBe("https://www.amazon.com.mx/dp/B0PADRE128");
    expect(gt128.titulo).toBe("GETAC Zuecos GT128");
    expect(gt128.codigos).toEqual(["GT128"]);
    // La miniatura es la foto MAIN del padre (el reporte de MX no trae fotos).
    expect(gt128.imagenUrl).toBe("https://img/padre128.jpg");
  });

  it("sin padre resuelto, el link sigue cayendo en un hijo vivo", () => {
    const gt128 = armar().modelos.find((m) => m.modelo === "GT128")!;
    expect(gt128.asin).toBe("A-GT128-23-BLK-MX");
    expect(gt128.codigos).toEqual(["GT128"]);
  });

  // El caso GT117…GT122: en Amazon varios códigos de bodega viven en la misma
  // publicación padre. Para quien trabaja el contenido son UNA página.
  const filasHermanos = [
    fila("GT117-BLK-25-MX"),
    fila("GT117-BLK-26-MX"),
    fila("GT118-NAVY-25-MX", "Inactive"),
    fila("GT119-RED-25-MX"),
    fila("GT120-GREY-25-MX"),
  ];
  const padresHermanos = new Map([
    ["A-GT117-BLK-25-MX", { parentAsin: "B0FAMILIA", titulo: "GETAC Zuecos Familia", imagenUrl: null }],
    ["A-GT118-NAVY-25-MX", { parentAsin: "B0FAMILIA", titulo: "GETAC Zuecos Familia", imagenUrl: null }],
    ["A-GT119-RED-25-MX", { parentAsin: "B0FAMILIA", titulo: null, imagenUrl: "https://img/familia.jpg" }],
  ]);

  it("los códigos que comparten padre se fusionan en un solo renglón", () => {
    const r = armarContenido(filasHermanos, [], [], "MX", { padres: padresHermanos });
    const grupo = r.modelos.find((m) => m.modelo === "GT117")!;
    expect(grupo.codigos).toEqual(["GT117", "GT118", "GT119"]);
    expect(grupo.asin).toBe("B0FAMILIA");
    expect(grupo.titulo).toBe("GETAC Zuecos Familia");
    expect(grupo.imagenUrl).toBe("https://img/familia.jpg");
    expect(grupo.skus).toBe(4);
    expect(grupo.colores.map((c) => `${c.modelo} ${c.color}`)).toEqual([
      "GT117 BLK",
      "GT118 NAVY",
      "GT119 RED",
    ]);
    // GT120 no tiene padre resuelto: sigue siendo su propio renglón.
    expect(r.modelos.find((m) => m.modelo === "GT120")!.codigos).toEqual(["GT120"]);
    expect(r.totales.modelos).toBe(2);
  });

  it("lo palomeado en cualquier código del grupo vale para el grupo entero", () => {
    const r = armarContenido(
      filasHermanos,
      [anotacion("GT119", { aplus: true, prioridad: 4, categoria: "CLOGS" })],
      [{ nombre: "CLOGS", creada: false, imagenes: false, paginaStore: false, notas: "" }],
      "MX",
      { padres: padresHermanos },
    );
    const grupo = r.modelos.find((m) => m.modelo === "GT117")!;
    expect(grupo).toMatchObject({ aplus: true, prioridad: 4, categoria: "CLOGS", nuevo: false });
    // La categoría cuenta UNA vez por publicación, no por código.
    expect(r.categorias[0].modelos).toBe(1);
  });

  it("quitar cualquier código del grupo oculta el renglón completo", () => {
    const r = armarContenido(filasHermanos, [anotacion("GT118", { eliminado: true })], [], "MX", {
      padres: padresHermanos,
    });
    expect(r.modelos.map((m) => m.modelo)).not.toContain("GT117");
    expect(r.totales.eliminados).toBe(1);
  });

  it("cuenta cuántos modelos usa cada categoría de la store", () => {
    const r = armarContenido(
      catalogo,
      [anotacion("GT128", { categoria: "CLOGS" }), anotacion("G650", { categoria: "CLOGS" })],
      [{ nombre: "CLOGS", creada: true, imagenes: false, paginaStore: false, notas: "" }],
      "MX",
    );
    expect(r.categorias[0].modelos).toBe(2);
    expect(r.totales.sinCategoria).toBe(2);
  });
});

describe("asinsDeGrupo", () => {
  const catalogo: FilaCatalogo[] = [
    fila("GT128-24-BLK-MX", "Inactive"),
    fila("GT128-23-PINK-MX"),
    fila("GT128-23-BLK-MX"),
    fila("GT128-25-BLK-MX", "Active", { asin: null }),
    fila("GT117-NAVY-26-MX"),
    fila("GT129-BLK-23-MX"),
  ];

  it("trae TODOS los hijos del grupo, ordenados modelo → color → talla", () => {
    const lista = asinsDeGrupo(catalogo, ["GT128", "GT117"]);
    expect(lista.map((a) => a.sellerSku)).toEqual([
      "GT117-NAVY-26-MX",
      "GT128-23-BLK-MX",
      "GT128-24-BLK-MX",
      "GT128-25-BLK-MX",
      "GT128-23-PINK-MX",
    ]);
  });

  it("no recorta a un representativo por color: el A+ se aplica por ASIN hijo", () => {
    const lista = asinsDeGrupo(catalogo, ["GT128"]);
    expect(lista.filter((a) => a.color === "BLK")).toHaveLength(3);
  });

  it("un SKU sin ASIN sale con la celda vacía para que se vea qué falta", () => {
    const lista = asinsDeGrupo(catalogo, ["GT128"]);
    const sinAsin = lista.find((a) => a.sellerSku === "GT128-25-BLK-MX");
    expect(sinAsin?.asin).toBeNull();
    expect(sinAsin?.talla).toBe("25");
  });

  it("deja fuera los códigos que no son del grupo", () => {
    const lista = asinsDeGrupo(catalogo, ["GT128"]);
    expect(lista.some((a) => a.modelo === "GT129")).toBe(false);
  });

  it("apunta el padre cuando ya se resolvió", () => {
    const padres = new Map([
      ["A-GT128-23-BLK-MX", { parentAsin: "PADRE1", titulo: null, imagenUrl: null }],
    ]);
    const lista = asinsDeGrupo(catalogo, ["GT128"], padres);
    expect(lista.find((a) => a.sellerSku === "GT128-23-BLK-MX")?.padre).toBe("PADRE1");
    expect(lista.find((a) => a.sellerSku === "GT128-24-BLK-MX")?.padre).toBeNull();
  });
});
