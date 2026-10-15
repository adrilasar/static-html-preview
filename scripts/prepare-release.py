"""Check both CI packages and preserve the original release bytes on retries."""

import hashlib
import json
import os
from pathlib import Path
import re
import zipfile


def contents(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError(f"Duplicate ZIP entries in {path}")
        return {name: archive.read(name) for name in names if not name.endswith("/")}


def prepare(root, verified, output, tag="", existing=None):
    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Only stable major.minor.patch versions can be published")
    if (manifest["publisher"], manifest["name"]) != ("adrilasar", "static-html-preview"):
        raise ValueError("Unexpected extension identifier")
    if tag and tag != f"v{version}":
        raise ValueError(f"Release tag {tag!r} must match v{version}")
    filename = f"static-html-preview-{version}.vsix"
    linux = verified / "html-preview-Linux" / filename
    windows = verified / "html-preview-Windows" / filename
    linux_files, windows_files = contents(linux), contents(windows)
    for files in (linux_files, windows_files):
        packaged = json.loads(files["extension/package.json"])
        if packaged != manifest:
            raise ValueError("Packaged manifest differs from the checked-out source")
    for name in ("extension/dist/extension.js", "extension/assets/icon.png"):
        if linux_files[name] != windows_files[name]:
            raise ValueError(f"Linux and Windows packages differ: {name}")

    selected = linux
    if existing is not None and (existing / filename).exists():
        selected = existing / filename
        if contents(selected) != linux_files:
            raise ValueError("Existing release has different contents; do not replace a published version")
        print("Reusing the existing release VSIX, preserving its original checksum")
    digest = hashlib.sha256(selected.read_bytes()).hexdigest()
    checksum = f"{digest}  {filename}\n"
    if existing is not None and (existing / "SHA256SUMS").exists():
        if (existing / "SHA256SUMS").read_text(encoding="utf-8") != checksum:
            raise ValueError("Existing release checksum does not match the selected VSIX")
    output.mkdir(parents=True, exist_ok=True)
    (output / filename).write_bytes(selected.read_bytes())
    (output / "SHA256SUMS").write_text(checksum, encoding="utf-8")
    return filename, checksum


if __name__ == "__main__":
    filename, checksum = prepare(
        Path.cwd(), Path("verified"), Path("release"),
        tag=os.environ.get("RELEASE_TAG", ""), existing=Path("existing"),
    )
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"vsix={filename}\n")
    print(checksum, end="")
