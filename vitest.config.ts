import { defineConfig } from "vitest/config";

/**
 * Solo las pruebas del ERP. `boletos/` es un proyecto independiente con su
 * propio package.json y su propio vitest: desde la raíz no tiene instaladas
 * sus dependencias (nodemailer, qrcode) y sus pruebas tronaban el build.
 */
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "boletos/**", ".next/**"],
  },
});
