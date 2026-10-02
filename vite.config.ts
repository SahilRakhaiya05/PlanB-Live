import { defineConfig, loadEnv, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handler } from "./api/handler";

/** Dev only: serves the same Lambda handler at /api, including Pip when a key is set. */
function localApi(): Plugin {
  return {
    name: "planb-local-api",
    configureServer(server) {
      server.middlewares.use("/api", (req, res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (c) => { size += c.length; if (size <= 256000) chunks.push(c); });
        req.on("end", async () => {
          if (size > 256000) { res.statusCode = 413; res.end(JSON.stringify({ error: "The event upload is too large." })); return; }
          const out = await handler({
            requestContext: { http: { method: req.method, path: (req.url ?? "/").split("?")[0] } },
            body: Buffer.concat(chunks).toString("utf8"),
          });
          res.statusCode = out.statusCode;
          Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
          res.end(out.body);
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  return { plugins: [react(), localApi()], build: { target: "es2022", sourcemap: false } };
});
