import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location(
    "prepare_release", Path(__file__).resolve().parents[1] / "scripts" / "prepare-release.py"
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.verified = self.root / "verified"
        self.output = self.root / "release"
        self.existing = self.root / "existing"
        self.existing.mkdir()
        self.filename = "static-html-preview-0.2.1.vsix"
        self.manifest = {
            "publisher": "adrilasar", "name": "static-html-preview", "version": "0.2.1"
        }
        self.payload = {
            "extension/package.json": json.dumps(self.manifest).encode(),
            "extension/dist/extension.js": b"extension code",
            "extension/assets/icon.png": b"icon",
        }
        self.write_manifest()
        for platform in ("Linux", "Windows"):
            self.write_archive(self.verified / f"html-preview-{platform}" / self.filename)

    def write_manifest(self):
        (self.root / "package.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def write_archive(self, path, payload=None, comment=b""):
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path, "w") as archive:
            for name, value in (self.payload if payload is None else payload).items():
                archive.writestr(name, value)
            archive.comment = comment

    def prepare(self, tag="v0.2.1"):
        return release.prepare(
            self.root, self.verified, self.output, tag=tag, existing=self.existing
        )

    def test_matches_tag_and_writes_exact_linux_artifact(self):
        filename, checksum = self.prepare()
        linux = self.verified / "html-preview-Linux" / filename
        self.assertEqual((self.output / filename).read_bytes(), linux.read_bytes())
        self.assertEqual(checksum, f"{hashlib.sha256(linux.read_bytes()).hexdigest()}  {filename}\n")

    def test_rejects_mismatched_tag(self):
        with self.assertRaisesRegex(ValueError, "must match"):
            self.prepare(tag="v0.2.2")

    def test_rejects_prerelease_version(self):
        self.manifest["version"] = "0.2.1-beta.1"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "stable"):
            self.prepare()

    def test_rejects_wrong_publisher(self):
        self.manifest["publisher"] = "another-publisher"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "identifier"):
            self.prepare()

    def test_rejects_packaged_manifest_mismatch(self):
        self.manifest["description"] = "changed after packaging"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "manifest differs"):
            self.prepare()

    def test_rejects_different_windows_bundle(self):
        self.write_archive(
            self.verified / "html-preview-Windows" / self.filename,
            {**self.payload, "extension/dist/extension.js": b"different code"},
        )
        with self.assertRaisesRegex(ValueError, "Windows packages differ"):
            self.prepare()

    def test_retry_preserves_original_archive_bytes(self):
        original = self.existing / self.filename
        self.write_archive(original, comment=b"earlier archive with the same files")
        checksum = f"{hashlib.sha256(original.read_bytes()).hexdigest()}  {self.filename}\n"
        (self.existing / "SHA256SUMS").write_text(checksum, encoding="utf-8")
        self.prepare()
        self.assertEqual((self.output / self.filename).read_bytes(), original.read_bytes())

    def test_rejects_replacing_different_published_contents(self):
        self.write_archive(
            self.existing / self.filename,
            {**self.payload, "extension/dist/extension.js": b"already published code"},
        )
        with self.assertRaisesRegex(ValueError, "different contents"):
            self.prepare()

    def test_rejects_incorrect_existing_checksum(self):
        (self.existing / "SHA256SUMS").write_text("incorrect checksum\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.prepare()
