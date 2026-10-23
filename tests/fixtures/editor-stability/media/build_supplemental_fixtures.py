"""补充原创标准媒体输入；不执行 Creator，不改原有媒体或覆盖草稿。"""
from pathlib import Path
import hashlib
import json
import plistlib
import shutil

MEDIA = Path(__file__).resolve().parent
REPO = MEDIA.parents[3]
SUPPLEMENT = MEDIA / "supplemental"
REVISION = "peanut-task42-native-media/1.0.0"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def generate_original_inputs():
    # fontTools 仅是生成工具，不把其代码或第三方字体载荷放入仓库。
    from fontTools import __version__ as fonttools_version
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    font_dir = SUPPLEMENT / "font"
    font_dir.mkdir(parents=True, exist_ok=True)
    builder = FontBuilder(1024, isTTF=True)
    builder.setupGlyphOrder([".notdef", "A"])
    builder.setupCharacterMap({65: "A"})
    glyphs = {}
    for name in [".notdef", "A"]:
        pen = TTGlyphPen(None)
        if name == "A":
            pen.moveTo((0, 0)); pen.lineTo((350, 700)); pen.lineTo((700, 0)); pen.closePath()
            pen.moveTo((280, 240)); pen.lineTo((420, 240)); pen.lineTo((350, 380)); pen.closePath()
        glyphs[name] = pen.glyph()
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({".notdef": (800, 0), "A": (800, 0)})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({"familyName": "Peanut Task42 Original", "styleName": "Regular", "uniqueFontIdentifier": REVISION,
                           "fullName": "Peanut Task42 Original Regular", "psName": "PeanutTask42Original-Regular",
                           "copyright": "Original programmatic test glyph; no third-party font data."})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    builder.setupMaxp()
    builder.font["head"].created = builder.font["head"].modified = 3406620153
    builder.font.recalcTimestamp = False
    builder.save(font_dir / "one-glyph.ttf")

    bones = SUPPLEMENT / "skeletal"
    bones.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(MEDIA / "assets/image/checker.png", bones / "checker.png")
    spine = {
        "skeleton": {"hash": "task42-original", "spine": "3.8.99", "x": -4, "y": -4, "width": 8, "height": 8},
        "bones": [{"name": "root"}],
        "slots": [{"name": "tile", "bone": "root", "attachment": "checker"}],
        "skins": [{"name": "default", "attachments": {"tile": {"checker": {"type": "region", "path": "checker", "width": 8, "height": 8}}}}],
        "animations": {"turn": {"bones": {"root": {"rotate": [{"time": 0, "angle": 0}, {"time": 1, "angle": 15}]}}}},
    }
    write_json(bones / "one-bone-spine.json", spine)
    (bones / "one-bone-spine.atlas").write_text("checker.png\nsize: 8,8\nformat: RGBA8888\nfilter: Nearest,Nearest\nrepeat: none\nchecker\n  rotate: false\n  xy: 0,0\n  size: 8,8\n  orig: 8,8\n  offset: 0,0\n  index: -1\n")
    dragon = {
        "version": "5.5", "compatibleVersion": "5.5", "name": "task42", "frameRate": 24,
        "armature": [{"name": "OneBone", "type": "Armature", "frameRate": 24,
                      "aabb": {"x": -4, "y": -4, "width": 8, "height": 8},
                      "bone": [{"name": "root"}], "slot": [{"name": "tile", "parent": "root", "displayIndex": 0}],
                      "skin": [{"name": "default", "slot": [{"name": "tile", "display": [{"name": "checker", "path": "checker", "type": "image"}]}]}],
                      "animation": [{"name": "turn", "duration": 24, "playTimes": 1,
                                     "bone": [{"name": "root", "rotateFrame": [{"duration": 12, "rotate": 0}, {"duration": 12, "rotate": 15}]}]}]}],
    }
    write_json(bones / "one-bone-dragonbones.json", dragon)
    write_json(bones / "one-bone-dragonbones-atlas.json", {"name": "task42", "imagePath": "checker.png", "width": 8, "height": 8,
                                                         "SubTexture": [{"name": "checker", "x": 0, "y": 0, "width": 8, "height": 8}]})

    atlas = SUPPLEMENT / "atlas"
    atlas.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(MEDIA / "assets/image/checker.png", atlas / "checker.png")
    sprite_atlas = {"frames": {"checker": {"frame": "{{0,0},{8,8}}", "offset": "{0,0}", "rotated": False,
                                           "sourceColorRect": "{{0,0},{8,8}}", "sourceSize": "{8,8}"}},
                    "metadata": {"format": 2, "textureFileName": "checker.png", "realTextureFileName": "checker.png", "size": "{8,8}"}}
    (atlas / "one-region.plist").write_bytes(plistlib.dumps(sprite_atlas, sort_keys=True))

    particle_dir = SUPPLEMENT / "particle"
    particle_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(MEDIA / "assets/image/checker.png", particle_dir / "checker.png")
    particle = {"emitterType": 0, "maxParticles": 8, "particleLifespan": 1.0, "particleLifespanVariance": 0.0,
                "duration": -1.0, "emissionRate": 4.0, "speed": 1.0, "speedVariance": 0.0, "angle": 90.0, "angleVariance": 0.0,
                "gravityx": 0.0, "gravityy": 0.0, "radialAcceleration": 0.0, "tangentialAcceleration": 0.0,
                "sourcePositionx": 0.0, "sourcePositiony": 0.0, "sourcePositionVariancex": 0.0, "sourcePositionVariancey": 0.0,
                "startParticleSize": 8.0, "finishParticleSize": 8.0, "rotationStart": 0.0, "rotationEnd": 0.0,
                "startColorRed": 1.0, "startColorGreen": 1.0, "startColorBlue": 1.0, "startColorAlpha": 1.0,
                "finishColorRed": 1.0, "finishColorGreen": 1.0, "finishColorBlue": 1.0, "finishColorAlpha": 0.0,
                "blendFuncSource": 770, "blendFuncDestination": 771, "textureFileName": "checker.png"}
    (particle_dir / "one-emitter.plist").write_bytes(plistlib.dumps(particle, sort_keys=True))

    hdr_dir = SUPPLEMENT / "hdr"
    hdr_dir.mkdir(parents=True, exist_ok=True)
    payload = bytearray(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 8 +X 16\n")
    for row in range(8):
        payload.extend(b"\x02\x02\x00\x10")
        for value in [64 + row * 4, 128, 192, 129]:
            payload.extend(bytes([128 + 16, value]))
    (hdr_dir / "equirect.hdr").write_bytes(payload)
    return fonttools_version


def build_catalog(fonttools_version):
    old = json.loads((MEDIA / "catalog.json").read_text())
    drift = json.loads((MEDIA / "current-source-drift.json").read_text())
    catalog = {"schemaVersion": 1, "revision": REVISION, "generator": {"path": Path(__file__).name, "sha256": sha(Path(__file__).read_bytes()), "fonttoolsVersion": fonttools_version},
               "origin": "新增像素引用、原创字形、单骨骼/图集、粒子参数和完整 RGBE 像素；原媒体输入保持 bytes。", "files": [], "versions": {},
               "formatSources": ["https://docs.cocos.com/creator/3.8/manual/en/asset/spine.html", "https://docs.cocos.com/creator/3.8/manual/en/asset/dragonbones.html",
                                 "https://en.esotericsoftware.com/spine-json-format"],
               "runtimeAcceptance": "not performed; no Creator process or native AssetDB identity is claimed"}
    deps = {
        "supplemental/skeletal/one-bone-spine.json": ["supplemental/skeletal/one-bone-spine.atlas"],
        "supplemental/skeletal/one-bone-spine.atlas": ["supplemental/skeletal/checker.png"],
        "supplemental/skeletal/one-bone-dragonbones.json": ["supplemental/skeletal/one-bone-dragonbones-atlas.json"],
        "supplemental/skeletal/one-bone-dragonbones-atlas.json": ["supplemental/skeletal/checker.png"],
        "supplemental/atlas/one-region.plist": ["supplemental/atlas/checker.png"],
        "supplemental/particle/one-emitter.plist": ["supplemental/particle/checker.png"],
    }
    kinds = {
        "image": {"input": "assets/image/checker.png"}, "model": {"input": "assets/model/triangle.gltf"},
        "audio": {"input": "assets/audio/tone.wav"}, "video": {"input": "assets/video/blue.mp4"}, "buffer": {"input": "assets/model/triangle.bin"},
        "bitmapFont": {"input": "assets/font/one-glyph.fnt"}, "tiledMap": {"input": "assets/map/two-by-two.tmx"},
        "ttfFont": {"input": "supplemental/font/one-glyph.ttf"}, "spine": {"input": "supplemental/skeletal/one-bone-spine.json"},
        "dragonBones": {"input": "supplemental/skeletal/one-bone-dragonbones.json"}, "dragonBonesAtlas": {"input": "supplemental/skeletal/one-bone-dragonbones-atlas.json"},
        "particle": {"input": "supplemental/particle/one-emitter.plist"}, "spriteAtlas": {"input": "supplemental/atlas/one-region.plist"},
        "cubeMap": {"input": "supplemental/hdr/equirect.hdr", "derivedSelector": "image importer type=texture cube; ERP texture-cube subasset; exact installed source meta is frozen; rebind UUID only after AssetDB import"},
        "directory": {"input": "assets/bundle", "stagingRecipe": {"assetdbOperation": "asset.createFolder", "inspectorPatch": {"isBundle": True, "bundleName": "Task42Bundle", "priority": 1}, "child": "assets/bundle/checker.png", "identity": "后续原生创建目录并取得真实 directory meta UUID；禁止将 fixture UUID 视为登记结果。"}},
    }
    for kind, selector in {"mesh": "meshes[0].primitives[0]", "skeleton": "skins[0]", "instantiationAnimation": "animations[0]", "instantiationMaterial": "materials[0]"}.items():
        kinds[kind] = {"input": "assets/model/triangle.gltf", "derivedSelector": selector,
                       "derivedIdentity": "真实 glTF 源数据，不创建伪 .mesh/.skeleton/.animation/.material；后续 importer 子资源 metadata 精确绑定此 selector，读回类型与数据必须匹配。"}
    for version in ["3.8.3", "3.8.7"]:
        engine = Path("/Applications/Cocos/Creator") / version / "CocosCreator.app/Contents/Resources/resources/3d/engine"
        entries = json.loads(json.dumps(kinds))
        vdir = SUPPLEMENT / version
        vdir.mkdir(parents=True, exist_ok=True)
        for kind, source_name, extension in [("autoAtlas", "auto-atlas/default.pac", ".pac"), ("labelAtlas", "label-atlas/default.labelatlas", ".labelatlas")]:
            source = engine / "editor/assets/default_file_content" / source_name
            out = vdir / ("default" + extension)
            shutil.copyfile(source, out)
            shutil.copyfile(Path(str(source) + ".meta"), Path(str(out) + ".meta"))
            entries[kind] = {"input": out.relative_to(MEDIA).as_posix(), "metaSource": out.relative_to(MEDIA).as_posix() + ".meta",
                             "sourceReference": "engine/editor/assets/default_file_content/" + source_name,
                             "stagingRecipe": {"source": "仅使用同版官方源模板，导入后消费真实 meta/子资源身份，不复用模板 UUID。"}}
        entries["autoAtlas"]["stagingRecipe"].update({"sourceImage": "assets/image/checker.png", "layout": "将 .pac 与 sourceImage 放到同一已登记目录，原生 pack 产生非空 Atlas", "inspectorPatch": {"pack": {"maxWidth": 64, "maxHeight": 64, "padding": 2}}})
        entries["labelAtlas"]["stagingRecipe"].update({"sourceImage": "assets/font/glyph.png", "spriteFrame": "取得该 glyph 图片原生子资源 SpriteFrame UUID 后绑定 spriteFrameUuid", "inspectorPatch": {"itemWidth": 8, "itemHeight": 8, "startChar": "A"}})
        sky = engine / "editor/assets/default_skybox/default_skybox.hdr.meta"
        shutil.copyfile(sky, vdir / "cube-source.hdr.meta")
        entries["cubeMap"]["metaSource"] = (vdir / "cube-source.hdr.meta").relative_to(MEDIA).as_posix()
        shutil.copyfile(engine / "LICENSE.md", vdir / "CREATOR-ENGINE-LICENSE.md")
        app_bytes = (engine.parents[3] / "Info.plist").read_bytes()
        assert plistlib.loads(app_bytes)["CFBundleShortVersionString"] == version
        assert json.loads((engine / "package.json").read_text())["version"] == version
        # 原生声明和 Inspector 源可以只读核对，不解密 .ccc 模块。
        source_files = {
            "spine": "cocos/spine/skeleton-data.ts", "dragonBones": "cocos/dragon-bones/DragonBonesAsset.ts",
            "dragonBonesAtlas": "cocos/dragon-bones/DragonBonesAtlasAsset.ts", "particle": "cocos/particle-2d/particle-system-2d.ts",
            "labelAtlas": "editor/inspector/assets/label-atlas.js", "autoAtlas": "editor/inspector/assets/texture/auto-atlas.js",
        }
        provenance = {"creatorVersion": version, "appInfoPlistSha256": sha(app_bytes), "enginePackageSha256": sha((engine / "package.json").read_bytes()),
                      "license": {"path": (vdir / "CREATOR-ENGINE-LICENSE.md").relative_to(MEDIA).as_posix(), "sha256": sha((engine / "LICENSE.md").read_bytes()), "spdx": "MIT"},
                      "declarations": [{"kind": k, "reference": "engine/" + source, "sha256": sha((engine / source).read_bytes())} for k, source in source_files.items()],
                      "assetInputSourcePolicy": "模板及 metadata bytes 为来源，不是 AssetDB 登记；原创输入源版本独立于 Creator 精确版本。"}
        write_json(vdir / "source-provenance.json", provenance)
        inventory = json.loads((REPO / f"tests/fixtures/editor-stability/coverage/creator-{version}-draft.json").read_text())["inventory"]
        catalog["versions"][version] = {"provenance": (vdir / "source-provenance.json").relative_to(MEDIA).as_posix(), "inputs": entries,
                                         "nativeImporterLayout": inventory["nativeImporterModules"], "baselineLayoutSource": next(s for s in inventory["sources"] if s["kind"] == "module_layout"),
                                         "layoutSource": drift["versions"][version]["currentLayoutSource"],
                                         "nativeRuntimePassedRows": 0}
    old_files = {entry["path"]: entry for entry in old["files"]}
    for p in sorted(SUPPLEMENT.rglob("*")):
        if not p.is_file() or p.name == "source-provenance.json":
            continue
        relative = p.relative_to(MEDIA).as_posix()
        catalog["files"].append({"path": relative, "sha256": sha(p.read_bytes()), "byteLength": p.stat().st_size,
                                 "sourceRevision": REVISION, "dependencies": deps.get(relative, [])})
    for path, entry in old_files.items():
        catalog["files"].append(entry)
    graph = {entry["path"]: entry["dependencies"] for entry in catalog["files"]}
    def closure(node):
        result = {node}
        for child in graph[node]:
            result |= closure(child)
        return result
    for v in catalog["versions"].values():
        for kind, entry in v["inputs"].items():
            if kind == "directory":
                members = ["assets/bundle/checker.png"]
            else:
                members = closure(entry["input"])
            members = set(members)
            if "metaSource" in entry: members.add(entry["metaSource"])
            if kind == "autoAtlas": members.add("assets/image/checker.png")
            if kind == "labelAtlas": members.add("assets/font/glyph.png")
            entry["dependencyClosure"] = sorted(members)
    write_json(MEDIA / "supplemental-catalog.json", catalog)
    original_audit = json.loads((MEDIA / "coverage-audit.json").read_text())
    audit = {"schemaVersion": 1, "purpose": "仅补充格式合法性和源引用闭包；原 coverage audit、分母与失败记录不变。", "versions": {}}
    for version, baseline in original_audit["versions"].items():
        rows = []
        for row in drift["versions"][version]["currentScopedCases"]:
            parts = row["targetId"].split(":")
            kind = parts[1] if parts[0] == "asset" else (parts[2] if parts[0] == "field" else None)
            if kind is None:
                item = {"caseId": row["caseId"], "targetId": row["targetId"], "action": row["action"], "status": "module_layout_audited_runtime_registration_pending", "sourceRef": version + "#nativeImporterLayout"}
            else:
                entry = catalog["versions"][version]["inputs"][kind]
                item = {"caseId": row["caseId"], "targetId": row["targetId"], "action": row["action"], "status": "legal_input_dependency_mapping_static_only", "inputRef": version + "#inputs/" + kind,
                        "input": entry["input"], "dependencyClosure": entry["dependencyClosure"], "derivedSelector": entry.get("derivedSelector"),
                        "readbackPolicy": "后续按版本原生导入，取得真实根及子资源 UUID、字段值和 raw 日志；此处只确认合法源与依赖，不生成 passed 结果。"}
            item["nativeResult"] = None
            rows.append(item)
        audit["versions"][version] = {"inventorySha256": drift["versions"][version]["currentInventorySha256"], "baselineInventorySha256": baseline["inventorySha256"],
                                         "baselineScopedCaseCount": len(baseline["rows"]), "scopedCaseCount": len(rows), "legalInputs": len(catalog["versions"][version]["inputs"]),
                                         "inputMappedRows": sum(r["status"] == "legal_input_dependency_mapping_static_only" for r in rows), "nativeRuntimePassedRows": 0, "rows": rows}
    write_json(MEDIA / "supplemental-coverage-audit.json", audit)
    print("补充输入与两版来源映射已生成；没有 Creator/AssetDB 通过声明。")


if __name__ == "__main__":
    build_catalog(generate_original_inputs())
