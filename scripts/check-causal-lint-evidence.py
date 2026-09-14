"""Verify exact lint exemptions against committed archive bytes; never execute evidence."""

import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def local_file(root, name):
    path = PurePosixPath(name)
    if (path.is_absolute() or ".." in path.parts or str(path) != name
            or any(char in name for char in "*?[]{}!\\")) :
        raise ValueError(f"unsafe path: {name}")
    target = root
    for part in path.parts:
        target = target / part
        if target.is_symlink():
            raise ValueError(f"symlink: {name}")
    return target


def verify(root):
    manifest = json.loads((root / "docs/design/causal-l-closeout/frozen-files.json").read_text())
    config = json.loads((root / "biome.json").read_text())
    # Baseline includes from committed 922a7586; not a caller-controlled exemption.
    baseline_digest = digest(json.dumps(manifest["baselineIncludes"], separators=(",", ":")).encode())
    if baseline_digest != "fa258fbf8d531b49c6185760283adf4fa3ec0adde4f177b4cb72daa0194c5dfc":
        raise ValueError("baseline lint exclusions changed")
    entries = manifest["files"]
    names = [entry["path"] for entry in entries]
    if len(names) != len(set(names)):
        raise ValueError("duplicate frozen file")
    expected = manifest["baselineIncludes"] + ["!" + name for name in names]
    if config["files"]["includes"] != expected:
        raise ValueError("lint exclusions differ from exact frozen manifest")
    groups = {}
    for entry in entries:
        local = local_file(root, entry["path"])
        if not local.exists() and entry["optional"]:
            pass  # Optional expanded bundle: archive remains mandatory.
        elif not local.is_file() or digest(local.read_bytes()) != entry["sha256"]:
            raise ValueError(f"frozen file changed: {entry['path']}")
        groups.setdefault(entry["archive"], []).append(entry)
    for archive_name, rows in groups.items():
        archive = local_file(root, archive_name)
        data = archive.read_bytes()
        archive_digest = digest(data)
        if any(archive_digest != row["archiveSha256"] for row in rows):
            raise ValueError(f"archive changed: {archive_name}")
        # Read the same verified bytes, without extracting archive-controlled paths.
        with tarfile.open(fileobj=io.BytesIO(data)) as package:
            members = package.getmembers()
            for row in rows:
                found = [member for member in members if member.name == row["member"]]
                if len(found) != 1 or not found[0].isfile():
                    raise ValueError(f"missing, duplicate or non-file archive member: {row['member']}")
                if digest(package.extractfile(found[0]).read()) != row["sha256"]:
                    raise ValueError(f"archive member changed: {row['member']}")
    return {"kind": "lint-frozen-integrity", "files": len(entries),
            "archives": len(groups), "currentQualified": False}


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else Path(__file__).resolve().parents[1]
    print(json.dumps(verify(root), sort_keys=True))
