"""补充格式和闭包的独立检查；没有 Creator 或 AssetDB 成功声明。"""
from pathlib import Path
import hashlib
import json
import plistlib
import struct
import unittest
from test_media_fixtures import png_pixels, gltf_accessors, parse_dependencies

MEDIA = Path(__file__).resolve().parent
REPO = MEDIA.parents[3]


def load(name):
    return json.loads((MEDIA / name).read_text())


def resolve(owner, uri):
    if ":" in uri or "\\" in uri or "%" in uri or Path(uri).is_absolute():
        raise ValueError("unsafe supplemental URI")
    result = (owner.parent / uri).resolve()
    if not result.is_relative_to(MEDIA) or not result.is_file():
        raise ValueError("missing or escaped supplemental dependency")
    return result


def dependencies(owner):
    suffix = owner.suffix
    if "supplemental" not in owner.parts:
        return parse_dependencies(owner)
    if suffix == ".atlas":
        return [resolve(owner, owner.read_text().splitlines()[0])]
    if suffix == ".plist":
        data = plistlib.loads(owner.read_bytes())
        name = data.get("textureFileName", data.get("metadata", {}).get("textureFileName"))
        return [resolve(owner, name)]
    if owner.name == "one-bone-dragonbones-atlas.json":
        return [resolve(owner, json.loads(owner.read_text())["imagePath"])]
    if owner.name == "one-bone-dragonbones.json":
        return [resolve(owner, "one-bone-dragonbones-atlas.json")]
    if owner.name == "one-bone-spine.json":
        return [resolve(owner, "one-bone-spine.atlas")]
    return []


def sfnt_tables(payload):
    if payload[:4] != b"\x00\x01\x00\x00":
        raise ValueError("not TrueType sfnt")
    count = struct.unpack_from(">H", payload, 4)[0]
    tables = {}
    for i in range(count):
        name, expected, offset, length = struct.unpack_from(">4sIII", payload, 12 + 16 * i)
        if offset % 4 or offset + length > len(payload) or name in tables:
            raise ValueError("invalid sfnt bounds or duplicate table")
        table = bytearray(payload[offset:offset + length])
        if name == b"head":
            table[8:12] = b"\0" * 4
        table += b"\0" * ((-len(table)) % 4)
        checksum = sum(struct.unpack(">" + "I" * (len(table) // 4), table)) & 0xffffffff
        if checksum != expected:
            raise ValueError("sfnt table checksum")
        tables[name] = payload[offset:offset + length]
    padded = payload + b"\0" * ((-len(payload)) % 4)
    if sum(struct.unpack(">" + "I" * (len(padded) // 4), padded)) & 0xffffffff != 0xB1B0AFBA:
        raise ValueError("sfnt whole-font checksum")
    return tables


def decode_hdr(payload):
    header, payload = payload.split(b"-Y 8 +X 16\n", 1)
    if not header.startswith(b"#?RADIANCE\n") or b"FORMAT=32-bit_rle_rgbe" not in header:
        raise ValueError("HDR header")
    pixels = []
    offset = 0
    for _ in range(8):
        if payload[offset:offset + 4] != b"\x02\x02\x00\x10":
            raise ValueError("HDR scanline marker")
        offset += 4
        channels = []
        for _ in range(4):
            values = []
            while len(values) < 16:
                count = payload[offset]; offset += 1
                if count > 128:
                    values.extend([payload[offset]] * (count - 128)); offset += 1
                else:
                    if count == 0: raise ValueError("HDR zero run")
                    values.extend(payload[offset:offset + count]); offset += count
                if len(values) > 16: raise ValueError("HDR run overrun")
            channels.append(values)
        pixels.extend(zip(*channels))
    if offset != len(payload): raise ValueError("HDR trailing bytes")
    return pixels


class SupplementalFixtureTests(unittest.TestCase):
    def test_all_hashes_sources_and_actual_dependency_closures(self):
        catalog = load("supplemental-catalog.json")
        self.assertEqual(catalog["revision"], "peanut-task42-native-media/1.0.0")
        self.assertEqual(catalog["generator"]["sha256"], hashlib.sha256((MEDIA / catalog["generator"]["path"]).read_bytes()).hexdigest())
        records = {r["path"]: r for r in catalog["files"]}
        self.assertEqual(len(records), len(catalog["files"]))
        for relative, entry in records.items():
            source = MEDIA / relative
            payload = source.read_bytes()
            self.assertEqual(entry["sha256"], hashlib.sha256(payload).hexdigest())
            self.assertEqual(entry["byteLength"], len(payload))
            actual = [p.relative_to(MEDIA).as_posix() for p in dependencies(source)]
            self.assertEqual(entry["dependencies"], actual)
        graph = {r["path"]: r["dependencies"] for r in records.values()}
        def closure(node, active):
            self.assertNotIn(node, active)
            result = {node}
            for child in graph[node]: result |= closure(child, active | {node})
            return result
        roots = load("coverage-audit.json")["assetRoots"]
        for version, info in catalog["versions"].items():
            self.assertEqual(set(info["inputs"]), set(roots))
            provenance = load(info["provenance"])
            self.assertEqual(provenance["creatorVersion"], version)
            self.assertRegex(provenance["appInfoPlistSha256"], "^[a-f0-9]{64}$")
            self.assertEqual(provenance["license"]["sha256"], records[provenance["license"]["path"]]["sha256"])
            for kind, entry in info["inputs"].items():
                expected = {"assets/bundle/checker.png"} if kind == "directory" else closure(entry["input"], set())
                if "metaSource" in entry: expected.add(entry["metaSource"])
                if kind in ["autoAtlas", "labelAtlas"]: expected.add(entry["stagingRecipe"]["sourceImage"])
                self.assertEqual(set(entry["dependencyClosure"]), expected)
                self.assertTrue(expected <= records.keys())
            self.assertEqual(info["nativeRuntimePassedRows"], 0)

    def test_truetype_has_real_cmap_metrics_and_two_contour_glyph(self):
        payload = (MEDIA / "supplemental/font/one-glyph.ttf").read_bytes()
        tables = sfnt_tables(payload)
        self.assertTrue({b"head", b"hhea", b"maxp", b"hmtx", b"cmap", b"name", b"loca", b"glyf", b"OS/2", b"post"} <= tables.keys())
        self.assertEqual(struct.unpack_from(">H", tables[b"maxp"], 4)[0], 2)
        # 两 glyph 的 advance 都是 800；合法 hmtx 压缩为一条 long metric 加第二条 LSB。
        self.assertEqual(struct.unpack_from(">H", tables[b"hhea"], 34)[0], 1)
        self.assertEqual(struct.unpack_from(">Hhh", tables[b"hmtx"], 0), (800, 0, 0))
        self.assertEqual(struct.unpack_from(">H", tables[b"head"], 18)[0], 1024)
        format_id = struct.unpack_from(">h", tables[b"head"], 50)[0]
        offsets = struct.unpack(">HHH" if format_id == 0 else ">III", tables[b"loca"])
        if format_id == 0: offsets = [x * 2 for x in offsets]
        self.assertEqual(struct.unpack_from(">h", tables[b"glyf"], offsets[1])[0], 2)
        cmap = tables[b"cmap"]
        count = struct.unpack_from(">H", cmap, 2)[0]
        glyphs = []
        for i in range(count):
            _, _, offset = struct.unpack_from(">HHI", cmap, 4 + 8 * i)
            if struct.unpack_from(">H", cmap, offset)[0] != 4: continue
            segments = struct.unpack_from(">H", cmap, offset + 6)[0] // 2
            for segment in range(segments):
                end = struct.unpack_from(">H", cmap, offset + 14 + segment * 2)[0]
                start = struct.unpack_from(">H", cmap, offset + 16 + segments * 2 + segment * 2)[0]
                delta = struct.unpack_from(">h", cmap, offset + 16 + segments * 4 + segment * 2)[0]
                roffset = struct.unpack_from(">H", cmap, offset + 16 + segments * 6 + segment * 2)[0]
                if start <= 65 <= end:
                    self.assertEqual(roffset, 0)
                    glyphs.append((65 + delta) & 0xffff)
        self.assertTrue(glyphs)
        self.assertEqual(set(glyphs), {1})
        corrupted = bytearray(payload); corrupted[-1] ^= 1
        with self.assertRaises(ValueError): sfnt_tables(bytes(corrupted))
        with self.assertRaises((ValueError, struct.error)): sfnt_tables(payload[:30])

    def test_hdr_contains_128_actual_rgbe_pixels_and_rejects_truncation(self):
        payload = (MEDIA / "supplemental/hdr/equirect.hdr").read_bytes()
        pixels = decode_hdr(payload)
        self.assertEqual(len(pixels), 128)
        self.assertEqual(len(set(pixels)), 8)
        self.assertTrue(all(p[3] != 0 for p in pixels))
        with self.assertRaises((ValueError, IndexError)): decode_hdr(payload[:-1])

    def test_spine_bone_slot_region_atlas_and_animation_close(self):
        data = load("supplemental/skeletal/one-bone-spine.json")
        self.assertEqual(data["skeleton"]["spine"], "3.8.99")
        bones = {b["name"] for b in data["bones"]}
        slots = {s["name"]: s for s in data["slots"]}
        self.assertEqual(bones, {"root"})
        for slot in slots.values(): self.assertIn(slot["bone"], bones)
        attachment = data["skins"][0]["attachments"]["tile"]["checker"]
        self.assertEqual(attachment["type"], "region")
        self.assertEqual((attachment["width"], attachment["height"]), (8, 8))
        atlas = (MEDIA / "supplemental/skeletal/one-bone-spine.atlas").read_text().splitlines()
        self.assertEqual(atlas[0], "checker.png")
        self.assertIn(attachment["path"], atlas)
        width, height, _ = png_pixels(resolve(MEDIA / "supplemental/skeletal/one-bone-spine.atlas", atlas[0]).read_bytes())
        self.assertEqual((width, height), (8, 8))
        keys = data["animations"]["turn"]["bones"]["root"]["rotate"]
        self.assertEqual([k["time"] for k in keys], [0, 1])
        self.assertNotEqual(keys[0]["angle"], keys[1]["angle"])

    def test_dragonbones_armature_displays_atlas_and_animation_close(self):
        data = load("supplemental/skeletal/one-bone-dragonbones.json")
        atlas = load("supplemental/skeletal/one-bone-dragonbones-atlas.json")
        self.assertEqual(data["version"], "5.5")
        armature = data["armature"][0]
        bones = {b["name"] for b in armature["bone"]}
        slots = {s["name"]: s for s in armature["slot"]}
        regions = {r["name"] for r in atlas["SubTexture"]}
        for slot in slots.values(): self.assertIn(slot["parent"], bones)
        for slot in armature["skin"][0]["slot"]:
            self.assertIn(slot["name"], slots)
            for display in slot["display"]: self.assertIn(display["path"], regions)
        self.assertEqual(atlas["imagePath"], "checker.png")
        self.assertEqual(atlas["SubTexture"][0], {"name": "checker", "x": 0, "y": 0, "width": 8, "height": 8})
        animation = armature["animation"][0]
        self.assertEqual(sum(k["duration"] for k in animation["bone"][0]["rotateFrame"]), animation["duration"])

    def test_plist_sprite_atlas_and_particle_have_real_image_dependencies(self):
        atlas = plistlib.loads((MEDIA / "supplemental/atlas/one-region.plist").read_bytes())
        self.assertEqual(atlas["metadata"]["format"], 2)
        region = atlas["frames"]["checker"]
        self.assertEqual(region["frame"], "{{0,0},{8,8}}")
        self.assertFalse(region["rotated"])
        particle = plistlib.loads((MEDIA / "supplemental/particle/one-emitter.plist").read_bytes())
        self.assertEqual(particle["textureFileName"], "checker.png")
        self.assertGreater(particle["particleLifespan"], 0)
        self.assertGreater(particle["emissionRate"], 0)
        self.assertEqual(particle["maxParticles"], 8)

    def test_derived_gltf_resources_point_to_actual_accessor_skin_animation_material(self):
        catalog = load("supplemental-catalog.json")
        source = MEDIA / "assets/model/triangle.gltf"
        model = json.loads(source.read_text())
        accessors = gltf_accessors(model, source)
        self.assertTrue(model["meshes"][0]["primitives"][0]["attributes"])
        self.assertTrue(model["skins"][0]["joints"])
        self.assertEqual(model["animations"][0]["channels"][0]["target"]["path"], "translation")
        self.assertTrue(model["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"])
        for version in catalog["versions"].values():
            for kind in ["mesh", "skeleton", "instantiationAnimation", "instantiationMaterial"]:
                self.assertEqual(version["inputs"][kind]["input"], "assets/model/triangle.gltf")
                self.assertTrue(version["inputs"][kind]["derivedSelector"])
        self.assertGreater(len(accessors), 5)

    def test_native_templates_and_staging_recipes_do_not_claim_uuid_registration(self):
        catalog = load("supplemental-catalog.json")
        for version, info in catalog["versions"].items():
            for kind in ["autoAtlas", "labelAtlas"]:
                entry = info["inputs"][kind]
                if kind == "autoAtlas":
                    self.assertEqual(load(entry["input"])["__type__"], "cc.SpriteAtlas")
                else:
                    # 原生 LabelAtlas 的 source 是零字节 marker，数据来自 metadata 与真正的 glyph 图片。
                    self.assertEqual((MEDIA / entry["input"]).read_bytes(), b"")
                    self.assertEqual(entry["stagingRecipe"]["inspectorPatch"]["startChar"], "A")
                self.assertTrue(entry["stagingRecipe"]["sourceImage"])
                self.assertTrue(entry["stagingRecipe"]["inspectorPatch"])
                self.assertEqual(load(entry["metaSource"])["importer"], "auto-atlas" if kind == "autoAtlas" else "label-atlas")
            cube = load(info["inputs"]["cubeMap"]["metaSource"])
            self.assertEqual(cube["userData"]["type"], "texture cube")
            self.assertTrue(cube["userData"]["isRGBE"])
            self.assertEqual(cube["subMetas"]["b47c0"]["importer"], "erp-texture-cube")
            bundle = info["inputs"]["directory"]["stagingRecipe"]
            self.assertEqual(bundle["assetdbOperation"], "asset.createFolder")
            self.assertTrue(bundle["inspectorPatch"]["isBundle"])
            self.assertNotIn("uuid", bundle)

    def test_current_933_rows_reconcile_audio_readonly_delta_without_overwriting_935_baseline(self):
        audit = load("supplemental-coverage-audit.json")
        baseline = load("coverage-audit.json")
        drift = load("current-source-drift.json")
        catalog = load("supplemental-catalog.json")
        schema = json.loads((REPO / "packages/engine/modules/lumen/bundled/schema/assets.json").read_text())
        audio = next(e for e in schema["entries"] if e["assetKind"] == "audio")
        self.assertFalse(next(f for f in audio["fields"] if f["apiName"] == "downloadMode")["writable"])
        total = 0
        for version, info in audit["versions"].items():
            draft = json.loads((REPO / f"tests/fixtures/editor-stability/coverage/creator-{version}-draft.json").read_text())
            ids = [r["caseId"] for r in info["rows"]]
            self.assertEqual(len(ids), len(set(ids)))
            delta = drift["versions"][version]
            expected = {r["caseId"] for r in baseline["versions"][version]["rows"]}
            expected.difference_update(delta["removedCases"])
            expected.update(delta["addedCases"])
            self.assertEqual(set(ids), expected)
            self.assertEqual(delta["addedCases"], [f"{version}|field:asset:audio:downloadMode|reject_write"])
            self.assertEqual(set(delta["removedCases"]), {f"{version}|field:asset:audio:downloadMode|set", f"{version}|field:asset:audio:downloadMode|reject_invalid"})
            self.assertEqual(info["inventorySha256"], delta["currentInventorySha256"])
            self.assertEqual(info["baselineInventorySha256"], draft["manifest"]["inventorySha256"])
            self.assertTrue(delta["serializedScopeUnchanged"])
            self.assertEqual(delta["serializedCaseCount"], 194)
            self.assertTrue(delta["nativeImporterModulesUnchanged"])
            self.assertEqual(info["legalInputs"], 21)
            self.assertEqual(info["nativeRuntimePassedRows"], 0)
            self.assertEqual(catalog["versions"][version]["nativeImporterLayout"], draft["inventory"]["nativeImporterModules"])
            for row in info["rows"]:
                self.assertIsNone(row["nativeResult"])
                if row["targetId"].startswith("importer:"):
                    self.assertEqual(row["status"], "module_layout_audited_runtime_registration_pending")
                else:
                    self.assertEqual(row["status"], "legal_input_dependency_mapping_static_only")
                    self.assertTrue(row["dependencyClosure"])
            total += len(ids)
        self.assertEqual(total, 933)
        self.assertEqual(sum(len(i["rows"]) for i in baseline["versions"].values()), 935)

    def test_dependency_escape_missing_file_and_corrupt_font_are_rejected(self):
        owner = MEDIA / "supplemental/skeletal/one-bone-spine.atlas"
        for uri in ["../../../../../../../outside.png", "missing.png", "/private/tmp/escape", "https://example.com/image.png"]:
            with self.assertRaises(ValueError): resolve(owner, uri)


if __name__ == "__main__":
    unittest.main(verbosity=2)
