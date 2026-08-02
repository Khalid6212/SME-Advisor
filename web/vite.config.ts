import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Must match APP_ORIGIN in api/.env — CORS is exact-origin because
    // credentials are enabled, and a mismatch drops the session cookie with no
    // visible error. 5174 rather than Vite's default 5173, which is commonly
    // taken on IPv6 loopback by other tooling.
    port: 5174,
    strictPort: true,
  },
});
