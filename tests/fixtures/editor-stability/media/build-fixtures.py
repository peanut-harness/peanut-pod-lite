"""生成 task 4.2 的原始媒体输入与逐行 gap 审计；只写本目录。"""
from pathlib import Path
import hashlib
import json
import math
import struct
import subprocess
import wave
import zlib

MEDIA = Path(__file__).resolve().parent
REPO = MEDIA.parents[3]
REVISION = "peanut-task42-media/1.0.0"
VERSIONS = ("3.8.3", "3.8.7")
ROOTS = {
    "audio", "autoAtlas", "bitmapFont", "buffer", "cubeMap", "directory",
    "dragonBones", "dragonBonesAtlas", "image", "instantiationAnimation",
    "instantiationMaterial", "labelAtlas", "mesh", "model", "particle", "skeleton",
    "spine", "spriteAtlas", "tiledMap", "ttfFont", "video",
}


def dump(relative, value):
    destination = MEDIA / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def png(relative, pixels, width=8, height=8):
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
    raw = b"".join(b"\0" + bytes(pixels[y * width * 4:(y + 1) * width * 4]) for y in range(height))
    content = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    content += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    destination = MEDIA / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)


def make_inputs():
    pixels = [v for y in range(8) for x in range(8) for v in ((240, 80, 20, 255) if (x // 2 + y // 2) % 2 else (20, 80, 240, 255))]
    png("assets/image/checker.png", pixels)
    glyph = ["00111000", "01000100", "01000100", "01111100", "01000100", "01000100", "01000100", "00000000"]
    png("assets/font/glyph.png", [v for row in glyph for bit in row for v in (255, 255, 255, 255 if bit == "1" else 0)])
    font = MEDIA / "assets/font/one-glyph.fnt"
    font.write_text('info face="PeanutFixtureA" size=8 bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=0,0\n'
                    'common lineHeight=8 base=7 scaleW=8 scaleH=8 pages=1 packed=0\n'
                    'page id=0 file="glyph.png"\nchars count=1\n'
                    'char id=65 x=1 y=0 width=5 height=7 xoffset=0 yoffset=0 xadvance=6 page=0 chnl=15\n')
    audio = MEDIA / "assets/audio/tone.wav"
    audio.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(audio), "wb") as stream:
        stream.setparams((1, 2, 8000, 8000, "NONE", "not compressed"))
        stream.writeframes(b"".join(struct.pack("<h", round(8192 * math.sin(2 * math.pi * 440 * n / 8000))) for n in range(8000)))

    binary = bytearray()
    views, accessors = [], []
    def accessor(values, fmt, components, kind, component_type, target=None, bounds=None):
        binary.extend(b"\0" * (-len(binary) % 4))
        payload = struct.pack("<" + fmt * len(values), *values)
        view = {"buffer": 0, "byteOffset": len(binary), "byteLength": len(payload)}
        if target is not None:
            view["target"] = target
        views.append(view)
        binary.extend(payload)
        entry = {"bufferView": len(views) - 1, "componentType": component_type, "count": len(values) // components, "type": kind}
        if bounds:
            entry.update({"min": bounds[0], "max": bounds[1]})
        accessors.append(entry)
        return len(accessors) - 1
    position = accessor([0, 0, 0, 1, 0, 0, 0, 1, 0], "f", 3, "VEC3", 5126, 34962, ([0, 0, 0], [1, 1, 0]))
    normal = accessor([0, 0, 1] * 3, "f", 3, "VEC3", 5126, 34962)
    uv = accessor([0, 0, 1, 0, 0, 1], "f", 2, "VEC2", 5126, 34962)
    joints = accessor([0, 0, 0, 0] * 3, "H", 4, "VEC4", 5123, 34962)
    weights = accessor([1, 0, 0, 0] * 3, "f", 4, "VEC4", 5126, 34962)
    indices = accessor([0, 1, 2], "H", 1, "SCALAR", 5123, 34963)
    inverse = accessor([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], "f", 16, "MAT4", 5126)
    times = accessor([0, 1], "f", 1, "SCALAR", 5126, bounds=([0], [1]))
    translations = accessor([0, 0, 0, 0, 0.1, 0], "f", 3, "VEC3", 5126)
    model_dir = MEDIA / "assets/model"
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "triangle.bin").write_bytes(binary)
    dump("assets/model/triangle.gltf", {
        "asset": {"version": "2.0", "generator": REVISION}, "scene": 0,
        "scenes": [{"nodes": [0, 1]}],
        "nodes": [{"name": "Triangle", "mesh": 0, "skin": 0}, {"name": "Joint"}],
        "buffers": [{"uri": "triangle.bin", "byteLength": len(binary)}],
        "bufferViews": views, "accessors": accessors,
        "images": [{"uri": "../image/checker.png"}], "textures": [{"source": 0}],
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 1}, "doubleSided": True}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": position, "NORMAL": normal, "TEXCOORD_0": uv, "JOINTS_0": joints, "WEIGHTS_0": weights}, "indices": indices, "material": 0, "mode": 4}]}],
        "skins": [{"joints": [1], "skeleton": 1, "inverseBindMatrices": inverse}],
        "animations": [{"name": "JointLift", "samplers": [{"input": times, "output": translations, "interpolation": "LINEAR"}], "channels": [{"sampler": 0, "target": {"node": 1, "path": "translation"}}]}],
    })
    maps = MEDIA / "assets/map"
    maps.mkdir(parents=True, exist_ok=True)
    (maps / "one-tile.tsx").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" name="PeanutTile" tilewidth="8" tileheight="8" tilecount="1" columns="1"><image source="../image/checker.png" width="8" height="8"/></tileset>\n')
    (maps / "two-by-two.tmx").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.10" orientation="orthogonal" renderorder="right-down" width="2" height="2" tilewidth="8" tileheight="8" infinite="0" nextlayerid="2" nextobjectid="1"><tileset firstgid="1" source="one-tile.tsx"/><layer id="1" name="Ground" width="2" height="2"><data encoding="csv">1,1,1,1</data></layer></map>\n')
    bundle = MEDIA / "assets/bundle"
    bundle.mkdir(parents=True, exist_ok=True)
    (bundle / "checker.png").write_bytes((MEDIA / "assets/image/checker.png").read_bytes())
    dump("bundle-intent.json", {"folder": "assets/bundle", "inspectorPatch": {"isBundle": True, "bundleName": "peanut-media-fixture", "priority": 1}, "nativeMetadata": None, "gap": "两版 Creator directory/Bundle .meta、UUID 与原生登记尚无本次证据；这里只声明设置意图。"})
    video = MEDIA / "assets/video/blue.mp4"
    video.parent.mkdir(parents=True, exist_ok=True)
    command = ["ffmpeg", "-nostdin", "-y", "-f", "lavfi", "-i", "color=c=blue:s=16x16:r=4:d=1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-map_metadata", "-1", "-movflags", "+faststart", str(video)]
    result = subprocess.run(command, capture_output=True)
    Path("/private/tmp/pod-lite-task42-encode.log").write_bytes(result.stdout + result.stderr)
    result.check_returncode()
    return subprocess.check_output(["ffmpeg", "-version"], text=True).splitlines()[0]


def record_audit(encoder):
    sources = {
        "png": {"version": "PNG third edition, common RGBA8 subset", "url": "https://www.w3.org/TR/2025/REC-png-3-20250624/"},
        "wav": {"version": "RIFF WAVE, PCM format 1", "url": "https://learn.microsoft.com/en-us/windows/win32/xaudio2/resource-interchange-file-format--riff-"},
        "gltf": {"version": "glTF 2.0", "url": "https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html"},
        "bmfont": {"version": "BMFont text format", "url": "https://www.angelcode.com/products/bmfont/doc/file_format.html"},
        "tiled": {"version": "TMX/TSX 1.10", "url": "https://doc.mapeditor.org/en/stable/reference/tmx-map-format/"},
        "mp4": {"version": "MP4 / H.264, yuv420p", "encoder": encoder},
    }
    edges = {
        "assets/model/triangle.gltf": ["assets/model/triangle.bin", "assets/image/checker.png"],
        "assets/font/one-glyph.fnt": ["assets/font/glyph.png"],
        "assets/map/two-by-two.tmx": ["assets/map/one-tile.tsx"],
        "assets/map/one-tile.tsx": ["assets/image/checker.png"],
    }
    candidates = {
        "image": "assets/image/checker.png", "audio": "assets/audio/tone.wav",
        "model": "assets/model/triangle.gltf", "bitmapFont": "assets/font/one-glyph.fnt",
        "tiledMap": "assets/map/two-by-two.tmx", "video": "assets/video/blue.mp4",
        "buffer": "assets/model/triangle.bin", "directory": "assets/bundle",
    }
    sources["gltf-buffer"] = {"version": "glTF 2.0 binary buffer; accessor layouts in triangle.gltf", "url": sources["gltf"]["url"]}
    format_ids = {".png": "png", ".wav": "wav", ".gltf": "gltf", ".bin": "gltf-buffer", ".fnt": "bmfont", ".tmx": "tiled", ".tsx": "tiled", ".mp4": "mp4"}
    files = [{"path": p.relative_to(MEDIA).as_posix(), "sourceRevision": REVISION, "formatId": format_ids[p.suffix], "byteLength": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "dependencies": edges.get(p.relative_to(MEDIA).as_posix(), [])} for p in sorted((MEDIA / "assets").rglob("*")) if p.is_file()]
    def closure(relative):
        if (MEDIA / relative).is_dir():
            return {p.relative_to(MEDIA).as_posix() for p in (MEDIA / relative).rglob("*") if p.is_file()}
        result = {relative}
        for child in edges.get(relative, []):
            result.update(closure(child))
        return result
    closures = {kind: sorted(closure(relative)) for kind, relative in candidates.items()}
    dump("catalog.json", {"schemaVersion": 1, "revision": REVISION, "origin": "本 task 原始程序化创作：像素、字形 A、正弦音、三角形及单关节动画、地图与纯色视频；未复制第三方媒体内容。", "generator": {"path": "build-fixtures.py", "sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, "formats": sources, "files": files, "assetCandidates": candidates, "candidateDependencyClosures": closures, "creatorEvidence": {v: None for v in VERSIONS}, "limitations": "格式结构与文件依赖闭包可检查；Creator 同版 importer 注册、原生 UUID/子资源、Importer 字段值与原日志仍未验证。"})
    drafts = {v: json.loads((REPO / f"tests/fixtures/editor-stability/coverage/creator-{v}-draft.json").read_text()) for v in VERSIONS}
    modules = {v: set(d["inventory"]["nativeImporterModules"]) for v, d in drafts.items()}
    dump("importer-diff.json", {"schemaVersion": 1, "basis": "coverage draft 中的版本化模块布局；不是运行时注册目录", "common": sorted(modules["3.8.3"] & modules["3.8.7"]), "only3.8.3": sorted(modules["3.8.3"] - modules["3.8.7"]), "only3.8.7": sorted(modules["3.8.7"] - modules["3.8.3"]), "runtimeRegistration": {v: None for v in VERSIONS}})
    audit = {"schemaVersion": 1, "assetRoots": sorted(ROOTS), "importerScope": "保留两版全部 importer 模块对照行，包括辅助/迁移模块；这些布局项不能推断独立 importer 支持数。", "versions": {}}
    for version, draft in drafts.items():
        targets = []
        for target in draft["inventory"]["targets"]:
            parts = target["id"].split(":")
            if target["domain"] == "importer" or (target["domain"] == "asset" and parts[1] in ROOTS) or (target["domain"] == "field" and len(parts) > 2 and parts[1] == "asset" and parts[2] in ROOTS):
                targets.append(target["id"])
        selected = set(targets)
        rows = []
        for case in draft["manifest"]["cases"]:
            if case["targetId"] not in selected:
                continue
            parts = case["targetId"].split(":")
            root = parts[1] if parts[0] == "asset" else (parts[2] if parts[0] == "field" else None)
            fixture = candidates.get(root)
            gaps = ["creator_version_bound_native_evidence_missing", "native_registration_and_raw_log_evidence_missing"]
            if fixture is None and parts[0] != "importer":
                gaps.append("missing_type_specific_fixture_and_dependency_closure")
            if root in {"mesh", "skeleton", "instantiationAnimation", "instantiationMaterial"}:
                gaps.append("gltf_contains_source_data_but_native_derived_asset_mapping_missing")
            if root == "directory":
                gaps.append("bundle_native_metadata_and_uuid_missing")
            if parts[0] == "field":
                gaps.append("native_inspector_value_and_reference_mapping_missing")
            rows.append({"caseId": case["id"], "targetId": case["targetId"], "action": case["action"], "candidate": fixture, "status": "gap", "gapCodes": gaps, "nativeResult": None})
        audit["versions"][version] = {"inventorySha256": draft["manifest"]["inventorySha256"], "fullDraftCaseCount": len(draft["manifest"]["cases"]), "scopedTargetCount": len(targets), "scopedCaseCount": len(rows), "candidateRowCount": sum(r["candidate"] is not None for r in rows), "completeMappings": 0, "gapCount": len(rows), "rows": rows}
    dump("coverage-audit.json", audit)
    print(json.dumps({v: {k: val for k, val in e.items() if k != "rows"} for v, e in audit["versions"].items()}, ensure_ascii=False))


if __name__ == "__main__":
    record_audit(make_inputs())
