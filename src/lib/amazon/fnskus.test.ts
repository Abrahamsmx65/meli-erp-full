import { test, expect } from "vitest";
import { fnskusDeRespuesta, partirEnLotes } from "./fnskus";

const MX = "A1AM78C64UM0Y8";

test("saca el FNSKU del bloque del marketplace y null cuando la publicación no tiene", () => {
  const r = fnskusDeRespuesta(
    {
      items: [
        {
          sku: "MY2304-PURPLE-23-MX",
          summaries: [
            { marketplaceId: "OTRO", fnSku: "X000MALO" },
            { marketplaceId: MX, fnSku: "X003ZUAAAA", itemName: "Chanclas" },
          ],
        },
        { sku: "GT100-BLK-25-MX", summaries: [{ marketplaceId: MX }] },
        { sku: "   " },
      ],
    },
    MX,
  );
  expect(r.get("MY2304-PURPLE-23-MX")).toBe("X003ZUAAAA");
  expect(r.get("GT100-BLK-25-MX")).toBeNull();
  expect(r.size).toBe(2);
  expect(fnskusDeRespuesta(null, MX).size).toBe(0);
});

test("parte en lotes de 20 y aparta los SKUs con coma", () => {
  const skus = Array.from({ length: 45 }, (_, i) => `SKU-${i}`);
  const { lotes, imposibles } = partirEnLotes([...skus, "RARO,CON,COMA", "SKU-1", " "]);
  expect(lotes.map((l) => l.length)).toEqual([20, 20, 5]);
  expect(imposibles).toEqual(["RARO,CON,COMA"]);
});
