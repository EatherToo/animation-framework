"""Regression tests for the pinned export; all generated test data is temporary.

Run: python3 -m unittest discover -s packages/chibi-demo -p test_split_assets.py -v
Requires Pillow and the verified official files in assets/source/.
"""

from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from PIL import Image


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("chibi_split_assets", HERE / "split-assets.py")
splitter = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = splitter
SPEC.loader.exec_module(splitter)


class SplitAssetsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory(prefix="chibi-split-tests-")
        cls.root = Path(cls.workspace.name)
        cls.source = cls.root / "assets" / "source"
        shutil.copytree(HERE / "assets" / "source", cls.source)
        cls.index = splitter.split_assets(cls.root)
        cls.assets = cls.root / "assets"
        cls.skeleton = json.loads((cls.source / "chibi-stickers.json").read_bytes())
        cls.pages = {}
        for path in cls.source.glob("*.png"):
            with Image.open(path) as image:
                cls.pages[path.name] = image.convert("RGBA")

    @classmethod
    def tearDownClass(cls):
        cls.workspace.cleanup()

    def copy_fixture(self, root):
        shutil.copytree(self.source, root / "assets" / "source")

    def rewrite_source(self, root, name, data):
        """Update a sample and its hash to test validation after integrity checks."""
        source = root / "assets" / "source"
        (source / name).write_bytes(data)
        manifest = json.loads((source / "manifest.json").read_bytes())
        for entry in manifest["files"]:
            if entry["name"] == name:
                entry["sha256"] = hashlib.sha256(data).hexdigest()
                entry["bytes"] = len(data)
        (source / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    def test_generate_check_and_cli_are_read_only_and_repeatable(self):
        before = {p.relative_to(self.root): (p.read_bytes(), p.stat().st_mtime_ns)
                  for p in self.root.rglob("*") if p.is_file()}
        self.assertEqual(splitter.split_assets(self.root, check=True), self.index)
        self.assertEqual(splitter.split_assets(self.root), self.index)
        result = subprocess.run(
            [sys.executable, str(HERE / "split-assets.py"), "--root", str(self.root), "--check"],
            text=True, capture_output=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Checked 164 regions", result.stdout)
        after = {p.relative_to(self.root): (p.read_bytes(), p.stat().st_mtime_ns)
                 for p in self.root.rglob("*") if p.is_file()}
        self.assertEqual(after, before)

    def test_exact_official_counts_and_schema(self):
        index = self.index
        self.assertEqual(set(index), {"version", "sourceCommit", "skeleton", "width", "height",
                                      "padding", "regions", "groups"})
        self.assertEqual(index["version"], 1)
        self.assertEqual(index["sourceCommit"], json.loads((self.source / "manifest.json").read_bytes())["commit"])
        self.assertEqual(index["skeleton"], "common/skeleton.json")
        self.assertEqual(index["width"], 1024)
        self.assertEqual(index["padding"], 2)
        self.assertEqual(len(index["regions"]), 164)
        self.assertEqual(sum(r["source"]["rotate"] == 90 for r in index["regions"]), 48)
        self.assertEqual(index["groups"]["common"], 42)
        self.assertEqual(len(index["groups"]), 10)
        self.assertEqual(set(index["groups"]), {"common"} | {
            skin["name"] for skin in self.skeleton["skins"] if skin["name"] != "default"})
        self.assertEqual(index["groups"], dict(Counter(r["name"].split("/")[0] for r in index["regions"])))
        self.assertEqual((self.assets / "common" / "skeleton.json").read_bytes(),
                         (self.source / "chibi-stickers.json").read_bytes())

    def test_every_png_pixels_dimensions_and_rotate_back(self):
        for record in self.index["regions"]:
            with self.subTest(region=record["name"]):
                source = record["source"]
                width, height = source["width"], source["height"]
                packed_width, packed_height = ((height, width) if source["rotate"] == 90 else (width, height))
                crop = self.pages[source["page"]].crop((
                    source["x"], source["y"], source["x"] + packed_width, source["y"] + packed_height))
                expected = crop.transpose(Image.Transpose.ROTATE_270) if source["rotate"] == 90 else crop
                data = (self.assets / record["file"]).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), record["sha256"])
                with Image.open(self.assets / record["file"]) as image:
                    image.load()
                    self.assertEqual(image.format, "PNG")
                    self.assertEqual(image.mode, "RGBA")
                    self.assertEqual(image.size, (width, height))
                    self.assertEqual(image.size, (record["width"], record["height"]))
                    self.assertEqual(image.tobytes(), expected.tobytes())
                    packed = image.transpose(Image.Transpose.ROTATE_90) if source["rotate"] == 90 else image
                    self.assertEqual(packed.size, crop.size)
                    self.assertEqual(packed.tobytes(), crop.tobytes())

    def test_shelf_layout_with_padding_does_not_overlap(self):
        records = self.index["regions"]
        rectangles = []
        for record in records:
            x, y, w, h = (record[k] for k in ("x", "y", "width", "height"))
            rect = (x - 2, y - 2, x + w + 2, y + h + 2)
            self.assertGreaterEqual(rect[0], 0)
            self.assertGreaterEqual(rect[1], 0)
            self.assertLessEqual(rect[2], 1024)
            self.assertLessEqual(rect[3], self.index["height"])
            for other in rectangles:
                self.assertTrue(rect[2] <= other[0] or other[2] <= rect[0]
                                or rect[3] <= other[1] or other[3] <= rect[1],
                                "Padded rectangles overlap: {} and {}".format(rect, other))
            rectangles.append(rect)
        self.assertEqual(self.index["height"], max(r[3] for r in rectangles))
        # Independently reconstruct the mandated stable shelf order.
        x, y, row_height = 0, 0, 0
        for record in sorted(records, key=lambda r: (-r["height"], -r["width"], r["name"])):
            if x + record["width"] + 4 > 1024:
                x, y, row_height = 0, y + row_height, 0
            self.assertEqual((record["x"], record["y"]), (x + 2, y + 2))
            x += record["width"] + 4
            row_height = max(row_height, record["height"] + 4)

    def test_every_texture_bearing_attachment_resolves(self):
        names = {r["name"] for r in self.index["regions"]}
        checked = 0
        for skin in self.skeleton["skins"]:
            for attachments in skin.get("attachments", {}).values():
                for key, raw in attachments.items():
                    if raw.get("type") in (None, "region", "mesh", "linkedmesh"):
                        reference = next((v for v in (raw.get("path"), raw.get("name"), key) if v is not None))
                        self.assertIn(reference, names)
                        checked += 1
        self.assertGreater(checked, 164)
        splitter.validate_references(self.skeleton, names)

    def test_reference_lookup_matches_importer_and_ignores_nontextures(self):
        sample = {"skins": [{"name": "default", "attachments": {"slot": {
            "fallback": {},
            "named": {"name": "common/name"},
            "pathed": {"type": "mesh", "path": "common/path", "name": "missing"},
            "linked": {"type": "linkedmesh", "parent": "pathed"},
            "collision": {"type": "boundingbox"},
            "route": {"type": "path"},
            "marker": {"type": "point"},
            "mask": {"type": "clipping"},
        }}}]}
        names = {"fallback", "common/name", "common/path", "linked"}
        splitter.validate_references(sample, names)
        with self.assertRaisesRegex(splitter.AssetError, "Missing region 'linked'"):
            splitter.validate_references(sample, names - {"linked"})

    def test_corrupt_generated_png_is_detected_without_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.copy_fixture(root)
            index = splitter.split_assets(root)
            target = root / "assets" / index["regions"][0]["file"]
            target.write_bytes(b"broken PNG")
            before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in root.rglob("*") if p.is_file()}
            with self.assertRaisesRegex(splitter.AssetError, "PNG sha256 mismatch"):
                splitter.split_assets(root, check=True)
            self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns)
                                      for p in root.rglob("*") if p.is_file()})

    def test_missing_check_never_creates_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.copy_fixture(root)
            with self.assertRaisesRegex(splitter.AssetError, "Missing output"):
                splitter.split_assets(root, check=True)
            self.assertEqual({p.name for p in (root / "assets").iterdir()}, {"source"})

    def test_all_manifest_hashes_are_checked_including_license(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.copy_fixture(root)
            (root / "assets" / "source" / "LICENSE").write_bytes(b"modified")
            with self.assertRaisesRegex(splitter.AssetError, "Source sha256 mismatch: LICENSE"):
                splitter.split_assets(root)
            self.assertFalse((root / "assets" / "parts.json").exists())

    def test_corrupt_source_png_with_updated_hash_is_detected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.copy_fixture(root)
            self.rewrite_source(root, "chibi-stickers.png", b"broken PNG")
            with self.assertRaisesRegex(splitter.AssetError, "Invalid atlas PNG"):
                splitter.split_assets(root)

    def test_strict_region_properties_rotation_and_paths(self):
        for suffix in ("\toffsets: 0,0,1,1\n", "\trotate: 180\n", "\trotate: 270\n"):
            with self.subTest(suffix=suffix):
                text = "page.png\n\tsize: 10,10\ncommon/part\n\tbounds: 0,0,2,3\n" + suffix
                with self.assertRaises(splitter.AssetError):
                    splitter.parse_atlas(text, {"common"})
        for name in ("../escape", "/absolute", "common/../../escape", "common\\escape", "default/part", "stranger/part"):
            with self.subTest(name=name):
                text = "page.png\n\tsize: 10,10\n" + name + "\n\tbounds: 0,0,2,3\n"
                with self.assertRaises(splitter.AssetError):
                    splitter.parse_atlas(text, {"common"})

    def test_manifest_traversal_and_duplicate_names_rejected(self):
        for name in ("../escape", "/absolute", "chibi-stickers.atlas"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                self.copy_fixture(root)
                manifest_path = root / "assets" / "source" / "manifest.json"
                manifest = json.loads(manifest_path.read_bytes())
                manifest["files"].append({"name": name, "sha256": "0" * 64})
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaises(splitter.AssetError):
                    splitter.split_assets(root)

    def test_unknown_existing_target_is_read_and_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.copy_fixture(root)
            target = root / "assets" / self.index["regions"][0]["file"]
            target.parent.mkdir(parents=True)
            target.write_bytes(b"user-owned content")
            with self.assertRaisesRegex(splitter.AssetError, "unknown existing file"):
                splitter.split_assets(root)
            self.assertEqual(target.read_bytes(), b"user-owned content")
            self.assertFalse((root / "assets" / "parts.json").exists())

    def test_output_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.copy_fixture(root)
            outside = root / "outside"
            outside.mkdir()
            (root / "assets" / "common").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(splitter.AssetError, "Symlink"):
                splitter.split_assets(root)
            self.assertEqual(list(outside.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
