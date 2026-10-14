"""Keep current builds separate from archives, with verifiable source provenance."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def unique_id():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def inside(path, parent):
    resolved = path.resolve()
    if not resolved.is_relative_to(parent.resolve()) or resolved == parent.resolve():
        raise ValueError(f"Path must remain inside {parent}: {path}")
    if path.is_symlink():
        raise ValueError(f"Symlinks are not build artifacts: {path}")
    return path


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE)


def source_state(root=ROOT):
    version = read_json(root / "package.json")["version"]
    gradle = (root / "android/app/build.gradle").read_text(encoding="utf-8")
    android_version = re.search(r"versionName\s+'([^']+)'", gradle)
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version) or not android_version or android_version[1] != version:
        raise ValueError("package.json and Android versionName must agree.")
    paths = set(git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z").split(b"\0")) - {b""}
    fingerprint = hashlib.sha256()
    for name in sorted(paths):
        path = inside(root / name.decode("utf-8"), root)
        fingerprint.update(name + b"\0")
        fingerprint.update((digest(path) if path.is_file() else "missing").encode() + b"\0")
    return {
        "version": version,
        "gitCommit": git(root, "rev-parse", "HEAD").decode().strip(),
        "gitBranch": git(root, "branch", "--show-current").decode().strip(),
        "dirty": bool(git(root, "status", "--porcelain", "--untracked-files=all").strip()),
        "sourceFingerprint": fingerprint.hexdigest(),
    }


def identity(record):
    return tuple(record.get(key) for key in ("version", "gitCommit", "dirty", "sourceFingerprint"))


def archive_files(files, version, root=ROOT, prefix="build"):
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
        raise ValueError("Invalid archive version")
    target = inside(root / "dist/archive" / version / f"{prefix}-{unique_id()}", root / "dist")
    # Validate every resolved source/destination before moving any file on Windows.
    for source in files:
        inside(source, root / "dist")
        inside(target / source.name, root / "dist")
        if not source.is_file():
            raise ValueError(f"Expected an artifact file: {source}")
    target.mkdir(parents=True, exist_ok=False)
    for source in files:
        source.rename(target / source.name)
    return target


def publish(artifacts, snapshot, record_name, kind, root=ROOT):
    if identity(source_state(root)) != identity(snapshot):
        raise ValueError("Source changed during build. Build again; current artifacts were kept.")
    latest = root / "dist/latest"
    latest.mkdir(parents=True, exist_ok=True)
    if Path(record_name).name != record_name or not record_name.endswith(".build.json"):
        raise ValueError("Invalid build record name")
    names = [p.name for p in artifacts]
    if len(set(names)) != len(names) or record_name in names:
        raise ValueError("Duplicate artifact names")
    for path in artifacts:
        inside(path, root)
        if not path.is_file() or path.parent.resolve() == latest.resolve():
            raise ValueError(f"Invalid staged artifact: {path}")
    # Finish copying before archiving current builds, so copy failure keeps latest usable.
    staging = root / "tmp" / f"artifacts-{unique_id()}"
    staging.mkdir(parents=True)
    details = []
    for path in artifacts:
        dest = staging / path.name
        shutil.copy2(path, dest)
        details.append({"name": path.name, "bytes": dest.stat().st_size, "sha256": digest(dest)})
    record = {"recordVersion": 1, **snapshot, "builtAtUtc": utc_now(), "kind": kind, "artifacts": details}
    write_json(staging / record_name, record)
    old_records = list(latest.glob("*.build.json"))
    known = {p.name for p in old_records}
    previous = [(path, read_json(path)) for path in old_records]
    for _, data in previous:
        known.update(item["name"] for item in data["artifacts"])
    unknown = {p.name for p in latest.iterdir()} - known
    if unknown:
        raise ValueError(f"Unrecognized files in latest; preserve and inspect them: {sorted(unknown)}")
    # A new source snapshot invalidates all variants, preventing a stale release beside a new debug.
    if previous and any(identity(data) != identity(snapshot) for _, data in previous):
        archive_files(list(latest.iterdir()), previous[0][1]["version"], root)
    else:
        for old_path, old in previous:
            # A web bundle's combined checksum file also covers the release APK.
            if old_path.name == record_name or kind == "android-release" and old.get("kind") == "web":
                files = [latest / item["name"] for item in old["artifacts"]] + [old_path]
                archive_files([p for p in files if p.exists()], old["version"], root)
    for name in names + [record_name]:
        dest = inside(latest / name, root / "dist")
        if dest.exists():
            raise ValueError(f"Refusing to overwrite unarchived artifact: {dest}")
        shutil.copy2(staging / name, dest)
    return latest / record_name


def resolve(kind, root=ROOT):
    current = source_state(root)
    record_path = root / "dist/latest" / f"HuangliPlayer-{current['version']}-{kind.removeprefix('android-')}.build.json"
    if not record_path.is_file():
        raise ValueError(f"No current {kind} build. Run build-android.ps1 first.")
    record = read_json(record_path)
    if record.get("kind") != kind or identity(record) != identity(current):
        raise ValueError("The current build does not match this source snapshot. Rebuild without -SkipBuild.")
    for item in record["artifacts"]:
        if Path(item["name"]).name != item["name"]:
            raise ValueError("Invalid artifact record")
        path = inside(record_path.parent / item["name"], root / "dist")
        if not path.is_file() or digest(path) != item["sha256"]:
            raise ValueError(f"Artifact missing or checksum changed: {path.name}")
    return next(record_path.parent / item["name"] for item in record["artifacts"] if item["name"].endswith(".apk"))


def migrate(root=ROOT):
    groups = {}
    for directory in (root / "dist/android", root / "dist/release"):
        if not directory.exists():
            continue
        for path in directory.iterdir():
            match = re.fullmatch(r"(?:CGSceneStudio|HuangliPlayer)-(\d+\.\d+\.\d+)-.+", path.name)
            if path.is_file() and match:
                groups.setdefault(match[1], []).append(path)
    results = []
    for version, files in sorted(groups.items()):
        metadata = [{"name": p.name, "sha256": digest(p), "bytes": p.stat().st_size,
                     "originalPath": p.relative_to(root).as_posix(),
                     "fileModifiedAtUtc": datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat()} for p in files]
        target = archive_files(files, version, root, "legacy")
        write_json(target / "legacy.build.json", {"recordVersion": 1, "version": version,
                   "gitCommit": None, "dirty": None, "sourceFingerprint": None,
                   "provenance": "unknown: migrated existing outputs; filenames do not prove a source commit",
                   "archivedAtUtc": utc_now(), "artifacts": metadata})
        results.append(str(target))
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    start = sub.add_parser("begin")
    start.add_argument("--output", required=True, type=Path)
    put = sub.add_parser("publish")
    put.add_argument("--snapshot", required=True, type=Path)
    put.add_argument("--artifact", action="append", required=True, type=Path)
    put.add_argument("--record", required=True)
    put.add_argument("--kind", required=True)
    get = sub.add_parser("resolve")
    get.add_argument("--kind", choices=["android-debug", "android-release"], required=True)
    sub.add_parser("migrate")
    args = parser.parse_args()
    if args.command == "begin":
        write_json(inside(args.output, ROOT / "tmp"), {**source_state(), "startedAtUtc": utc_now()})
    elif args.command == "publish":
        print(publish(args.artifact, read_json(args.snapshot), args.record, args.kind))
    elif args.command == "resolve":
        print(resolve(args.kind))
    else:
        print(json.dumps(migrate(), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
