import { describe, expect, it } from "vitest";
import { coincide, filtrarBodega, terminosDeBusqueda, type RenglonBodegaFiltrable } from "./filtro";

describe("búsqueda del plan", () => {
  const t = terminosDeBusqueda;

  it("sin búsqueda deja pasar todo", () => {
    expect(coincide("GT110-NAVY-26-MX", t(""))).toBe(true);
    expect(coincide("lo que sea", t(null))).toBe(true);
  });

  it("filtra por modelo", () => {
    expect(coincide("GT110-NAVY-26-MX", t("GT110"))).toBe(true);
    expect(coincide("GT143-NAVY-26-MX", t("GT110"))).toBe(false);
  });

  it("no distingue mayúsculas", () => {
    expect(coincide("GT110-NAVY-26-MX", t("gt110"))).toBe(true);
  });

  it("exige todas las palabras, en cualquier orden", () => {
    expect(coincide("GT110-NAVY-26-MX", t("gt110 navy"))).toBe(true);
    expect(coincide("GT110-NAVY-26-MX", t("navy gt110"))).toBe(true);
    expect(coincide("GT110-NAVY-26-MX", t("gt110 cream"))).toBe(false);
  });

  it("encuentra colores con espacio", () => {
    expect(coincide("GT135-DK BROWN-25-MX", t("dk brown"))).toBe(true);
    expect(coincide("GT135-DK BROWN-25-MX", t("brown dk 25"))).toBe(true);
  });

  it("ignora espacios de más", () => {
    expect(coincide("GT110-NAVY-26-MX", t("  gt110   navy  "))).toBe(true);
  });
});

describe("paridad pantalla ↔ Excel en Bodega", () => {
  const renglon = (
    sku: string,
    enBodega: number,
    enCamino: number,
    pedidos: { pedido: string; almacen: string }[] = [],
  ): RenglonBodegaFiltrable => {
    const [modelo, color, talla] = sku.split("|");
    return { sku: `${modelo}-${color}-${talla}-MX`, modelo, color, talla, enBodega, enCamino, pedidos };
  };

  const renglones = [
    renglon("GT110|NAVY|26", 24, 0, [{ pedido: "IN10001", almacen: "Caseshop" }]),
    renglon("GT110|NAVY|27", 0, 12, [{ pedido: "IN10002", almacen: "Industher" }]),
    renglon("GT135|DK BROWN|25", 0, 0, []),
    renglon("GT143|CREAM|24", 6, 6, [
      { pedido: "IN10001", almacen: "Caseshop" },
      { pedido: "IN10003", almacen: "Industher" },
    ]),
  ];

  /** Cómo la tabla serializa sus filtros en la URL del botón «Excel de esta vista». */
  const urlDeLaPantalla = (busqueda: string, almacen: string, soloConExistencia: boolean) => {
    const p = new URLSearchParams();
    if (busqueda.trim()) p.set("q", busqueda.trim());
    if (almacen) p.set("almacen", almacen);
    if (!soloConExistencia) p.set("conCeros", "1");
    return p;
  };

  /** Cómo /api/inventario/excel lee esa URL. */
  const filtroDelExcel = (p: URLSearchParams) => ({
    q: p.get("q"),
    almacen: p.get("almacen") || "",
    conCeros: p.get("conCeros") === "1",
  });

  it("la pantalla y el Excel cuentan los mismos renglones con cualquier combinación de filtros", () => {
    const combinaciones: [string, string, boolean][] = [
      ["", "", true],
      ["", "", false],
      ["gt110", "", true],
      ["  navy   gt110 ", "", false],
      ["IN10001", "", true],
      ["", "Industher", true],
      ["", "Caseshop", false],
      ["in10003", "Industher", true],
      ["dk brown", "", false],
      ["nada-que-exista", "", false],
    ];
    for (const [busqueda, almacen, soloConExistencia] of combinaciones) {
      const pantalla = filtrarBodega(renglones, {
        q: busqueda,
        almacen,
        conCeros: !soloConExistencia,
      });
      const excel = filtrarBodega(renglones, filtroDelExcel(urlDeLaPantalla(busqueda, almacen, soloConExistencia)));
      expect(excel.map((r) => r.sku)).toEqual(pantalla.map((r) => r.sku));
    }
  });

  it("filtra como la vista: existencia, bodega y pedido", () => {
    // Por defecto («Solo con existencia») el SKU en cero no aparece.
    expect(filtrarBodega(renglones, {}).map((r) => r.talla)).toEqual(["26", "27", "24"]);
    // Con ceros aparece todo.
    expect(filtrarBodega(renglones, { conCeros: true })).toHaveLength(4);
    // Por bodega: solo los renglones con algún pedido en ese almacén.
    expect(filtrarBodega(renglones, { almacen: "Industher" }).map((r) => r.talla)).toEqual(["27", "24"]);
    // Buscar por número de pedido también cuenta.
    expect(filtrarBodega(renglones, { q: "IN10003" })).toHaveLength(1);
  });
});
