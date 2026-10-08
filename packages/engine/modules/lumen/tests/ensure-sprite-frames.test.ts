import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EnsureSpriteFramesBatchService,
  SpriteFrameMetaBuilder,
} from "../source/asset-import/ensure-sprite-frames";
import type { IAssetImportMessagePort } from "../source/asset-import/asset-import-batch-executor";

/**
 * @description 构造最小合法 PNG（1x1）。
 * @returns PNG 字节。
 * @oopException 测试辅助。
 */
function minimalPng(): Uint8Array {
  // IHDR 宽高各为 1 的最小 PNG（含 IHDR 魔数与尺寸字段即可通过 readPngDimensions）
  const bytes = new Uint8Array(24);
  bytes[0] = 137;
  bytes[1] = 80;
  bytes[2] = 78;
  bytes[3] = 71;
  bytes[16] = 0;
  bytes[17] = 0;
  bytes[18] = 0;
  bytes[19] = 1;
  bytes[20] = 0;
  bytes[21] = 0;
  bytes[22] = 0;
  bytes[23] = 1;
  return bytes;
}

test("SpriteFrameMetaBuilder builds f9941 subMeta from image meta", () => {
  const meta = {
    importer: "image",
    uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    userData: { type: "texture" },
    subMetas: {},
  };
  const next = SpriteFrameMetaBuilder.buildNextMeta(
    meta,
    "db://assets/ui/bg.png",
    minimalPng(),
  );
  assert.equal(next.importer, "image");
  assert.ok(SpriteFrameMetaBuilder.isRecord(next.subMetas));
  const sf = next.subMetas["f9941"];
  assert.ok(SpriteFrameMetaBuilder.isRecord(sf));
  assert.equal(sf.importer, "sprite-frame");
  assert.equal(
    sf.uuid,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@f9941",
  );
  assert.equal(
    SpriteFrameMetaBuilder.readSpriteFrameUuid(next),
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@f9941",
  );
  assert.ok(SpriteFrameMetaBuilder.isRecord(next.userData));
  assert.equal(next.userData.type, "sprite-frame");
});

test("EnsureSpriteFramesBatchService reports already / ensured / failed", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lumen-ensure-sf-")));
  try {
    mkdirSync(join(root, "assets", "ui"), { recursive: true });
    const pngPath = join(root, "assets", "ui", "bg.png");
    writeFileSync(pngPath, minimalPng());
    writeFileSync(
      join(root, "assets", "ui", "already.png"),
      minimalPng(),
    );

    const imageUuid = "11111111-2222-4333-8444-555555555555";
    /** @type {Map<string, Record<string, unknown>>} */
    const metas = new Map<string, Record<string, unknown>>([
      [
        "db://assets/ui/bg.png",
        {
          importer: "image",
          uuid: imageUuid,
          userData: { type: "texture" },
          subMetas: {},
        },
      ],
      [
        "db://assets/ui/already.png",
        {
          importer: "image",
          uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          userData: { type: "sprite-frame" },
          subMetas: {
            f9941: {
              importer: "sprite-frame",
              uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@f9941",
            },
          },
        },
      ],
    ]);
    for (const [url, meta] of metas) {
      writeFileSync(join(root, url.replace("db://", "")) + ".meta", JSON.stringify(meta));
    }
    /** @type {Map<string, unknown>} */
    const infos = new Map();
    let saveCount = 0;

    const message: IAssetImportMessagePort = {
      async request(target, messageName, ...args) {
        assert.equal(target, "asset-db");
        const dbUrl = String(args[0] ?? "");
        if (messageName === "query-asset-meta" || messageName === "query-meta") {
          return metas.get(dbUrl) ?? null;
        }
        if (messageName === "query-asset-info") {
          if (dbUrl.endsWith("@f9941")) {
            return { uuid: dbUrl, type: "cc.SpriteFrame", imported: true, invalid: false };
          }
          const meta = metas.get(dbUrl);
          return meta == null ? null : { ...meta, url: dbUrl, type: "cc.ImageAsset", imported: true, invalid: false };

        }
        if (messageName === "save-asset-meta") {
          saveCount += 1;
          const parsed = JSON.parse(String(args[1])) as Record<string, unknown>;
          metas.set(dbUrl, parsed);
          writeFileSync(join(root, dbUrl.replace("db://", "")) + ".meta", JSON.stringify(parsed));
          infos.set(dbUrl, parsed);
          return true;
        }
        if (messageName === "query-ready") { return true; }
        if (messageName === "reimport-asset") {
          const meta = metas.get(dbUrl);
          assert.ok(meta);
          writeFileSync(join(root, dbUrl.replace("db://", "")) + ".meta", JSON.stringify(meta));
          return undefined;
        }
        if (messageName === "refresh-asset") {
          return true;
        }
        throw new Error(`unexpected:${messageName}`);
      },
    };

    const service = new EnsureSpriteFramesBatchService(message);
    const result = await service.ensureBatch({
      projectRoot: root,
      dbPaths: [
        "db://assets/ui/bg.png",
        "assets/ui/already.png",
        "db://assets/ui/missing.png",
        "db://assets/ui/notes.txt",
      ],
    });

    assert.equal(result.already, 1);
    assert.equal(result.ensured, 1);
    assert.equal(result.errors, 1);
    assert.equal(result.skipped, 1);
    assert.equal(saveCount, 1);
    const ensured = result.items.find((item) => item.status === "ensured");
    assert.ok(ensured);
    assert.equal(ensured.spriteFrameUuid, `${imageUuid}@f9941`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
