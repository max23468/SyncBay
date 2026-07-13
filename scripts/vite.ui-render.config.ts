import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  appType: "custom",
  plugins: [reactRouter()],
  server: {
    hmr: false,
    middlewareMode: true,
  },
});
