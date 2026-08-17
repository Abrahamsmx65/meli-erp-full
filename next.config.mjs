/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // El motor de planeación puede tardar en catálogos grandes.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
