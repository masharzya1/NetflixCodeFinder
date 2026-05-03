import express from "express";
import { registerRoutes } from "../server/routes.js";

const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false }));

let initialized = false;
let initPromise = null;

async function ensureInitialized() {
  if (initialized) return;
  if (!initPromise) {
    initPromise = registerRoutes(null, app).then(() => {
      initialized = true;
    });
  }
  await initPromise;
}

export default async function handler(req, res) {
  try {
    await ensureInitialized();
    return app(req, res);
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "API initialization failed",
    });
  }
}
