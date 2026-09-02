/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Este proyecto vive dentro de otro repositorio: que Next no confunda la
  // raíz con el package-lock del ERP de arriba.
  outputFileTracingRoot: import.meta.dirname,
  experimental: {
    // El comprobante de transferencia sube como imagen o PDF.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
