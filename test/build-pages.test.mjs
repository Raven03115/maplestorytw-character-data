import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  buildPages,
  CHARACTERS,
  containsForbiddenKey,
  PUBLIC_SECTIONS,
} from "../scripts/build-pages.mjs";

function analysisFor(character) {
  return {
    meta: {
      character_id: character.id,
      character_name: character.name,
      fetched_at: "2026-07-26T00:00:00.000Z",
      cache_status: "MISS",
      partial: false,
      warnings: [],
    },
    basic: {
      world: "測試世界",
      class: character.expectedClass,
      level: 290,
      guild: null,
    },
    combat_summary: {
      combat_power: "123456789",
      main_stat: { name: character.mainStat, value: "100000" },
      sub_stat: { name: character.subStat, value: "5000" },
    },
    errors: [],
  };
}

function sectionFor(slug) {
  const base = { date: "2026-07-26" };
  switch (slug) {
    case "stat":
      return { ...base, final_stat: [{ stat_name: "戰鬥力", stat_value: "123456789" }] };
    case "hyper-stat":
      return {
        ...base,
        use_preset_no: "2",
        use_available_hyper_stat: 1400,
        hyper_stat_preset_1: [],
        hyper_stat_preset_2: [],
        hyper_stat_preset_3: [],
      };
    case "ability":
      return {
        ...base,
        preset_no: 1,
        ability_info: [],
        ability_preset_1: { ability_preset_grade: "傳說", ability_info: [] },
        ability_preset_2: { ability_preset_grade: "傳說", ability_info: [] },
        ability_preset_3: { ability_preset_grade: "傳說", ability_info: [] },
      };
    case "item-equipment":
      return {
        ...base,
        preset_no: 3,
        item_equipment: [],
        item_equipment_preset_1: [],
        item_equipment_preset_2: [],
        item_equipment_preset_3: [],
      };
    case "set-effect":
      return { ...base, set_effect: [] };
    case "familiar":
      return { ...base, familiar_link_slot: [], familiar_info: [] };
    default:
      throw new Error(`未知測試分區：${slug}`);
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function withDirectories(run) {
  const root = await mkdtemp(join(tmpdir(), "maplestorytw-pages-test-"));
  try {
    await run({
      outputDirectory: pathToFileURL(`${join(root, "_site")}/`),
      snapshotDirectory: pathToFileURL(`${join(root, "snapshot")}/`),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("依序取得兩個固定角色與原始預設分區，根目錄維持 challenger 相容別名", async () => {
  await withDirectories(async ({ outputDirectory, snapshotDirectory }) => {
    const requested = [];
    const fetchFn = async (input) => {
      const url = new URL(input);
      requested.push(url.pathname);
      const character = CHARACTERS.find(({ id }) => url.pathname.includes(`/${id}/`));
      assert.ok(character);
      if (url.pathname.endsWith("/analysis")) return jsonResponse(analysisFor(character));
      const slug = url.pathname.split("/section/")[1];
      assert.ok(slug);
      return jsonResponse(sectionFor(slug));
    };

    await buildPages({
      fetchFn,
      outputDirectory,
      snapshotDirectory,
      now: () => new Date("2026-07-26T01:02:03.000Z"),
    });

    const expected = [];
    for (const character of CHARACTERS) {
      expected.push(`/characters/${character.id}/analysis`);
      for (const { slug } of PUBLIC_SECTIONS) {
        expected.push(`/characters/${character.id}/section/${slug}`);
      }
    }
    assert.deepEqual(requested, expected);

    const rootAnalysis = JSON.parse(await readFile(new URL("analysis.json", outputDirectory), "utf8"));
    const challengerAnalysis = JSON.parse(
      await readFile(new URL("characters/challenger/analysis.json", outputDirectory), "utf8"),
    );
    const adeleAnalysis = JSON.parse(
      await readFile(new URL("characters/adele/analysis.json", outputDirectory), "utf8"),
    );
    const rootHealth = JSON.parse(await readFile(new URL("health.json", outputDirectory), "utf8"));
    const challengerHealth = JSON.parse(
      await readFile(new URL("characters/challenger/health.json", outputDirectory), "utf8"),
    );
    const adeleSnapshot = JSON.parse(
      await readFile(new URL("characters/adele/analysis.json", snapshotDirectory), "utf8"),
    );
    const rootHyper = JSON.parse(
      await readFile(new URL("raw/hyper-stat.json", snapshotDirectory), "utf8"),
    );
    const challengerEquipment = JSON.parse(
      await readFile(
        new URL("characters/challenger/raw/item-equipment.json", snapshotDirectory),
        "utf8",
      ),
    );

    assert.deepEqual(rootAnalysis, challengerAnalysis);
    assert.deepEqual(rootHealth, challengerHealth);
    assert.equal(rootAnalysis.meta.character_name, "豹豹奶霜");
    assert.equal(adeleAnalysis.meta.character_name, "余盼");
    assert.equal(rootHealth.updated_at, "2026-07-26T01:02:03.000Z");
    assert.equal(adeleAnalysis.combat_summary.main_stat.name, "STR");
    assert.equal(adeleAnalysis.combat_summary.sub_stat.name, "DEX");
    assert.equal(rootHyper.use_preset_no, "2");
    assert.equal(challengerEquipment.preset_no, 3);
    assert.equal(containsForbiddenKey(rootAnalysis), false);
    assert.equal(containsForbiddenKey(adeleAnalysis), false);
    assert.equal(containsForbiddenKey(adeleSnapshot), false);
    assert.equal(containsForbiddenKey(rootHyper), false);
    assert.equal(containsForbiddenKey(challengerEquipment), false);
  });
});

test("任一角色驗證失敗時不覆寫既有輸出", async () => {
  await withDirectories(async ({ outputDirectory, snapshotDirectory }) => {
    await writeFile(new URL("sentinel.txt", outputDirectory), "keep", {
      encoding: "utf8",
      flag: "w",
    }).catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(new URL("sentinel.txt", outputDirectory), "keep", "utf8");
    });

    const fetchFn = async (input) => {
      const url = new URL(input);
      const character = CHARACTERS.find(({ id }) => url.pathname.includes(`/${id}/`));
      assert.ok(character);
      if (url.pathname.endsWith("/analysis")) {
        const analysis = analysisFor(character);
        if (character.id === "adele") analysis.basic.class = "錯誤職業";
        return jsonResponse(analysis);
      }
      const slug = url.pathname.split("/section/")[1];
      assert.ok(slug);
      return jsonResponse(sectionFor(slug));
    };

    await assert.rejects(
      buildPages({ fetchFn, outputDirectory, snapshotDirectory }),
      /角色職業不符/,
    );
    assert.equal(await readFile(new URL("sentinel.txt", outputDirectory), "utf8"), "keep");
  });
});

test("敏感欄位驗證會拒絕 OCID 與認證資料", () => {
  assert.equal(containsForbiddenKey({ safe: true }), false);
  assert.equal(containsForbiddenKey({ nested: { ocid: "forbidden" } }), true);
  assert.equal(containsForbiddenKey({ Authorization: "forbidden" }), true);
});

async function captureUpstreamFailure(body, contentType = "application/json; charset=utf-8") {
  let failure;
  await withDirectories(async ({ outputDirectory, snapshotDirectory }) => {
    await assert.rejects(
      buildPages({
        outputDirectory,
        snapshotDirectory,
        fetchFn: async () => new Response(body, {
          status: 502,
          headers: { "Content-Type": contentType },
        }),
      }),
      (error) => {
        failure = error;
        return true;
      },
    );
  });
  return failure.message;
}

test("上游 502 顯示安全的 Worker 與 NEXON 錯誤欄位，不洩漏原始回應", async () => {
  const message = await captureUpstreamFailure(JSON.stringify({
    ok: false,
    ocid: "secret-ocid-value",
    error: {
      code: "NEXON_CORE_ENDPOINT_FAILED",
      endpoint: "/maplestorytw/v1/character/basic",
      upstream_status: 429,
      nexon_code: "OPENAPI00007",
      message: "private-token-value",
    },
  }));
  assert.match(message, /challenger: 來源端點 HTTP 狀態不是 200，而是 502/);
  assert.match(message, /錯誤代碼=NEXON_CORE_ENDPOINT_FAILED/);
  assert.match(message, /失敗端點=\/maplestorytw\/v1\/character\/basic/);
  assert.match(message, /上游HTTP=429/);
  assert.match(message, /NEXON代碼=OPENAPI00007/);
  assert.doesNotMatch(message, /secret-ocid-value|private-token-value/);
});

test("上游錯誤資訊含任意字串或 URL 查詢參數時不寫入日誌", async () => {
  const message = await captureUpstreamFailure(JSON.stringify({
    error: {
      code: "AUTH=secret-token",
      endpoint: "/maplestorytw/v1/id?Authorization=secret-token",
      upstream_status: "429 secret-token",
      nexon_code: "secret-token",
      message: "secret-token",
    },
  }));
  assert.match(message, /HTTP 狀態不是 200，而是 502/);
  assert.doesNotMatch(message, /secret-token|Authorization/);

  const arbitraryTokens = await captureUpstreamFailure(JSON.stringify({
    error: {
      code: "SECRETKEYABC123",
      endpoint: "/maplestorytw/v1/character/secretvalue",
      upstream_status: 503,
      nexon_code: "SECRETKEYABC123",
    },
  }));
  assert.doesNotMatch(arbitraryTokens, /SECRETKEYABC123|secretvalue/);
  assert.match(arbitraryTokens, /上游HTTP=503/);
});

test("HTML 與過大的 JSON 錯誤回應只保留 HTTP 狀態，不回印內容", async () => {
  const html = await captureUpstreamFailure("<p>secret-html-value</p>", "text/html");
  assert.match(html, /HTTP 狀態不是 200，而是 502/);
  assert.doesNotMatch(html, /secret-html-value/);

  const oversized = await captureUpstreamFailure(JSON.stringify({
    error: { code: "OVERSIZE_SECRET", message: "x".repeat(9000) },
  }));
  assert.match(oversized, /HTTP 狀態不是 200，而是 502/);
  assert.doesNotMatch(oversized, /OVERSIZE_SECRET/);
});
