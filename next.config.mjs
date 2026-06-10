/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'figma-alpha-api.s3.us-west-2.amazonaws.com' },
      { protocol: 'https', hostname: '**.figma.com' },
    ],
  },
};

export default nextConfig;
