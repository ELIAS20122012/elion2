// Static export: `npm run build` writes web/out, which the Elias OS daemon serves on http://127.0.0.1:7420
// (same origin as /api, so no CORS and the same Host/X-Elias/Cloudflare Access checks apply).
// During `npm run dev` the API calls are proxied to the running daemon.
const isDev = process.env.NODE_ENV === "development";
export default {
  output: isDev ? undefined : "export",
  images: { unoptimized: true },
  ...(isDev ? { rewrites: async () => [{ source: "/api/:path*", destination: "http://127.0.0.1:7420/api/:path*" }] } : {}),
};
