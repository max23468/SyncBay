import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  appType: "custom",
  plugins: [reactRouter()],
  resolve: {
    alias: {
      "@shopify/shopify-app-react-router/react": fileURLToPath(
        new URL("./syncbay-ui-app-provider-stub.tsx", import.meta.url),
      ),
    },
    dedupe: ["react", "react-dom", "react-router"],
  },
  server: {
    hmr: false,
    middlewareMode: true,
  },
});
