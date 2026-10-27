import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Source files own the UI; previously emitted siblings must not shadow them.
  resolve: { extensions: [".mjs", ".ts", ".tsx", ".js", ".jsx", ".json"] },
  server: {
    port: 5173,
    strictPort: true
  }
});
