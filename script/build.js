import * as esbuild from "esbuild";
import { execSync } from "child_process";

const buildClient = async () => {
  execSync("npx vite build", { stdio: "inherit" });
};

const buildServer = async () => {
  await esbuild.build({
    entryPoints: ["server/index.js"],
    outfile: "dist/index.cjs",
    platform: "node",
    format: "cjs",
    bundle: true,
    external: ["@neondatabase/serverless", "ws"],
    loader: {
      ".node": "copy",
    },
  });
};

await buildClient();
await buildServer();
