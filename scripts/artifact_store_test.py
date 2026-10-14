"""Exercise archiving and stale-build rejection using disposable project-local files."""

from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import artifact_store as store


class ArtifactStoreTests(unittest.TestCase):
    def setUp(self):
        self.root = store.ROOT / "tmp" / f"artifact-test-{store.unique_id()}"
        self.root.mkdir(parents=True)
        self.snapshot = {"version": "0.2.5", "gitCommit": "a" * 40, "dirty": False, "sourceFingerprint": "first"}
        self.mock = patch.object(store, "source_state", side_effect=lambda root: dict(self.snapshot))
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def put(self, kind, payload=b"apk"):
        path = self.root / "tmp" / store.unique_id() / f"HuangliPlayer-0.2.5-{kind}.apk"
        path.parent.mkdir(parents=True)
        path.write_bytes(payload)
        return store.publish([path], dict(self.snapshot), f"HuangliPlayer-0.2.5-{kind}.build.json", f"android-{kind}", self.root)

    def test_build_pair_and_rebuild_preserve_previous_bytes(self):
        self.put("debug", b"old-debug")
        self.put("release", b"release")
        self.put("debug", b"new-debug")
        self.assertEqual(store.resolve("android-debug", self.root).read_bytes(), b"new-debug")
        self.assertEqual(store.resolve("android-release", self.root).read_bytes(), b"release")
        self.assertEqual([p.read_bytes() for p in (self.root / "dist/archive").rglob("*.apk")], [b"old-debug"])

    def test_changed_source_archives_both_variants(self):
        self.put("debug")
        self.put("release")
        self.snapshot["sourceFingerprint"] = "changed"
        self.snapshot["dirty"] = True
        with self.assertRaises(ValueError):
            store.resolve("android-debug", self.root)
        self.put("debug", b"new")
        with self.assertRaises(ValueError):
            store.resolve("android-release", self.root)
        self.assertEqual(len(list((self.root / "dist/archive").rglob("*.apk"))), 2)

    def test_changed_during_build_keeps_latest(self):
        record = self.put("debug", b"kept")
        old_snapshot = dict(self.snapshot)
        self.snapshot["sourceFingerprint"] = "changed"
        with self.assertRaises(ValueError):
            store.publish([], old_snapshot, "new.build.json", "android-debug", self.root)
        self.assertTrue(record.is_file())
        self.assertEqual(next(record.parent.glob("*.apk")).read_bytes(), b"kept")

    def test_checksum_tampering_is_rejected(self):
        record = self.put("debug")
        next(record.parent.glob("*.apk")).write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            store.resolve("android-debug", self.root)

    def test_release_rebuild_archives_old_web_checksums(self):
        self.put("release", b"first")
        web = self.root / "tmp/web.zip"
        web.write_bytes(b"web")
        record = store.publish([web], dict(self.snapshot), "web.build.json", "web", self.root)
        self.put("release", b"second")
        self.assertFalse(record.exists())
        self.assertTrue(list((self.root / "dist/archive").rglob("web.zip")))

    def test_legacy_migration_is_lossless_and_idempotent(self):
        for folder, name in [("android", "HuangliPlayer-0.2.3-debug.apk"), ("release", "HuangliPlayer-0.2.3-web.zip")]:
            path = self.root / "dist" / folder / name
            path.parent.mkdir(parents=True)
            path.write_bytes(name.encode())
        private = self.root / "dist/packages/untouched.zip"
        private.parent.mkdir(parents=True)
        private.write_bytes(b"private")
        targets = store.migrate(self.root)
        self.assertEqual(len(targets), 1)
        record = store.read_json(Path(targets[0]) / "legacy.build.json")
        self.assertIsNone(record["gitCommit"])
        for item in record["artifacts"]:
            self.assertEqual(store.digest(Path(targets[0]) / item["name"]), item["sha256"])
        self.assertEqual(store.migrate(self.root), [])
        self.assertEqual(private.read_bytes(), b"private")

    def test_archive_rejects_outside_file_before_moving(self):
        outside = self.root / "outside.apk"
        outside.write_bytes(b"keep")
        with self.assertRaises(ValueError):
            store.archive_files([outside], "0.2.5", self.root)
        self.assertTrue(outside.exists())

    def test_real_source_state_detects_uncommitted_change(self):
        self.mock.stop()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        (self.root / "android/app").mkdir(parents=True)
        (self.root / "android/app/build.gradle").write_text("versionName '0.2.5'", encoding="utf-8")
        store.write_json(self.root / "package.json", {"version": "0.2.5"})
        subprocess.run(["git", "-C", str(self.root), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.root), "-c", "user.name=Artifact Test", "-c", "user.email=artifact@example.invalid",
                        "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"], check=True)
        clean = store.source_state(self.root)
        self.assertFalse(clean["dirty"])
        (self.root / "new.txt").write_text("untracked", encoding="utf-8")
        dirty = store.source_state(self.root)
        self.assertTrue(dirty["dirty"])
        self.assertNotEqual(clean["sourceFingerprint"], dirty["sourceFingerprint"])


if __name__ == "__main__":
    unittest.main()
