/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // El motor de planeación puede tardar en catálogos grandes.
    serverActions: { bodySizeLimit: "4mb" },
    // Volver a una página visitada hace <30 s no debe rehacer todo el viaje
    // al servidor: el navegador reutiliza lo que ya tiene. Los datos frescos
    // llegan igual — la barra de estado refresca cuando hay plan nuevo.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
