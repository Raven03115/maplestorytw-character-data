import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const SOURCE_URL = "https://maplestorytw-character-api.boy185608.workers.dev/analysis";
const EXPECTED_CHARACTER = "豹豹奶霜";
const OUTPUT_DIRECTORY = new URL("../_site/", import.meta.url);
const SNAPSHOT_DIRECTORY = new URL("../snapshot/", import.meta.url);
const SNAPSHOT_HEARTBEAT_MS = 6 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set([
  "authorization",
  "cookie",
  "nexon_api_key",
  "ocid",
  "x-nxopen-api-key",
]);

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => FORBIDDEN_KEYS.has(key.toLowerCase()) || containsForbiddenKey(child),
  );
}

function comparableAnalysis(value) {
  const comparable = structuredClone(value);
  if (isObject(comparable.meta)) {
    delete comparable.meta.fetched_at;
    delete comparable.meta.generated_at;
    delete comparable.meta.published_at;
  }
  return comparable;
}

async function readJsonFile(url) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return null;
  }
}

async function shouldRefreshSnapshot(analysis, updatedAt) {
  const existingAnalysis = await readJsonFile(new URL("analysis.json", SNAPSHOT_DIRECTORY));
  const existingHealth = await readJsonFile(new URL("health.json", SNAPSHOT_DIRECTORY));

  if (!isObject(existingAnalysis) || !isObject(existingHealth)) return true;

  const dataChanged =
    JSON.stringify(comparableAnalysis(existingAnalysis)) !==
    JSON.stringify(comparableAnalysis(analysis));
  if (dataChanged) return true;

  const previousUpdatedAt = Date.parse(existingHealth.updated_at);
  const currentUpdatedAt = Date.parse(updatedAt);
  return (
    !Number.isFinite(previousUpdatedAt) ||
    !Number.isFinite(currentUpdatedAt) ||
    currentUpdatedAt - previousUpdatedAt >= SNAPSHOT_HEARTBEAT_MS
  );
}

await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });

const response = await fetch(SOURCE_URL, {
  headers: { Accept: "application/json" },
  redirect: "error",
  signal: AbortSignal.timeout(20_000),
});

if (response.status !== 200) {
  throw new Error(`來源端點 HTTP 狀態不是 200，而是 ${response.status}。`);
}

const contentType = response.headers.get("content-type") ?? "";
if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
  throw new Error(`來源端點 Content-Type 不是 application/json：${contentType || "(missing)"}`);
}

const declaredLength = Number(response.headers.get("content-length"));
if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
  throw new Error("來源 JSON 超過允許大小。");
}

const body = await response.text();
if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
  throw new Error("來源 JSON 超過允許大小。");
}

let analysis;
try {
  analysis = JSON.parse(body);
} catch {
  throw new Error("來源內容不是可解析的 JSON。");
}

if (!isObject(analysis) || !isObject(analysis.meta)) {
  throw new Error("來源 JSON 缺少 meta 物件。");
}
if (analysis.meta.character_name !== EXPECTED_CHARACTER) {
  throw new Error("來源 JSON 的角色名稱不符。");
}
if (!isObject(analysis.combat_summary)) {
  throw new Error("來源 JSON 缺少 combat_summary 物件。");
}
if (
  typeof analysis.combat_summary.combat_power !== "string" &&
  typeof analysis.combat_summary.combat_power !== "number"
) {
  throw new Error("來源 JSON 的 combat_summary 沒有實際戰鬥力。");
}
if (containsForbiddenKey(analysis)) {
  throw new Error("來源 JSON 含有禁止公開的敏感欄位。");
}

const updatedAt = new Date().toISOString();
const health = {
  ok: true,
  character_name: EXPECTED_CHARACTER,
  updated_at: updatedAt,
  source: "NEXON Open API via Cloudflare Worker",
};

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await Promise.all([
  writeFile(new URL("analysis.json", OUTPUT_DIRECTORY), `${JSON.stringify(analysis, null, 2)}\n`, "utf8"),
  writeFile(new URL("health.json", OUTPUT_DIRECTORY), `${JSON.stringify(health, null, 2)}\n`, "utf8"),
  writeFile(new URL(".nojekyll", OUTPUT_DIRECTORY), "", "utf8"),
]);

const snapshotRefreshed = await shouldRefreshSnapshot(analysis, updatedAt);
if (snapshotRefreshed) {
  await mkdir(SNAPSHOT_DIRECTORY, { recursive: true });
  await Promise.all([
    writeFile(
      new URL("analysis.json", SNAPSHOT_DIRECTORY),
      `${JSON.stringify(analysis, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      new URL("health.json", SNAPSHOT_DIRECTORY),
      `${JSON.stringify(health, null, 2)}\n`,
      "utf8",
    ),
  ]);
}

console.log(
  `Validated ${EXPECTED_CHARACTER}: combat_summary present; wrote Pages files (${Buffer.byteLength(body, "utf8")} source bytes); repository snapshot ${snapshotRefreshed ? "refreshed" : "unchanged"}.`,
);
