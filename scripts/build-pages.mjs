import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CHARACTERS = [
  {
    id: "challenger",
    name: "豹豹奶霜",
    expectedClass: "狂豹獵人",
    mainStat: "DEX",
    subStat: "STR",
  },
  {
    id: "adele",
    name: "余盼",
    expectedClass: "阿戴爾",
    mainStat: "STR",
    subStat: "DEX",
  },
];

const WORKER_BASE_URL = "https://maplestorytw-character-api.boy185608.workers.dev";
const DEFAULT_OUTPUT_DIRECTORY = new URL("../_site/", import.meta.url);
const DEFAULT_SNAPSHOT_DIRECTORY = new URL("../snapshot/", import.meta.url);
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

export function containsForbiddenKey(value) {
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
    delete comparable.meta.cache_status;
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

function validateAnalysis(analysis, character) {
  if (!isObject(analysis) || !isObject(analysis.meta)) {
    throw new Error(`${character.id}: 來源 JSON 缺少 meta 物件。`);
  }
  if (analysis.meta.character_name !== character.name) {
    throw new Error(`${character.id}: 來源 JSON 的角色名稱不符。`);
  }
  if (analysis.meta.character_id !== character.id) {
    throw new Error(`${character.id}: 來源 JSON 的固定角色 ID 不符。`);
  }
  if (!isObject(analysis.basic) || analysis.basic.class !== character.expectedClass) {
    throw new Error(`${character.id}: 來源 JSON 的角色職業不符。`);
  }
  if (!isObject(analysis.combat_summary)) {
    throw new Error(`${character.id}: 來源 JSON 缺少 combat_summary 物件。`);
  }
  if (
    typeof analysis.combat_summary.combat_power !== "string" &&
    typeof analysis.combat_summary.combat_power !== "number"
  ) {
    throw new Error(`${character.id}: combat_summary 沒有實際戰鬥力。`);
  }
  if (
    !isObject(analysis.combat_summary.main_stat) ||
    analysis.combat_summary.main_stat.name !== character.mainStat
  ) {
    throw new Error(`${character.id}: 主屬性名稱不符。`);
  }
  if (
    !isObject(analysis.combat_summary.sub_stat) ||
    analysis.combat_summary.sub_stat.name !== character.subStat
  ) {
    throw new Error(`${character.id}: 副屬性名稱不符。`);
  }
  if (containsForbiddenKey(analysis)) {
    throw new Error(`${character.id}: 來源 JSON 含有禁止公開的敏感欄位。`);
  }
}

async function fetchAnalysis(character, fetchFn) {
  const sourceUrl = `${WORKER_BASE_URL}/characters/${character.id}/analysis`;
  const response = await fetchFn(sourceUrl, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });

  if (response.status !== 200) {
    throw new Error(`${character.id}: 來源端點 HTTP 狀態不是 200，而是 ${response.status}。`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new Error(
      `${character.id}: 來源端點 Content-Type 不是 application/json：${contentType || "(missing)"}`,
    );
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`${character.id}: 來源 JSON 超過允許大小。`);
  }

  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error(`${character.id}: 來源 JSON 超過允許大小。`);
  }

  let analysis;
  try {
    analysis = JSON.parse(body);
  } catch {
    throw new Error(`${character.id}: 來源內容不是可解析的 JSON。`);
  }
  validateAnalysis(analysis, character);
  return { analysis, sourceBytes: Buffer.byteLength(body, "utf8") };
}

function healthFor(character, updatedAt) {
  return {
    ok: true,
    character_id: character.id,
    character_name: character.name,
    character_class: character.expectedClass,
    updated_at: updatedAt,
    source: "NEXON Open API via Cloudflare Worker",
  };
}

async function shouldRefreshSnapshots(results, updatedAt, snapshotDirectory) {
  for (const { character, analysis } of results) {
    const roleDirectory = new URL(`characters/${character.id}/`, snapshotDirectory);
    const existingAnalysis = await readJsonFile(new URL("analysis.json", roleDirectory));
    const existingHealth = await readJsonFile(new URL("health.json", roleDirectory));
    if (!isObject(existingAnalysis) || !isObject(existingHealth)) return true;
    if (
      JSON.stringify(comparableAnalysis(existingAnalysis)) !==
      JSON.stringify(comparableAnalysis(analysis))
    ) {
      return true;
    }
  }

  const existingRootHealth = await readJsonFile(new URL("health.json", snapshotDirectory));
  const previousUpdatedAt = Date.parse(existingRootHealth?.updated_at);
  const currentUpdatedAt = Date.parse(updatedAt);
  return (
    !Number.isFinite(previousUpdatedAt) ||
    !Number.isFinite(currentUpdatedAt) ||
    currentUpdatedAt - previousUpdatedAt >= SNAPSHOT_HEARTBEAT_MS
  );
}

async function writeRole(directory, character, analysis, health) {
  const roleDirectory = new URL(`characters/${character.id}/`, directory);
  await mkdir(roleDirectory, { recursive: true });
  await Promise.all([
    writeFile(new URL("analysis.json", roleDirectory), `${JSON.stringify(analysis, null, 2)}\n`, "utf8"),
    writeFile(new URL("health.json", roleDirectory), `${JSON.stringify(health, null, 2)}\n`, "utf8"),
  ]);
}

export async function buildPages({
  fetchFn = fetch,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  snapshotDirectory = DEFAULT_SNAPSHOT_DIRECTORY,
  now = () => new Date(),
} = {}) {
  const results = [];
  for (const character of CHARACTERS) {
    const fetched = await fetchAnalysis(character, fetchFn);
    results.push({ character, ...fetched });
  }

  // No files are touched until every fixed role has passed validation.
  const updatedAt = now().toISOString();
  const completeResults = results.map((result) => ({
    ...result,
    health: healthFor(result.character, updatedAt),
  }));
  const challenger = completeResults.find((result) => result.character.id === "challenger");
  if (challenger === undefined) throw new Error("缺少 challenger 固定角色設定。");

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      new URL("analysis.json", outputDirectory),
      `${JSON.stringify(challenger.analysis, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      new URL("health.json", outputDirectory),
      `${JSON.stringify(challenger.health, null, 2)}\n`,
      "utf8",
    ),
    writeFile(new URL(".nojekyll", outputDirectory), "", "utf8"),
    ...completeResults.map(({ character, analysis, health }) =>
      writeRole(outputDirectory, character, analysis, health),
    ),
  ]);

  const snapshotRefreshed = await shouldRefreshSnapshots(
    completeResults,
    updatedAt,
    snapshotDirectory,
  );
  if (snapshotRefreshed) {
    await mkdir(snapshotDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        new URL("analysis.json", snapshotDirectory),
        `${JSON.stringify(challenger.analysis, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        new URL("health.json", snapshotDirectory),
        `${JSON.stringify(challenger.health, null, 2)}\n`,
        "utf8",
      ),
      ...completeResults.map(({ character, analysis, health }) =>
        writeRole(snapshotDirectory, character, analysis, health),
      ),
    ]);
  }

  const totalSourceBytes = completeResults.reduce((total, result) => total + result.sourceBytes, 0);
  console.log(
    `Validated ${completeResults.length} fixed roles; wrote Pages files (${totalSourceBytes} source bytes); repository snapshot ${snapshotRefreshed ? "refreshed" : "unchanged"}.`,
  );
  return { results: completeResults, snapshotRefreshed };
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) {
  await buildPages();
}
