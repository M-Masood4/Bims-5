import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["bims5.app", "localhost", "127.0.0.1"],
  },
  preview: {
    allowedHosts: ["bims5.app", "localhost", "127.0.0.1"],
  },
});
