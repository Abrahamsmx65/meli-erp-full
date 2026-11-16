// Cabeceras de seguridad en TODAS las respuestas (16-nov-2026):
// - HSTS: el navegador solo habla por HTTPS con el sitio, dos años.
// - nosniff: no adivina tipos de archivo (un Excel no se ejecuta como script).
// - frame-ancestors / X-Frame-Options: nadie puede meter el ERP dentro de
//   otra página para robar clics (clickjacking).
// - Referrer-Policy: los links con token (/preparar/{token}, /contenido/…)
//   no viajan completos a otros sitios.
// - Permissions-Policy: la app no usa cámara, micrófono ni ubicación.
// - noindex: ningún buscador lista el ERP ni sus links sin sesión.
const CABECERAS_SEGURIDAD = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No anunciar con qué está hecho el sitio.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: CABECERAS_SEGURIDAD }];
  },
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
