/** @type {import('next').NextConfig} */
const nextConfig = {
  // No `output: 'export'`. Vercel runs this as a normal Next app so the dataset
  // can be served from an API route and refreshed without a redeploy.
  images: { unoptimized: true },
  // Listing photos come from arbitrary third-party hosts, most of which block
  // hotlinking, so optimisation buys nothing and a plain <img> with a graceful
  // fallback is the honest option.
};
export default nextConfig;
