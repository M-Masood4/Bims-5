const fs = require("fs");
const http = require("http");
const path = require("path");

const rootDir = __dirname;
const webDir = path.join(rootDir, "web");
const manifestPath = path.join(rootDir, "api", "replay-manifest.json");
const port = Number(process.env.PORT || 5173);

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
