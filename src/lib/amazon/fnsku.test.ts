/**
 * Lectura de la respuesta del API de inventario FBA, que es de donde sale el
 * FNSKU de los SKUs que el reporte diario no alcanza.
 */
import { test, expect } from "vitest";
import { resumenesFba, POR_LLAMADA } from "./fnsku";

function clienteFalso(respuesta: unknown, espia?: (params: any) => void) {
  return {
    cuenta: { marketplaceId: "A1AM78C64UM0Y8", accountId: "cuenta" },
    llamar: async (_m: string, _r: string, _o: string, opciones: any) => {
      espia?.(opciones.params);
      return respuesta;
    },
  } as any;
}

test("saca el FNSKU de cada resumen y pregunta por los SKUs pedidos", () => {
  let params: any = null;
  const cliente = clienteFalso(
    {
      payload: {
        inventorySummaries: [
          { sellerSku: "456-A06", fnSku: "X004ABCDEF", asin: "B0DBRM5F6H" },
          { sellerSku: "657-A11-blk", fnSku: "X004GHIJKL" },
          // Un SKU que Amazon conoce pero que nunca entró a FBA: sin fnSku.
          { sellerSku: "748-S26", asin: "B0GR6YSVKN" },
        ],
      },
    },
    (p) => (params = p),
  );

  return resumenesFba(cliente, ["456-A06", "657-A11-blk", "748-S26"]).then((mapa) => {
    expect(mapa?.get("456-A06")).toBe("X004ABCDEF");
    expect(mapa?.get("657-A11-blk")).toBe("X004GHIJKL");
    expect(mapa?.has("748-S26")).toBe(false);
    expect(params.sellerSkus).toBe("456-A06,657-A11-blk,748-S26");
    expect(params.granularityId).toBe("A1AM78C64UM0Y8");
  });
});

test("un SKU con coma partiría el filtro en dos: no se pregunta", async () => {
  let params: any = null;
  const cliente = clienteFalso({ payload: { inventorySummaries: [] } }, (p) => (params = p));
  await resumenesFba(cliente, ["BUENO-1", "MA,LO"]);
  expect(params.sellerSkus).toBe("BUENO-1");
});

test("sin plazo para la llamada devuelve null, no un mapa vacío", async () => {
  // El cliente contesta null cuando se acabó el tiempo de la función; eso NO
  // es lo mismo que "Amazon dice que no tiene FNSKU" y no debe marcarse como
  // preguntado, o el SKU se quedaría 30 días sin volver a intentarse.
  expect(await resumenesFba(clienteFalso(null), ["456-A06"])).toBeNull();
});

test("nunca se mandan más de los que Amazon acepta", async () => {
  let params: any = null;
  const cliente = clienteFalso({ payload: {} }, (p) => (params = p));
  await resumenesFba(cliente, Array.from({ length: 80 }, (_, i) => `SKU-${i}`));
  expect(params.sellerSkus.split(",")).toHaveLength(POR_LLAMADA);
});
