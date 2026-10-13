#!/usr/bin/env python3
"""Create a portable CGScene ZIP using only the manifest's media references.

Media remains local. Images are copied as encoded bytes; they are never decoded.
Optional OGG conversion changes only the mobile copy and preserves asset IDs.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import time
from urllib.parse import quote, unquote, urlsplit
import uuid
import zipfile


PROJECT = Path(__file__).resolve().parents[1]


def safe_uri(uri: str) -> str:
    """Accept package-local URI paths only, with safe ZIP member names."""
    parts = urlsplit(uri)
    if parts.scheme or parts.netloc or parts.query or parts.fragment:
        raise ValueError(f"Media URI must be package-local: {uri!r}")
    name = unquote(parts.path)
    if not name or name.startswith(("/", "\\")) or "\\" in name:
        raise ValueError(f"Unsafe media URI: {uri!r}")
    if any(p == ".." or ":" in p or any(ord(c) < 32 for c in p)
           for p in name.split("/")):
        raise ValueError(f"Unsafe media URI: {uri!r}")
    result = str(PurePosixPath(name))
    if result in (".", "package.json", "mobile-export.json"):
        raise ValueError(f"Reserved media URI: {uri!r}")
    return result


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def encode_ogg(source: Path, output: Path, ffmpeg: str):
    source_stat = source.stat()
    signature = {"source": str(source), "sourceBytes": source_stat.st_size,
                 "sourceMtimeNs": source_stat.st_mtime_ns,
                 "codec": "libvorbis", "quality": 4}
    cache = output.with_suffix(".cache.json")
    if (output.is_file() and output.stat().st_size > 0 and cache.is_file()
            and read_json(cache) == signature):
        return False
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.stem + "." + uuid.uuid4().hex + ".partial.ogg")
    result = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
         "-i", str(source), "-map", "0:a:0", "-vn", "-map_metadata", "-1",
         "-c:a", "libvorbis", "-q:a", "4", "-threads", "1", str(temporary)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        encoding="utf-8", errors="replace")
    if result.returncode or not temporary.is_file() or not temporary.stat().st_size:
        raise RuntimeError(f"Audio conversion failed: {source.name}\n{result.stderr}")
    temporary.replace(output)
    write_json(cache, signature)
    return True


def build(args):
    started = time.monotonic()
    manifest_path = Path(args.input).resolve()
    if manifest_path.is_dir():
        manifest_path /= "package.json"
    root = manifest_path.parent
    output = Path(args.output).resolve()
    if output.exists():
        raise ValueError(f"Output already exists; choose a new output path: {output}")
    staging = Path(args.staging).resolve() if args.staging else (
        PROJECT / "tmp" / ("mobile-" + root.name))
    staging.mkdir(parents=True, exist_ok=True)
    package = read_json(manifest_path)
    assets = package.get("assets", {})
    if not isinstance(assets, dict):
        raise ValueError("Expected assets.visuals / assets.audio arrays")
    files: dict[str, Path] = {}
    original_files: dict[str, Path] = {}
    audio_sources: dict[str, tuple[Path, Path]] = {}
    used_names: dict[str, str] = {}
    asset_counts = {}
    unavailable_count = 0
    for group, records in assets.items():
        if not isinstance(records, list):
            continue
        asset_counts[group] = len(records)
        for asset in records:
            uri = asset.get("uri")
            if asset.get("status") not in (None, "available"):
                unavailable_count += 1
                continue
            if not isinstance(uri, str) or not uri:
                raise ValueError(f"Available asset has no URI: {asset.get('id')}")
            name = safe_uri(uri)
            source = (root / name).resolve()
            if not source.is_relative_to(root) or not source.is_file():
                raise ValueError(f"Asset is outside package or missing: {uri!r}")
            original_files[name] = source
            is_audio = group == "audio" or str(asset.get("mimeType", "")).startswith("audio/")
            if is_audio and args.audio_format == "ogg":
                # A digest avoids collisions between similarly named original tracks.
                key = hashlib.sha256(name.encode("utf-8")).hexdigest()[:24]
                name = "media/mobile-audio/" + key + ".ogg"
                destination = staging / name
                audio_sources[name] = (source, destination)
                files[name] = destination
                asset["mimeType"] = "audio/ogg"
                for stale_key in ("byteCount", "byteLength", "size", "bytes", "hash", "sha256", "checksum"):
                    asset.pop(stale_key, None)
                if isinstance(asset.get("source"), dict):
                    asset["source"].pop("byteCount", None)
            else:
                files[name] = source
            folded = name.casefold()
            if folded in used_names and used_names[folded] != name:
                raise ValueError(f"Case-insensitive ZIP path collision: {name}")
            used_names[folded] = name
            # URI escaping and ZIP filenames are separate: a literal # or % in
            # a valid filename must not turn into a fragment or second escape.
            asset["uri"] = quote(name, safe="/")

    converted = reused = 0
    if audio_sources:
        ffmpeg = str(Path(args.ffmpeg).resolve()) if args.ffmpeg else shutil.which("ffmpeg")
        if not ffmpeg or not Path(ffmpeg).is_file():
            raise ValueError("OGG output requires --ffmpeg pointing to ffmpeg.exe")
        print(f"Preparing {len(audio_sources)} unique audio files with up to {args.jobs} workers", flush=True)
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            work = [pool.submit(encode_ogg, source, destination, ffmpeg)
                    for source, destination in audio_sources.values()]
            for done, future in enumerate(as_completed(work), 1):
                if future.result():
                    converted += 1
                else:
                    reused += 1
                if done % 25 == 0 or done == len(work):
                    print(f"Audio {done}/{len(work)}; converted={converted}, reused={reused}", flush=True)

    report = {
        "format": "cgscene.zip", "createdUtc": datetime.now(timezone.utc).isoformat(),
        "sourceManifest": str(manifest_path), "schemaVersion": package.get("schemaVersion"),
        "sceneCount": len(package.get("scenes", [])),
        "pageCount": sum(len(scene.get("pages", [])) for scene in package.get("scenes", [])),
        "assetEntries": asset_counts, "uniqueMediaFiles": len(files),
        "unavailableAssetEntries": unavailable_count,
        "originalMediaBytes": sum(p.stat().st_size for p in original_files.values()),
        "packagedMediaBytes": sum(p.stat().st_size for p in files.values()),
        "audio": {"format": args.audio_format, "uniqueFiles": len(audio_sources),
                  "converted": converted, "reused": reused,
                  "lossy": args.audio_format == "ogg",
                  "encoder": "libvorbis q4" if args.audio_format == "ogg" else None},
        "notes": ["Original dataset unchanged; asset IDs and page/transition references preserved.",
                  "Images copied as encoded bytes without decoding or rendering.",
                  "OGG mode uses lossy audio compression; loop endpoints and listening quality need local review."]
    }
    manifest_bytes = (json.dumps(package, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    report_bytes = (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_zip = staging / (output.name + "." + uuid.uuid4().hex + ".partial")
    print(f"Packing {len(files)} media files", flush=True)
    with zipfile.ZipFile(temporary_zip, "x", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=3, allowZip64=True) as archive:
        archive.writestr("package.json", manifest_bytes)
        archive.writestr("mobile-export.json", report_bytes)
        for count, (name, source) in enumerate(sorted(files.items()), 1):
            archive.write(source, name)
            if count % 100 == 0 or count == len(files):
                print(f"ZIP {count}/{len(files)}", flush=True)

    # Metadata-only verification: no image or audio decode and no full archive reread.
    with zipfile.ZipFile(temporary_zip) as archive:
        entries = {entry.filename: entry for entry in archive.infolist()}
        expected = {"package.json", "mobile-export.json", *files}
        if set(entries) != expected or len(archive.infolist()) != len(expected):
            raise ValueError("ZIP member list does not match the manifest")
        for name, source in files.items():
            if entries[name].file_size != source.stat().st_size:
                raise ValueError(f"ZIP member size mismatch: {name}")
    temporary_zip.replace(output)
    report["output"] = str(output)
    report["zipBytes"] = output.stat().st_size
    report["elapsedSeconds"] = round(time.monotonic() - started, 2)
    report["validation"] = "All available manifest asset URIs are safe and packaged; ZIP member names and sizes checked."
    report_path = Path(args.report).resolve() if args.report else staging / "package-report.json"
    write_json(report_path, report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Dataset directory or package.json")
    parser.add_argument("--output", required=True, help="New output .cgscene.zip path")
    parser.add_argument("--audio-format", choices=("original", "ogg"), default="original")
    parser.add_argument("--ffmpeg", help="FFmpeg executable; needed for OGG if not on PATH")
    parser.add_argument("--jobs", type=int, choices=range(1, 5), default=4)
    parser.add_argument("--staging", help="Local audio cache; default project tmp/mobile-<dataset>")
    parser.add_argument("--report", help="JSON report path; defaults under staging")
    build(parser.parse_args())
