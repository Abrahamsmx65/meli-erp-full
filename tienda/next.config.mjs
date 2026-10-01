/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  poweredByHeader: false,
  // La portada lista public/banners en el servidor: en Vercel esa carpeta
  // no viaja con la función si no se pide.
  outputFileTracingIncludes: { "/": ["./public/banners/**/*"] },
};
export default nextConfig;
