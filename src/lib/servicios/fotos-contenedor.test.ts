import { describe, expect, it } from "vitest";
import { correoDeFotos } from "./fotos-contenedor";

describe("correo de fotos que faltan por contenedor", () => {
  it("lista modelo, color, pedido y qué falta en cada canal; escapa el HTML", () => {
    const c = correoDeFotos({
      numero: "S259-2026",
      pedidos: ["IN10079", "IN10128"],
      productosDelContenedor: 3,
      faltantes: [
        { modelo: "GT190", color: "BLK/RED <x>", pedidos: ["IN10079"], meli: "Sin publicar", amazon: "Faltan fotos (tiene 1)" },
      ],
      errores: [],
    });
    expect(c.asunto).toBe("Contenedor S259-2026: 1 productos nuevos sin fotos");
    expect(c.html).toContain("BLK/RED &lt;x&gt;");
    expect(c.html).toContain("Sin publicar");
    expect(c.texto).toContain("- GT190 BLK/RED <x> [IN10079] · MELI: Sin publicar · Amazon: Faltan fotos (tiene 1)");
  });

  it("sin faltantes lo dice, y declara lo que no se pudo revisar", () => {
    const c = correoDeFotos({ numero: "S260-2026", pedidos: [], productosDelContenedor: 0, faltantes: [], errores: ["Amazon: sin credenciales"] });
    expect(c.asunto).toContain("ya tienen sus fotos");
    expect(c.html).toContain("No se pudo revisar todo: Amazon: sin credenciales");
  });
});
