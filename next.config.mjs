/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // El motor de planeación puede tardar en catálogos grandes.
    serverActions: { bodySizeLimit: "4mb" },
    // `dynamic` se queda en 0: con 30 s el navegador reutilizaba la pantalla
    // que ya tenía y una pestaña abría con datos viejos (dueño, 9-oct-2026:
    // «tengo que actualizar para que salga bien»). `static` (lo que dura una
    // precarga COMPLETA) baja de 5 min a 30 s: los atajos de fechas de las
    // pantallas de ventas se precargan y se renuevan cada 30 s
    // (`components/atajos-fechas.tsx`); un clic nunca enseña algo de más de
    // medio minuto (11-oct-2026).
    staleTimes: { dynamic: 0, static: 30 },
  },
};

export default nextConfig;
