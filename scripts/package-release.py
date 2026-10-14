"""Build the standalone player distribution with its pinned shared-format snapshot."""

import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
FILES = [
    "README.md", "THIRD_PARTY_NOTICES.md", "package.json", "index.html",
    "server.mjs", "Start.cmd", "start.ps1", "docs/ANDROID.md",
    "shared-lock.json",
    "datasets/index.json", "datasets/example/package.json",
    "datasets/example/README.md", "datasets/example/build_example.py",
    "datasets/example/media/station-day.png", "datasets/example/media/station-evening.png",
    "datasets/example/media/quiet-platform.wav", "datasets/example/media/arrival.wav",
    "scripts/package-dataset.py",
]
for folder in ("player", "schema"):
    for source in sorted((ROOT / folder).rglob("*")):
        if source.is_file() and not source.name.endswith(".test.mjs") and (source.suffix in (".js", ".mjs", ".html", ".css", ".json", ".md") or source.name in ("lucide-LICENSE", "huangli-icon-192.png")):
            FILES.append(source.relative_to(ROOT).as_posix())

catalog = json.loads((ROOT / "datasets/index.json").read_text(encoding="utf-8"))
if catalog != {"packages": [{"id": "example", "title": "创作者模板", "uri": "./example/package.json"}]}:
    raise SystemExit("Release catalog must contain only the independently authored example.")

output = ROOT / "dist" / "release"
output.mkdir(parents=True, exist_ok=True)
archive = output / f"HuangliPlayer-{VERSION}-web.zip"
with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=9) as package:
    for name in sorted(set(FILES)):
        path = ROOT / name
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT.resolve()):
            raise SystemExit(f"Unexpected file outside player directory: {name}")
        package.write(path, arcname=f"HuangliPlayer/{name}")

apk = ROOT / "dist" / "android" / f"HuangliPlayer-{VERSION}-release.apk"
if not apk.is_file():
    raise SystemExit("Build the release APK before packaging the release.")
checksums = output / f"HuangliPlayer-{VERSION}-SHA256SUMS.txt"
checksums.write_text("".join(
    f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
    for path in (apk, archive)
), encoding="utf-8")
print(json.dumps({"version": VERSION, "webFiles": len(set(FILES)), "zip": str(archive),
                  "zipBytes": archive.stat().st_size, "apk": str(apk), "checksums": str(checksums)}, ensure_ascii=False))
