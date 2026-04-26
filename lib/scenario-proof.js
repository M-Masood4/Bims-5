"use strict";

const crypto = require("crypto");

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => stableStringify(entry)).join(",") + "]";
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
}

function hashScenarioProof(proof) {
  return crypto.createHash("sha256").update(stableStringify(proof)).digest("hex");
}

module.exports = {
  hashScenarioProof,
  stableStringify
};
