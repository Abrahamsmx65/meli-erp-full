import { configDefaults, defineConfig } from "vitest/config";

/**
 * Las pruebas del ERP. `boletos/` es un proyecto aparte con su propio
 * package.json, sus dependencias y su propio vitest: aquí no se toca, igual
 * que en tsconfig.json.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "boletos/**"],
  },
});
