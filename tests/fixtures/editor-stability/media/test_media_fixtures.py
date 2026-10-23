"""静态格式、真实载荷、依赖闭包与覆盖分母检查；不调用 Creator。"""
from pathlib import Path
import copy
import hashlib
import json
import math
import shlex
import struct
import subprocess
import unittest
import wave
import xml.etree.ElementTree as ET
import zlib

MEDIA = Path(__file__).resolve().parent
REPO = MEDIA.parents[3]


def read_json(path):
    return json.loads(path.read_text())


def png_pixels(content):
    if content[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("PNG signature")
    offset, chunks = 8, []
    while offset < len(content):
        if offset + 12 > len(content):
            raise ValueError("truncated PNG chunk")
        length = struct.unpack_from(">I", content, offset)[0]
        end = offset + 12 + length
        if end > len(content):
            raise ValueError("PNG chunk length")
        kind = content[offset + 4:offset + 8]
        payload = content[offset + 8:end - 4]
        if zlib.crc32(kind + payload) != struct.unpack_from(">I", content, end - 4)[0]:
            raise ValueError("PNG CRC")
        chunks.append((kind, payload))
        offset = end
    if [kind for kind, _ in chunks] != [b"IHDR", b"IDAT", b"IEND"] or chunks[-1][1]:
        raise ValueError("PNG chunk order")
    width, height, depth, color, compression, filter_mode, interlace = struct.unpack(">IIBBBBB", chunks[0][1])
    if (depth, color, compression, filter_mode, interlace) != (8, 6, 0, 0, 0):
        raise ValueError("unsupported fixture PNG profile")
    raw = zlib.decompress(chunks[1][1])
    if len(raw) != height * (width * 4 + 1):
        raise ValueError("PNG pixel payload length")
    pixels = bytearray()
    for row in range(height):
        start = row * (width * 4 + 1)
        if raw[start] != 0:
            raise ValueError("fixture PNG filter")
        pixels.extend(raw[start + 1:start + 1 + width * 4])
    return width, height, bytes(pixels)


def dependency_path(owner, uri):
    if ":" in uri or "\\" in uri or "%" in uri or Path(uri).is_absolute():
        raise ValueError("invalid media dependency URI")
    target = (owner.parent / uri).resolve()
    try:
        target.relative_to(MEDIA / "assets")
    except ValueError as error:
        raise ValueError("dependency escapes media assets") from error
    if not target.is_file():
        raise ValueError("missing media dependency")
    return target


def parse_dependencies(owner):
    if owner.suffix == ".gltf":
        document = read_json(owner)
        return [dependency_path(owner, entry["uri"]) for entry in document["buffers"] + document["images"]]
    if owner.suffix == ".fnt":
        pages = [line for line in owner.read_text().splitlines() if line.startswith("page ")]
        return [dependency_path(owner, dict(token.split("=", 1) for token in shlex.split(line)[1:])["file"]) for line in pages]
    if owner.suffix in (".tmx", ".tsx"):
        document = ET.parse(owner).getroot()
        nodes = document.findall("tileset") if owner.suffix == ".tmx" else document.findall("image")
        return [dependency_path(owner, node.attrib["source"]) for node in nodes]
    return []


def gltf_accessors(document, owner):
    payloads = [dependency_path(owner, buffer["uri"]).read_bytes() for buffer in document["buffers"]]
    for index, buffer in enumerate(document["buffers"]):
        if buffer["byteLength"] != len(payloads[index]):
            raise ValueError("glTF buffer size")
    values = []
    layouts = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    types = {5123: ("H", 2), 5126: ("f", 4)}
    for accessor in document["accessors"]:
        view = document["bufferViews"][accessor["bufferView"]]
        payload = payloads[view["buffer"]]
        fmt, size = types[accessor["componentType"]]
        count = accessor["count"] * layouts[accessor["type"]]
        relative = accessor.get("byteOffset", 0)
        start = view.get("byteOffset", 0) + relative
        if start % size or view.get("byteOffset", 0) + view["byteLength"] > len(payload) or relative + count * size > view["byteLength"]:
            raise ValueError("glTF accessor bounds/alignment")
        decoded = struct.unpack_from("<" + fmt * count, payload, start)
        if not all(math.isfinite(value) for value in decoded):
            raise ValueError("nonfinite glTF values")
        values.append(decoded)
    return values


class MediaFixtureTests(unittest.TestCase):
    def test_provenance_hashes_and_dependency_closure(self):
        catalog = read_json(MEDIA / "catalog.json")
        self.assertEqual(catalog["revision"], "peanut-task42-media/1.0.0")
        self.assertEqual(catalog["creatorEvidence"], {"3.8.3": None, "3.8.7": None})
        self.assertEqual(hashlib.sha256((MEDIA / catalog["generator"]["path"]).read_bytes()).hexdigest(), catalog["generator"]["sha256"])
        entries = {entry["path"]: entry for entry in catalog["files"]}
        actual = {p.relative_to(MEDIA).as_posix() for p in (MEDIA / "assets").rglob("*") if p.is_file()}
        self.assertEqual(set(entries), actual)
        graph = {}
        for relative, entry in entries.items():
            owner = MEDIA / relative
            payload = owner.read_bytes()
            self.assertEqual(entry["sourceRevision"], catalog["revision"])
            self.assertIn(entry["formatId"], catalog["formats"])
            self.assertEqual(entry["byteLength"], len(payload))
            self.assertEqual(entry["sha256"], hashlib.sha256(payload).hexdigest())
            dependencies = [p.relative_to(MEDIA).as_posix() for p in parse_dependencies(owner)]
            self.assertEqual(entry["dependencies"], dependencies)
            self.assertTrue(set(dependencies) <= set(entries))
            graph[relative] = dependencies
        def visit(node, active):
            self.assertNotIn(node, active, "dependency cycle")
            for child in graph[node]:
                visit(child, active | {node})
        for node in graph:
            visit(node, set())
        def closure(node):
            result = {node}
            for child in graph[node]:
                result.update(closure(child))
            return result
        for kind, relative in catalog["assetCandidates"].items():
            candidate = MEDIA / relative
            expected = {p.relative_to(MEDIA).as_posix() for p in candidate.rglob("*") if p.is_file()} if candidate.is_dir() else closure(relative)
            self.assertEqual(set(catalog["candidateDependencyClosures"][kind]), expected)

    def test_png_decodes_actual_pixels_and_rejects_corruption(self):
        payload = (MEDIA / "assets/image/checker.png").read_bytes()
        width, height, pixels = png_pixels(payload)
        self.assertEqual((width, height), (8, 8))
        self.assertGreater(len(set(pixels)), 2)
        corrupted = bytearray(payload)
        corrupted[-5] ^= 1
        with self.assertRaises(ValueError):
            png_pixels(bytes(corrupted))
        with self.assertRaises(ValueError):
            png_pixels(payload[:-1])

    def test_pcm_wave_has_nonzero_complete_samples(self):
        payload = (MEDIA / "assets/audio/tone.wav").read_bytes()
        self.assertEqual(payload[:4], b"RIFF")
        self.assertEqual(struct.unpack_from("<I", payload, 4)[0], len(payload) - 8)
        with wave.open(str(MEDIA / "assets/audio/tone.wav"), "rb") as stream:
            self.assertEqual((stream.getnchannels(), stream.getsampwidth(), stream.getframerate(), stream.getnframes()), (1, 2, 8000, 8000))
            samples = struct.unpack("<8000h", stream.readframes(8000))
        self.assertGreater(max(samples), 8000)
        self.assertLess(min(samples), -8000)
        crossings = sum(samples[i] <= 0 < samples[i + 1] for i in range(len(samples) - 1))
        self.assertTrue(439 <= crossings <= 440)

    def test_gltf_geometry_skin_animation_and_texture(self):
        owner = MEDIA / "assets/model/triangle.gltf"
        document = read_json(owner)
        self.assertEqual(document["asset"]["version"], "2.0")
        values = gltf_accessors(document, owner)
        primitive = document["meshes"][0]["primitives"][0]
        self.assertEqual(values[primitive["indices"]], (0, 1, 2))
        attributes = primitive["attributes"]
        self.assertEqual(values[attributes["POSITION"]], (0, 0, 0, 1, 0, 0, 0, 1, 0))
        self.assertEqual(values[attributes["NORMAL"]], (0, 0, 1) * 3)
        self.assertEqual(values[attributes["JOINTS_0"]], (0, 0, 0, 0) * 3)
        self.assertEqual(values[attributes["WEIGHTS_0"]], (1, 0, 0, 0) * 3)
        for attribute in attributes.values():
            self.assertEqual(document["accessors"][attribute]["count"], 3)
        self.assertEqual(document["nodes"][0]["skin"], 0)
        self.assertEqual(document["nodes"][0]["mesh"], 0)
        self.assertEqual(document["skins"][0]["joints"], [1])
        inverse = values[document["skins"][0]["inverseBindMatrices"]]
        self.assertEqual(inverse, (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1))
        material = document["materials"][primitive["material"]]
        texture = document["textures"][material["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
        self.assertEqual(texture["source"], 0)
        self.assertEqual(document["scenes"][0]["nodes"], [0, 1])
        sampler = document["animations"][0]["samplers"][0]
        self.assertEqual(values[sampler["input"]], (0, 1))
        self.assertEqual(len(values[sampler["output"]]), 6)
        self.assertEqual(document["animations"][0]["channels"][0]["target"], {"node": 1, "path": "translation"})
        image = dependency_path(owner, document["images"][0]["uri"])
        self.assertEqual(png_pixels(image.read_bytes())[:2], (8, 8))
        invalid = copy.deepcopy(document)
        invalid["bufferViews"][0]["byteLength"] = 1
        with self.assertRaises(ValueError):
            gltf_accessors(invalid, owner)

    def test_dependency_missing_or_escape_fails(self):
        owner = MEDIA / "assets/model/triangle.gltf"
        for uri in ("missing.bin", "../../../../package.json", "https://example.com/a.bin"):
            with self.assertRaises(ValueError):
                dependency_path(owner, uri)

    def test_bitmap_font_glyph_and_page_metrics(self):
        owner = MEDIA / "assets/font/one-glyph.fnt"
        records = {}
        for line in owner.read_text().splitlines():
            tokens = shlex.split(line)
            records.setdefault(tokens[0], []).append(dict(token.split("=", 1) for token in tokens[1:]))
        common = records["common"][0]
        self.assertEqual(int(common["pages"]), len(records["page"]))
        self.assertEqual(int(records["chars"][0]["count"]), len(records["char"]))
        self.assertEqual(records["char"][0]["id"], "65")
        width, height, pixels = png_pixels(parse_dependencies(owner)[0].read_bytes())
        self.assertEqual((width, height), (int(common["scaleW"]), int(common["scaleH"])))
        char = records["char"][0]
        self.assertLessEqual(int(char["x"]) + int(char["width"]), width)
        self.assertLessEqual(int(char["y"]) + int(char["height"]), height)
        self.assertIn(255, pixels[3::4])
        self.assertIn(0, pixels[3::4])

    def test_tmx_tsx_image_reference_and_tile_ids(self):
        owner = MEDIA / "assets/map/two-by-two.tmx"
        document = ET.parse(owner).getroot()
        self.assertEqual(document.attrib["orientation"], "orthogonal")
        layer = document.find("layer")
        data = layer.find("data")
        self.assertEqual(data.attrib["encoding"], "csv")
        ids = [int(value) for value in data.text.split(",")]
        self.assertEqual(len(ids), int(layer.attrib["width"]) * int(layer.attrib["height"]))
        self.assertEqual(ids, [1, 1, 1, 1])
        tileset = ET.parse(parse_dependencies(owner)[0]).getroot()
        self.assertEqual((tileset.attrib["tilecount"], tileset.attrib["columns"]), ("1", "1"))
        self.assertEqual(png_pixels(parse_dependencies(parse_dependencies(owner)[0])[0].read_bytes())[:2], (8, 8))

    def test_media_decodes_with_independent_ffmpeg(self):
        video = MEDIA / "assets/video/blue.mp4"
        result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(video)], capture_output=True, text=True, check=True)
        streams = json.loads(result.stdout)["streams"]
        self.assertEqual(len(streams), 1)
        stream = streams[0]
        self.assertEqual((stream["codec_name"], stream["width"], stream["height"], stream["pix_fmt"], int(stream["nb_frames"])), ("h264", 16, 16, "yuv420p", 4))
        self.assertAlmostEqual(float(stream["duration"]), 1)
        for source in (video, MEDIA / "assets/image/checker.png", MEDIA / "assets/font/glyph.png", MEDIA / "assets/audio/tone.wav"):
            result = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(source), "-f", "null", "-"], capture_output=True, check=True)
            self.assertEqual(result.stderr, b"")

    def test_coverage_and_importer_differences_preserve_denominator(self):
        audit = read_json(MEDIA / "coverage-audit.json")
        difference = read_json(MEDIA / "importer-diff.json")
        roots = set(audit["assetRoots"])
        self.assertEqual(len(roots), 21)
        prior_partition = read_json(REPO / "tests/fixtures/editor-stability/serialized/coverage-audit.json")["scope"]["targetPartition"]["4.2"]
        self.assertEqual(roots, set(prior_partition))
        modules = {}
        for version, expected_count in (("3.8.3", 472), ("3.8.7", 463)):
            draft = read_json(REPO / f"tests/fixtures/editor-stability/coverage/creator-{version}-draft.json")
            targets = set()
            for target in draft["inventory"]["targets"]:
                parts = target["id"].split(":")
                if target["domain"] == "importer" or (target["domain"] == "asset" and parts[1] in roots) or (target["domain"] == "field" and len(parts) > 2 and parts[1] == "asset" and parts[2] in roots):
                    targets.add(target["id"])
            expected = {case["id"] for case in draft["manifest"]["cases"] if case["targetId"] in targets}
            entry = audit["versions"][version]
            self.assertEqual(entry["inventorySha256"], draft["manifest"]["inventorySha256"])
            self.assertEqual(entry["fullDraftCaseCount"], len(draft["manifest"]["cases"]))
            self.assertEqual(len(entry["rows"]), len(expected))
            self.assertEqual({row["caseId"] for row in entry["rows"]}, expected)
            self.assertEqual(entry["scopedCaseCount"], expected_count)
            self.assertEqual(entry["gapCount"], expected_count)
            self.assertEqual(entry["candidateRowCount"], 96)
            self.assertEqual(entry["candidateRowCount"], sum(row["candidate"] is not None for row in entry["rows"]))
            self.assertEqual(entry["completeMappings"], 0)
            self.assertTrue(all(row["status"] == "gap" and row["nativeResult"] is None and row["gapCodes"] for row in entry["rows"]))
            modules[version] = set(draft["inventory"]["nativeImporterModules"])
        self.assertEqual(set(difference["common"]), modules["3.8.3"] & modules["3.8.7"])
        self.assertEqual(set(difference["only3.8.3"]), modules["3.8.3"] - modules["3.8.7"])
        self.assertEqual(set(difference["only3.8.7"]), modules["3.8.7"] - modules["3.8.3"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
