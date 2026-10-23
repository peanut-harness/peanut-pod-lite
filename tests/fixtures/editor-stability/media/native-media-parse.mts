import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 只在 Node 中执行安装包自带的明文 DragonBones 数据解析库，不加载 Creator 或其 importer。
const media = fileURLToPath(new URL('./', import.meta.url));
const output = process.argv[2];
assert.ok(output?.startsWith('/private/tmp/'), 'portable report is written only to the temporary directory');
const payload = JSON.parse(await readFile(path.join(media, 'supplemental/skeletal/one-bone-dragonbones.json'), 'utf8'));
const report = { mode: 'offline data parser only; not Creator import or AssetDB evidence', versions: {} };
for (const version of ['3.8.3', '3.8.7']) {
    const reference = 'engine/node_modules/@cocos/dragonbones-js/out/dragonBones.js';
    const source = await readFile(`/Applications/Cocos/Creator/${version}/CocosCreator.app/Contents/Resources/resources/3d/${reference}`);
    const library = await import(`data:text/javascript;base64,${source.toString('base64')}`);
    const parser = library.ObjectDataParser.getInstance();
    const data = parser.parseDragonBonesData(payload);
    assert.ok(data);
    assert.equal(data.name, 'task42');
    const armature = data.getArmature('OneBone');
    assert.ok(armature);
    assert.equal(armature.getBone('root').name, 'root');
    assert.equal(armature.getSlot('tile').parent.name, 'root');
    assert.equal(armature.getAnimation('turn').duration, 1);
    assert.equal(armature.defaultSkin.getDisplays('tile')[0].name, 'checker');
    report.versions[version] = { parserReference: reference, parserSha256: createHash('sha256').update(source).digest('hex'),
        sourceSha256: createHash('sha256').update(await readFile(path.join(media, 'supplemental/skeletal/one-bone-dragonbones.json'))).digest('hex'),
        armature: 'OneBone', bone: 'root', slot: 'tile', attachment: 'checker', animation: 'turn', duration: 1,
        nativeImporterExecuted: false, creatorStarted: false };
    data.returnToPool();
}
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write('两版 DragonBones 明文数据 parser：有效单骨骼、slot、附件和 1 秒动画；Creator 未执行。\n');
