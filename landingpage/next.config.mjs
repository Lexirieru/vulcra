/** @type {import('next').NextConfig} */
// Next 16 defaults to Turbopack, which resolves the `@/*` alias from jsconfig.json
// natively — so no custom webpack alias is needed. A `webpack` config here would
// conflict with Turbopack and break `next dev` / `next build`.
const nextConfig = {};

export default nextConfig;
