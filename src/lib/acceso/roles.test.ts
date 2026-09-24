import { describe, expect, it } from "vitest";
import { destinoPorOmision, entradaVisible, rolDeSesion, rutaPermitida } from "./roles";

describe("rol de sesión", () => {
  it("sin rol en el JWT es el dueño; 'tiktok' solo si lo dice app_metadata", () => {
    expect(rolDeSesion(null)).toBe("dueño");
    expect(rolDeSesion({ app_metadata: {} })).toBe("dueño");
    expect(rolDeSesion({ app_metadata: { rol: "tiktok" } })).toBe("tiktok");
    // user_metadata la puede editar el propio usuario: no cuenta.
    expect(rolDeSesion({ app_metadata: { rol: "admin" } })).toBe("dueño");
  });
});

describe("rutas del rol tiktok", () => {
  it("alcanza TikTok, la estación de preparar, los videos, login y salir", () => {
    for (const r of ["/tiktok", "/tiktok/despacho", "/tiktok/despacho/53/preparar", "/api/tiktok/cortes", "/preparar/abc", "/api/preparar-publico/x/cortes/1/preparar", "/videos", "/api/videos/estudio", "/login", "/api/salir"]) {
      expect(rutaPermitida("tiktok", r)).toBe(true);
    }
  });
  it("no alcanza nada más del sistema", () => {
    for (const r of ["/", "/ventas", "/ventas/cortes", "/inventario", "/api/ventas/cortes", "/amazon", "/yapanizcel", "/cortes", "/tiktoks", "/api/plan/excel"]) {
      expect(rutaPermitida("tiktok", r)).toBe(false);
    }
  });
  it("el dueño alcanza todo", () => {
    expect(rutaPermitida("dueño", "/ventas/cortes")).toBe(true);
  });
  it("cae en el despacho de TikTok; el dueño, en el inicio", () => {
    expect(destinoPorOmision("tiktok")).toBe("/tiktok/despacho");
    expect(destinoPorOmision("dueño")).toBe("/");
  });
  it("en el menú solo ve las entradas que puede abrir: TikTok y Videos", () => {
    expect(entradaVisible("tiktok", "/tiktok/despacho")).toBe(true);
    expect(entradaVisible("tiktok", "/videos")).toBe(true);
    expect(entradaVisible("tiktok", "/ventas")).toBe(false);
    expect(entradaVisible("dueño", "/ventas")).toBe(true);
  });
});
