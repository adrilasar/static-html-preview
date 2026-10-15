"""Validate the release version and prepare the tested Linux VSIX."""

import hashlib
import json
import os
from pathlib import Path
import re
import zipfile


def prepare(root, verified, output, tag=""):
    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Only stable major.minor.patch versions can be published")
    if (manifest["publisher"], manifest["name"]) != ("adrilasar", "static-html-preview"):
        raise ValueError("Unexpected extension identifier")
    if tag and tag != f"v{version}":
        raise ValueError(f"Release tag {tag!r} must match v{version}")
    filename = f"static-html-preview-{version}.vsix"
    package = verified / filename
    with zipfile.ZipFile(package) as archive:
        packaged = json.loads(archive.read("extension/package.json"))
    if packaged != manifest:
        raise ValueError("Packaged manifest differs from the checked-out source")
    data = package.read_bytes()
    checksum = f"{hashlib.sha256(data).hexdigest()}  {filename}\n"
    output.mkdir(parents=True, exist_ok=True)
    (output / filename).write_bytes(data)
    (output / "SHA256SUMS").write_text(checksum, encoding="utf-8")
    return filename, checksum


if __name__ == "__main__":
    filename, checksum = prepare(
        Path.cwd(), Path("verified"), Path("release"),
        tag=os.environ.get("RELEASE_TAG", ""),
    )
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"vsix={filename}\n")
    print(checksum, end="")
