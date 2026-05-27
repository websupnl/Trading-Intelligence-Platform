/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api-proxy/:path*',
        destination: `${process.env.INTERNAL_API_URL || 'http://api:8000'}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
