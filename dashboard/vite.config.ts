import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * One door for everything: the browser only talks to this server, which forwards
 *   /api  -> journal server  (127.0.0.1:8000)
 *   /live -> MT5 price bridge (127.0.0.1:8765, WebSocket)
 * The journal server and the bridge stay bound to this PC only; a private tunnel (Tailscale Serve)
 * can expose just this one port to your own devices.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ["localhost", ".ts.net"], // .ts.net = Tailscale MagicDNS names
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", rewrite: (p) => p.replace(/^\/api/, "") },
      "/live": { target: "http://127.0.0.1:8765", ws: true, rewrite: (p) => p.replace(/^\/live/, "") },
    },
  },
});
