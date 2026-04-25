const fs = require("fs");
const http = require("http");
const path = require("path");

const rootDir = __dirname;
const webDir = path.join(rootDir, "web");
const manifestPath = path.join(rootDir, "api", "replay-manifest.json");
const port = Number(process.env.PORT || 5173);
loadLocalEnv(path.join(rootDir, ".env.local"));

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tif": "image/tiff"
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key]) continue;
    let value = match[2] || "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function readRequestBody(req, limitBytes = 64_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function geminiKey() {
  return process.env.GEMINI_API_KEY || process.env.gemini_api || process.env.GEMINI_API || process.env.GOOGLE_API_KEY || "";
}

function fallbackCommitExplanation(payload) {
  const commit = payload.commit || {};
  const signal = commit.type || payload.signal || "signal";
  const area = commit.area || "Belfast";
  const year = payload.year || commit.year || "the selected year";
  const delta = typeof commit.delta === "number" ? `${commit.delta >= 0 ? "+" : ""}${Math.round(commit.delta * 100)}%` : "changed";
  return `In ${year}, ${signal} around ${area} is the selected city diff (${delta} vs 2016). The map highlight comes from replay grid cells and the evidence trail lists the local datasets behind the change.`;
}

function extractGeminiText(payload) {
  return (payload.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("\n")
    .trim();
}

async function handleGeminiCommitExplanation(req, res) {
  let payload = {};
  try {
    const raw = await readRequestBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON body", detail: error.message });
    return;
  }

  const fallback = fallbackCommitExplanation(payload);
  const apiKey = geminiKey();
  if (!apiKey) {
    sendJson(res, 200, { ok: false, fallback: true, explanation: fallback });
    return;
  }

  const commit = payload.commit || {};
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const prompt = [
    "You are writing one concise planning readout for Replay Belfast.",
    "Use only the provided commit JSON. Do not invent exact facts.",
    "Explain what changed, why the map highlight matters, and what a planner should inspect next.",
    "Keep it to 55 words or fewer.",
    JSON.stringify({
      year: payload.year,
      signal: payload.signal,
      title: commit.title,
      area: commit.area,
      delta: commit.delta,
      confidence: commit.confidence,
      evidence: commit.evidence,
      affectedSignals: commit.affectedSignals,
    })
  ].join("\n");

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 140 }
      })
    });
    if (!response.ok) {
      sendJson(res, 200, { ok: false, fallback: true, explanation: fallback, detail: `Gemini ${response.status}` });
      return;
    }
    const geminiPayload = await response.json();
    const generated = extractGeminiText(geminiPayload);
    const explanation = generated.length >= 80 ? generated : fallback;
    sendJson(res, 200, { ok: true, fallback: explanation === fallback, model, explanation });
  } catch (error) {
    sendJson(res, 200, { ok: false, fallback: true, explanation: fallback, detail: error.message });
  }
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function safeResolve(baseDir, requestPath) {
  const cleanPath = decodeURIComponent(requestPath.split("?")[0]);
  const resolved = path.resolve(baseDir, cleanPath.replace(/^\/+/, ""));
  if (!resolved.startsWith(path.resolve(baseDir))) {
    return null;
  }
  return resolved;
}

function streamFile(res, filePath) {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "content-length": stat.size,
      "cache-control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function findLayer(manifest, year, layerId) {
  return manifest.layers.find((layer) => String(layer.year) === String(year) && layer.id === layerId);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname || "/";

  if (req.method === "POST" && pathname === "/api/gemini/commit-explanation") {
    handleGeminiCommitExplanation(req, res);
    return;
  }

  if (pathname === "/api/manifest" || pathname === "/api/replay-manifest.json") {
    try {
      sendJson(res, 200, loadManifest());
    } catch (error) {
      sendJson(res, 500, { error: "Could not load manifest", detail: error.message });
    }
    return;
  }

  if (pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      branch: "2016to2026",
      manifest: fs.existsSync(manifestPath)
    });
    return;
  }

  const layerMatch = pathname.match(/^\/api\/layers\/(\d{4})\/([a-z0-9_-]+)$/i);
  if (layerMatch) {
    try {
      const [, year, layerId] = layerMatch;
      const manifest = loadManifest();
      const layer = findLayer(manifest, year, layerId);
      if (!layer || !layer.path) {
        sendJson(res, 404, { error: "Layer not found", year, layerId });
        return;
      }
      const layerPath = safeResolve(rootDir, layer.path);
      if (!layerPath) {
        sendJson(res, 400, { error: "Invalid layer path" });
        return;
      }
      streamFile(res, layerPath);
    } catch (error) {
      sendJson(res, 500, { error: "Could not load layer", detail: error.message });
    }
    return;
  }

  if (pathname.startsWith("/data/mode-a/")) {
    const modeAPath = safeResolve(webDir, pathname);
    if (!modeAPath) {
      sendJson(res, 400, { error: "Invalid Mode A data path" });
      return;
    }
    streamFile(res, modeAPath);
    return;
  }

  if (pathname.startsWith("/data/")) {
    const dataPath = safeResolve(rootDir, pathname);
    if (!dataPath) {
      sendJson(res, 400, { error: "Invalid data path" });
      return;
    }
    streamFile(res, dataPath);
    return;
  }

  let filePath;
  if (pathname === "/") {
    filePath = path.join(webDir, "index.html");
  } else {
    filePath = safeResolve(webDir, pathname);
  }

  if (!filePath) {
    sendJson(res, 400, { error: "Invalid path" });
    return;
  }
  streamFile(res, filePath);
});

server.listen(port, () => {
  console.log(`Belfast replay UI/API running at http://localhost:${port}`);
});
