#!/usr/bin/env python3
"""Split the pinned, straight-alpha Spine export into lossless upright PNGs.

Requires Python 3 and Pillow. Run ``python3 split-assets.py`` to generate, or
``python3 split-assets.py --check`` to verify without writing anything.
``--root DIR`` selects a demo directory (its input is DIR/assets/source).
"""

import argparse
from collections import Counter
from dataclasses import dataclass
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import sys

from PIL import Image


ATLAS_WIDTH = 1024
PADDING = 2
RENDERABLE_TYPES = {None, "region", "mesh", "linkedmesh"}


class AssetError(ValueError):
    """Invalid source data or an inconsistent generated asset."""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(base, name):
    """Accept portable relative paths, and reject symlinks and traversal."""
    if not isinstance(name, str) or not name or "\\" in name:
        raise AssetError("Invalid relative path: {!r}".format(name))
    pieces = name.split("/")
    if any(p in ("", ".", "..") or ":" in p for p in pieces):
        raise AssetError("Unsafe relative path: {!r}".format(name))
    base = Path(base).absolute()
    if base.is_symlink():
        raise AssetError("Symlink directory is not allowed: {}".format(base))
    target = base.joinpath(*pieces)
    for candidate in (target, *target.parents):
        if candidate == base.parent:
            break
        if candidate.is_symlink():
            raise AssetError("Symlink is not allowed: {}".format(candidate))
    try:
        target.resolve().relative_to(base.resolve())
    except ValueError as exc:
        raise AssetError("Path escapes asset directory: {}".format(name)) from exc
    return target


def read_bytes(path):
    try:
        return path.read_bytes()
    except OSError as exc:
        raise AssetError("Cannot read {}: {}".format(path, exc)) from exc


def read_json(data, label):
    try:
        return json.loads(data)
    except (ValueError, UnicodeDecodeError) as exc:
        raise AssetError("Invalid JSON in {}: {}".format(label, exc)) from exc


def verify_source(source):
    """Read and verify every name/hash in source/manifest.json before use."""
    manifest = read_json(read_bytes(safe_path(source, "manifest.json")), "manifest.json")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), list):
        raise AssetError("manifest.files must be an array")
    if manifest.get("alpha") != "straight":
        raise AssetError("Only the straight-alpha export is supported")
    if not isinstance(manifest.get("commit"), str) or not manifest["commit"]:
        raise AssetError("manifest.commit is required")
    files = {}
    for entry in manifest["files"]:
        if not isinstance(entry, dict):
            raise AssetError("Invalid manifest file entry")
        name = entry.get("name")
        path = safe_path(source, name)
        if "/" in name or name in files:
            raise AssetError("Duplicate or non-basename manifest file: {}".format(name))
        expected = entry.get("sha256")
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise AssetError("Invalid manifest sha256: {}".format(name))
        data = read_bytes(path)
        if sha256(data) != expected:
            raise AssetError("Source sha256 mismatch: {}".format(name))
        files[name] = data
    for name in ("chibi-stickers.atlas", "chibi-stickers.json", "LICENSE"):
        if name not in files:
            raise AssetError("Missing manifest file: {}".format(name))
    return manifest, files


@dataclass(frozen=True)
class Region:
    name: str
    page: str
    x: int
    y: int
    width: int
    height: int
    rotate: int = 0

    @property
    def crop_box(self):
        width, height = ((self.height, self.width) if self.rotate == 90
                         else (self.width, self.height))
        return (self.x, self.y, self.x + width, self.y + height)


def _integers(value, count, label):
    try:
        values = tuple(int(part.strip()) for part in value.split(","))
    except ValueError as exc:
        raise AssetError("Invalid integers in {}".format(label)) from exc
    if len(values) != count:
        raise AssetError("Expected {} integers in {}".format(count, label))
    return values


def parse_atlas(text, allowed_groups):
    """Parse only the official page headers and bounds/rotate region format."""
    pages, regions, names = {}, [], set()
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.splitlines()
        page = lines[0].strip()
        safe_path(Path("."), page)
        if "/" in page or not page.endswith(".png") or page in pages:
            raise AssetError("Invalid or duplicate page: {}".format(page))
        headers, current, props = {}, None, {}

        def finish():
            if current is None:
                return
            if "bounds" not in props:
                raise AssetError("Missing bounds: {}".format(current))
            x, y, width, height = _integers(props["bounds"], 4, current)
            if min(x, y) < 0 or min(width, height) <= 0:
                raise AssetError("Invalid bounds: {}".format(current))
            rotate = props.get("rotate", "0")
            if rotate not in ("0", "90"):
                raise AssetError("Unsupported rotation: {} ({})".format(current, rotate))
            regions.append(Region(current, page, x, y, width, height, int(rotate)))

        for line in lines[1:]:
            line = line.strip()
            if ":" in line:
                key, value = (part.strip() for part in line.split(":", 1))
                target = headers if current is None else props
                allowed = {"size", "filter", "scale"} if current is None else {"bounds", "rotate"}
                if key not in allowed or key in target:
                    raise AssetError("Unknown or duplicate {} property: {}".format(
                        "page" if current is None else "region", key))
                target[key] = value
            else:
                finish()
                safe_path(Path("."), line)
                parts = line.split("/")
                if len(parts) != 2 or parts[0] not in allowed_groups:
                    raise AssetError("Invalid region prefix/name: {}".format(line))
                if line in names:
                    raise AssetError("Duplicate region: {}".format(line))
                names.add(line)
                current, props = line, {}
        finish()
        if "size" not in headers:
            raise AssetError("Missing page size: {}".format(page))
        size = _integers(headers["size"], 2, page)
        if min(size) <= 0:
            raise AssetError("Invalid page size: {}".format(page))
        pages[page] = size
    if not regions:
        raise AssetError("Atlas contains no regions")
    return pages, regions


def validate_references(skeleton, names):
    """Match importer lookup: path, then name, then the attachment key."""
    skins = skeleton.get("skins")
    if not isinstance(skins, list):
        raise AssetError("Expected the official skins array")
    for skin in skins:
        for slot, attachments in skin.get("attachments", {}).items():
            for key, raw in attachments.items():
                if raw.get("type") not in RENDERABLE_TYPES:
                    continue
                reference = raw.get("path")
                if reference is None:
                    reference = raw.get("name")
                if reference is None:
                    reference = key
                if reference not in names:
                    raise AssetError("Missing region {!r} for skin {!r}, slot {!r}, attachment {!r}".format(
                        reference, skin.get("name"), slot, key))


def pack_regions(regions, width=ATLAS_WIDTH, padding=PADDING):
    """Shelf pack outer rectangles; returned coordinates locate inner pixels."""
    x, y, shelf_height = 0, 0, 0
    positions = {}
    for region in sorted(regions, key=lambda r: (-r.height, -r.width, r.name)):
        outer_width, outer_height = region.width + padding * 2, region.height + padding * 2
        if outer_width > width:
            raise AssetError("Region exceeds virtual atlas width: {}".format(region.name))
        if x + outer_width > width:
            y += shelf_height
            x, shelf_height = 0, 0
        positions[region.name] = (x + padding, y + padding)
        x += outer_width
        shelf_height = max(shelf_height, outer_height)
    return positions, y + shelf_height


def restore_region(page, region):
    image = page.crop(region.crop_box)
    if region.rotate == 90:
        image = image.transpose(Image.Transpose.ROTATE_270)
    return image


def build_outputs(root):
    """Prepare all bytes in memory; no writes or directory creation."""
    assets = Path(root) / "assets"
    manifest, files = verify_source(assets / "source")
    skeleton_bytes = files["chibi-stickers.json"]
    skeleton = read_json(skeleton_bytes, "chibi-stickers.json")
    skins = skeleton.get("skins", [])
    groups = {"common"}
    for skin in skins:
        name = skin.get("name")
        if not isinstance(name, str) or "/" in name:
            raise AssetError("Invalid skin name")
        safe_path(assets, name)
        if name != "default":
            groups.add(name)
    try:
        atlas_text = files["chibi-stickers.atlas"].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise AssetError("Atlas is not UTF-8") from exc
    pages, regions = parse_atlas(atlas_text, groups)
    validate_references(skeleton, {region.name for region in regions})
    images = {}
    for name, size in pages.items():
        if name not in files:
            raise AssetError("Atlas page not in source manifest: {}".format(name))
        try:
            with Image.open(BytesIO(files[name])) as image:
                image.load()
                if image.format != "PNG" or image.size != size:
                    raise AssetError("Atlas page size/format mismatch: {}".format(name))
                images[name] = image.convert("RGBA")
        except (OSError, ValueError) as exc:
            raise AssetError("Invalid atlas PNG {}: {}".format(name, exc)) from exc
    positions, height = pack_regions(regions)
    outputs, records = {}, []
    for region in regions:
        box = region.crop_box
        page = images[region.page]
        if box[2] > page.width or box[3] > page.height:
            raise AssetError("Region outside page: {}".format(region.name))
        image = restore_region(page, region)
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        data = buffer.getvalue()
        filename = region.name + ".png"
        safe_path(assets, filename)
        outputs[filename] = data
        x, y = positions[region.name]
        records.append({
            "name": region.name, "file": filename,
            "width": image.width, "height": image.height, "x": x, "y": y,
            "source": {"page": region.page, "x": region.x, "y": region.y,
                       "width": region.width, "height": region.height, "rotate": region.rotate},
            "sha256": sha256(data),
        })
    outputs["common/skeleton.json"] = skeleton_bytes
    counts = Counter(region.name.split("/", 1)[0] for region in regions)
    index = {"version": 1, "sourceCommit": manifest["commit"],
             "skeleton": "common/skeleton.json", "width": ATLAS_WIDTH,
             "height": height, "padding": PADDING, "regions": records,
             "groups": {name: counts[name] for name in sorted(groups)}}
    outputs["parts.json"] = (json.dumps(index, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    return index, outputs


def _verify_existing_png(path, data, record, expected):
    if sha256(data) != record["sha256"]:
        raise AssetError("Output PNG sha256 mismatch: {}".format(path))
    try:
        with Image.open(BytesIO(data)) as image, Image.open(BytesIO(expected)) as correct:
            image.load()
            if image.format != "PNG" or image.mode != "RGBA":
                raise AssetError("Output must be straight RGBA PNG: {}".format(path))
            if image.size != (record["width"], record["height"]):
                raise AssetError("Output PNG size mismatch: {}".format(path))
            if image.tobytes() != correct.tobytes():
                raise AssetError("Output PNG pixels mismatch: {}".format(path))
    except (OSError, ValueError) as exc:
        raise AssetError("Invalid output PNG {}: {}".format(path, exc)) from exc


def split_assets(root=None, check=False):
    """Generate or check assets under a demo root, returning the parts index.

    Existing targets are always read first. Differing files can only be replaced
    when the previous parts index identifies them as generated outputs. No files
    are written until every target has passed this preflight.
    """
    root = Path(root) if root is not None else Path(__file__).resolve().parent
    assets = root / "assets"
    index, outputs = build_outputs(root)
    paths = {name: safe_path(assets, name) for name in outputs}
    old_bytes = {}
    for name, path in paths.items():
        if path.exists():
            old_bytes[name] = read_bytes(path)
    owned = set()
    if "parts.json" in old_bytes:
        old = read_json(old_bytes["parts.json"], "existing parts.json")
        if (not isinstance(old, dict) or old.get("version") != 1
                or not isinstance(old.get("regions"), list)
                or old.get("skeleton") != "common/skeleton.json"):
            raise AssetError("Existing parts.json is not a recognized generated index")
        owned.update(("parts.json", "common/skeleton.json"))
        for record in old["regions"]:
            if not isinstance(record, dict) or not isinstance(record.get("file"), str):
                raise AssetError("Invalid existing parts.json region")
            safe_path(assets, record["file"])
            owned.add(record["file"])
    if check:
        for record in index["regions"]:
            name = record["file"]
            if name not in old_bytes:
                raise AssetError("Missing output: {}".format(paths[name]))
            _verify_existing_png(paths[name], old_bytes[name], record, outputs[name])
        for name in ("common/skeleton.json", "parts.json"):
            if name not in old_bytes:
                raise AssetError("Missing output: {}".format(paths[name]))
            if old_bytes[name] != outputs[name]:
                raise AssetError("Output differs from source/expected index: {}".format(paths[name]))
    else:
        for name, data in outputs.items():
            if name in old_bytes and old_bytes[name] != data and name not in owned:
                raise AssetError("Refusing to overwrite unknown existing file: {}".format(paths[name]))
        for name, data in outputs.items():
            if old_bytes.get(name) == data:
                continue
            paths[name].parent.mkdir(parents=True, exist_ok=True)
            paths[name].write_bytes(data)
    return index


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify all outputs without writing")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent,
                        help="demo directory containing assets/source (default: script directory)")
    args = parser.parse_args(argv)
    try:
        index = split_assets(args.root, check=args.check)
    except (AssetError, OSError) as exc:
        print("split-assets: {}".format(exc), file=sys.stderr)
        return 1
    print("{} {} regions; virtual atlas {}x{}; {} rotated source regions".format(
        "Checked" if args.check else "Generated", len(index["regions"]),
        index["width"], index["height"],
        sum(record["source"]["rotate"] == 90 for record in index["regions"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
