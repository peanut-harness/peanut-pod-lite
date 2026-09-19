import assert from "assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { EditorResourceGuard } from "../src/cocos/foundation/editor-resource/editor-resource-guard.js";
import { ProjectLogPostflightMonitor } from "../src/cocos/foundation/editor-resource/project-log-postflight-monitor.js";
import { ProjectLogPostflightRepairer } from "../src/cocos/foundation/editor-resource/project-log-postflight-repairer.js";
import { EditorResourceRestorer } from "../src/cocos/foundation/editor-resource/editor-resource-restorer.js";
import { PrefabEditorRootResolver } from "../src/cocos/foundation/editor-resource/prefab-editor-root-resolver.js";
import { CurrentEditorResourceQuery } from "../src/cocos/foundation/editor-resource/current-editor-resource-query.js";

test("EditorResourceGuard rejects project.log and temp paths for open-scene", (): void => {
  const guard = new EditorResourceGuard();
  assert.equal(
    guard.canOpenAsScene("db://assets/temp/logs/project.log"),
    false,
  );
  assert.equal(
    guard.resolve("uuid-1", "db://assets/temp/logs/project.log"),
    undefined,
  );
  assert.equal(
    guard.planRestore(
      guard.resolve(
        "uuid-1",
        "/Users/alex/Downloads/company-tests/temp/logs/project.log",
      ),
    ).kind,
    "skip",
  );
});

test("EditorResourceGuard allows real scenes and plans open-scene", (): void => {
  const guard = new EditorResourceGuard();
  const resource = guard.resolve("scene-uuid", "db://assets/Main.scene");
  assert.deepEqual(resource, {
    kind: "scene",
    uuid: "scene-uuid",
    dbPath: "db://assets/Main.scene",
  });
  assert.deepEqual(guard.planRestore(resource), {
    kind: "open-scene",
    dbPath: "db://assets/Main.scene",
  });
  assert.equal(guard.canOpenAsScene("assets/levels/Boss.scene"), true);
});

test("EditorResourceGuard restores prefabs via open-asset and blocks scripts/json", (): void => {
  const guard = new EditorResourceGuard();
  const prefab = guard.resolve("prefab-uuid", "db://assets/ui/Button.prefab");
  assert.deepEqual(guard.planRestore(prefab), {
    kind: "open-asset",
    uuid: "prefab-uuid",
  });
  assert.equal(
    guard.resolve("script-uuid", "db://assets/scripts/Foo.ts"),
    undefined,
  );
  assert.equal(
    guard.resolve("json-uuid", "db://assets/config/data.json"),
    undefined,
  );
});

test("ProjectLogPostflightMonitor reports only delta errors", (): void => {
  const root = mkdtempSync(join(tmpdir(), "peanut-project-log-"));
  const logDir = join(root, "temp", "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "project.log");
  writeFileSync(logPath, "old error that should be ignored\n", "utf8");
  const monitor = new ProjectLogPostflightMonitor();
  const checkpoint = monitor.checkpoint(root);
  writeFileSync(
    logPath,
    "old error that should be ignored\nError: Cannot find character.atlas\nWarning: slow editor operation\n",
    "utf8",
  );
  const result = monitor.readDelta(checkpoint);
  assert.equal(result.logChecked, true);
  assert.equal(result.verified, false);
  assert.equal(result.newErrorCount, 1);
  assert.equal(result.newWarningCount, 1);
  assert.match(result.newErrors[0] ?? "", /character\.atlas/u);
});

test("ProjectLogPostflightMonitor ignores Error stacks on Creator warn lines", (): void => {
  const root = mkdtempSync(join(tmpdir(), "peanut-project-log-warn-"));
  const logDir = join(root, "temp", "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "project.log");
  writeFileSync(logPath, "", "utf8");
  const monitor = new ProjectLogPostflightMonitor();
  const checkpoint = monitor.checkpoint(root);
  writeFileSync(
    logPath,
    [
      "8-26-2026 11:16:11 - warn: [plugin:peanut.editor-mcp] lumen_catalog_miss Error: lumen_catalog_miss",
      "8-26-2026 11:16:12 - error: [Assets] real failure",
      "",
    ].join("\n"),
    "utf8",
  );
  const result = monitor.readDelta(checkpoint);
  assert.equal(result.newWarningCount, 1);
  assert.equal(result.newErrorCount, 1);
  assert.equal(result.verified, false);
  assert.match(result.newErrors[0] ?? "", /real failure/u);
});

test("ProjectLogPostflightMonitor ignores disposed preview frames but keeps real Creator errors", (): void => {
  const root = mkdtempSync(join(tmpdir(), "peanut-project-log-disposed-frame-"));
  const logDir = join(root, "temp", "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "project.log");
  writeFileSync(logPath, "", "utf8");
  const monitor = new ProjectLogPostflightMonitor();
  const checkpoint = monitor.checkpoint(root);
  writeFileSync(
    logPath,
    [
      "2026-9-19 21:52:20 - error: Error sending from webFrameMain: Error: Render frame was disposed before WebFrameMain could be accessed",
      "2026-9-19 21:52:21 - error: [Assets] real import failure",
      "",
    ].join("\n"),
    "utf8",
  );
  const result = monitor.readDelta(checkpoint);
  assert.equal(result.newErrorCount, 1);
  assert.match(result.newErrors[0] ?? "", /real import failure/u);
});

test("ProjectLogPostflightMonitor treats bare Warn prefixes as warnings", (): void => {
  const root = mkdtempSync(join(tmpdir(), "peanut-project-log-bare-warn-"));
  const logDir = join(root, "temp", "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "project.log");
  writeFileSync(logPath, "", "utf8");
  const monitor = new ProjectLogPostflightMonitor();
  const checkpoint = monitor.checkpoint(root);
  writeFileSync(
    logPath,
    "Warn: [Assets] TS2732: Cannot find module './DebugInfos.json'.\n",
    "utf8",
  );
  const result = monitor.readDelta(checkpoint);
  assert.equal(result.newWarningCount, 1);
  assert.equal(result.newErrorCount, 0);
  assert.equal(result.verified, true);
});

test("ProjectLogPostflightMonitor ignores console.error stack frames without Creator severity", (): void => {
  const root = mkdtempSync(join(tmpdir(), "peanut-project-log-sentry-"));
  const logDir = join(root, "temp", "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "project.log");
  writeFileSync(logPath, "", "utf8");
  const monitor = new ProjectLogPostflightMonitor();
  const checkpoint = monitor.checkpoint(root);
  writeFileSync(
    logPath,
    [
      "    at console.error (/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/Resources/app.asar/node_modules/@sentry/core/build/cjs/utils-hoist/instrument/console.js:38:14)",
      "    at Object.<anonymous> (/tmp/fixture.js:1:1)",
      "Error: Cannot find character.atlas",
      "",
    ].join("\n"),
    "utf8",
  );
  const result = monitor.readDelta(checkpoint);
  assert.equal(result.newErrorCount, 1);
  assert.equal(result.verified, false);
  assert.match(result.newErrors[0] ?? "", /character\.atlas/u);
});

test("EditorResourceRestorer skips illegal targets and never calls open-scene", async (): Promise<void> => {
  const calls: Array<{ target: string; message: string; args: unknown[] }> = [];
  const restorer = new EditorResourceRestorer({
    request: async (target, message, ...args) => {
      calls.push({ target, message, args });
      return { ok: true };
    },
  });
  const skipped = await restorer.restore(
    restorer.resolveCurrent(
      "uuid-1",
      "/tmp/company-tests/temp/logs/project.log",
    ),
  );
  assert.equal(skipped.action.kind, "skip");
  assert.equal(calls.length, 0);

  const sceneUuid = "11111111-1111-4111-8111-111111111111";
  const scene = await restorer.restore(
    restorer.resolveCurrent(sceneUuid, "db://assets/Main.scene"),
  );
  assert.deepEqual(scene.action, {
    kind: "open-scene",
    dbPath: "db://assets/Main.scene",
  });
  assert.deepEqual(calls[0], {
    target: "scene",
    message: "open-scene",
    args: [sceneUuid],
  });
});

test("PrefabEditorRootResolver finds prefab root under hidden facade", (): void => {
  const resolver = new PrefabEditorRootResolver();
  assert.equal(
    resolver.rootNameFromPrefabPath("assets/ui/Button.prefab"),
    "Button",
  );
  const uuid = resolver.findUuidByName(
    [
      {
        uuid: "facade",
        name: "__hidden__",
        children: [{ uuid: "root-uuid", name: "Button", children: [] }],
      },
    ],
    "Button",
  );
  assert.equal(uuid, "root-uuid");
});

test("CurrentEditorResourceQuery never plans open-scene for project.log", async (): Promise<void> => {
  const query = new CurrentEditorResourceQuery({
    request: async () => ({
      uuid: "log-uuid",
      url: "db://assets/temp/logs/project.log",
    }),
  });
  const snapshot = await query.query();
  assert.equal(snapshot.resource, null);
  assert.equal(snapshot.restorePlan.kind, "skip");
  assert.equal(snapshot.canOpenAsScene, false);
});

test("ProjectLogPostflightRepairer refreshes once then re-verifies", async (): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "peanut-project-log-repair-"));
  const logDir = join(root, "temp", "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "project.log");
  writeFileSync(logPath, "Error: stale\n", "utf8");
  const monitor = new ProjectLogPostflightMonitor();
  const checkpoint = monitor.checkpoint(root);
  writeFileSync(logPath, "Error: stale\nError: missing atlas\n", "utf8");
  const failed = monitor.readDelta(checkpoint);
  assert.equal(failed.verified, false);
  const calls: string[] = [];
  const repairer = new ProjectLogPostflightRepairer({
    request: async (_target, message) => {
      calls.push(message);
      writeFileSync(
        logPath,
        "Error: stale\nError: missing atlas\nrepaired ok\n",
        "utf8",
      );
      return true;
    },
  });
  const repaired = await repairer.repairOnceIfNeeded(root, failed);
  assert.equal(calls[0], "refresh-asset");
  assert.equal(repaired.repairAttempts?.[0]?.ok, true);
  assert.equal(repaired.verified, true);
});
