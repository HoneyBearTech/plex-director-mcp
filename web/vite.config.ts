import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Express backend serves this build's static output in production.
// In dev (`npm run dev`), proxy /api to the backend running on WEB_PORT
// (default 3000) so there's no CORS setup to maintain.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
