/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // El motor de planeación puede tardar en catálogos grandes.
    serverActions: { bodySizeLimit: "4mb" },
    // Sin `staleTimes`: con 30 s el navegador reutilizaba la pantalla que ya
    // tenía y una pestaña abría con datos viejos (dueño, 9-oct-2026: «tengo
    // que actualizar para que salga bien»). Las pantallas leen renglones
    // masticados: pedirlas otra vez es barato.
  },
};

export default nextConfig;
