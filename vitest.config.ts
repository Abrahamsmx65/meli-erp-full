import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Solo las pruebas del ERP. `boletos/` es un proyecto independiente con su
 * propio package.json y su propio vitest: desde la raíz no tiene instaladas
 * sus dependencias (nodemailer, qrcode) y sus pruebas tronaban el build.
 */
export default defineConfig({
  // El mismo atajo que tsconfig: «@/…» es src/.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    exclude: ["**/node_modules/**", "boletos/**", "tienda/**", ".next/**", ".claude/**"],
    // La máquina de build de Vercel es más lenta que una laptop: el PDF y el
    // Excel del corte de MELI (pdf-lib + ExcelJS) pasaron de los 5 s por
    // omisión el 24-sep-2026 y tiraron un despliegue sin que nada estuviera
    // roto. 30 s es holgura, no permiso para pruebas lentas.
    testTimeout: 30_000,
  },
});
