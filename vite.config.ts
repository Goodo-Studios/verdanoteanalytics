import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      // Three entries: the app (driven by index.html), the iOS quick-add
      // document, and the PWA service worker.
      //
      // The worker must land at the server root as /sw.js so its scope covers
      // the whole app — hence the un-hashed, un-nested filename below.
      // Key the app entry "index" so its chunk keeps the default
      // assets/index-[hash].js name rather than being renamed by this change.
      //
      // capture/quick-add.html boots the SAME app bundle but deliberately does
      // NOT link /manifest.json: on iOS, Add to Home Screen saves a web app
      // built from the manifest's start_url ("/") whenever a manifest is
      // present, so /capture/quick-add could never be bookmarked as itself.
      // Its nested path under the project root is what makes Vite emit
      // dist/capture/quick-add.html, which vercel.json rewrites the route to.
      input: {
        index: path.resolve(__dirname, "index.html"),
        "capture/quick-add": path.resolve(__dirname, "capture/quick-add.html"),
        sw: path.resolve(__dirname, "src/sw.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-radix": [
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-label",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-separator",
            "@radix-ui/react-slot",
            "@radix-ui/react-switch",
            "@radix-ui/react-tabs",
            "@radix-ui/react-tooltip",
          ],
        },
      },
    },
  },
}));
