import { describe, expect, it } from "vitest";
import { familiasMexico } from "./familias-mexico";

// El total por familia se arma ahora en el navegador con los renglones de la
// tabla de Bodega (sin `pedidos` ni `enCamino` en el tipo): mismo resultado.
describe("familiasMexico desde los renglones de la tabla de Bodega", () => {
  it("junta la familia, cuenta colores y deja fuera lo que no está en bodega", () => {
    const familias = familiasMexico(
      [
        { sku: "GT114-BLK-24", modelo: "GT114", color: "BLK", talla: "24", enBodega: 10 },
        { sku: "GT114-BLK-23", modelo: "GT114", color: "BLK", talla: "23", enBodega: 5 },
        { sku: "GT114-NAVY-25", modelo: "GT114", color: "NAVY", talla: "25", enBodega: 3 },
        { sku: "GT128-BLK-24", modelo: "GT128", color: "BLK", talla: "24", enBodega: 0 },
      ],
      { GT114: 2 },
    );
    expect(familias).toHaveLength(1);
    expect(familias[0]).toMatchObject({ modelo: "GT114", cajas: 2, pares: 18, colores: 2 });
    expect(familias[0].detalle.map((d) => d.sku)).toEqual(["GT114-BLK-23", "GT114-BLK-24", "GT114-NAVY-25"]);
  });
});
