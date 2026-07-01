/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', 'pdfjs-dist'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
