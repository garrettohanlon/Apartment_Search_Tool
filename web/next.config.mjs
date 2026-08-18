/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export keeps the nightly pipeline intact: run.sh can drop the built
  // site next to the day's inventory JSON and it works with no Node process.
  output: 'export',
  images: { unoptimized: true },
  // Listing photos come from arbitrary third-party hosts, most of which block
  // hotlinking. Unoptimized <img> plus a graceful fallback is the honest option.
  trailingSlash: true,
};
export default nextConfig;
