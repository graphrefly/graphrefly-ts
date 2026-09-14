"""Offline integrity and actual Biome boundary negatives; no qualification claims."""

import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("checker", ROOT / "scripts/check-causal-lint-evidence.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.name = "docs/design/evidence/receipt.json"
        self.local = self.root / self.name
        self.local.parent.mkdir(parents=True)
        self.local.write_bytes(b'{"value":1}')
        self.archive = self.root / "evidence.tar.gz"
        with tarfile.open(self.archive, "w:gz") as package:
            member = tarfile.TarInfo("receipt.json")
            member.size = self.local.stat().st_size
            package.addfile(member, io.BytesIO(self.local.read_bytes()))
        self.row = {"path": self.name, "optional": False, "archive": "evidence.tar.gz",
                    "archiveSha256": checker.digest(self.archive.read_bytes()),
                    "member": "receipt.json", "sha256": checker.digest(self.local.read_bytes())}
        self.manifest = self.root / "docs/design/causal-l-closeout/frozen-files.json"
        self.manifest.parent.mkdir(parents=True)
        self.save()
        self.config = self.root / "biome.json"
        self.config.write_text(json.dumps({"files": {"includes": self.baseline + ["!" + self.name]}}))

    def save(self):
        self.baseline = json.loads((ROOT / "docs/design/causal-l-closeout/frozen-files.json").read_text())["baselineIncludes"]
        self.manifest.write_text(json.dumps({"baselineIncludes": self.baseline, "files": [self.row]}))

    def test_valid(self):
        self.assertEqual(checker.verify(self.root)["files"], 1)

    def test_corrupted_copy(self):
        self.local.write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError, "frozen file changed"):
            checker.verify(self.root)

    def test_corrupted_archive(self):
        self.archive.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, "archive changed"):
            checker.verify(self.root)

    def test_wrong_member(self):
        self.row["member"] = "absent.json"
        self.save()
        with self.assertRaisesRegex(ValueError, "archive member"):
            checker.verify(self.root)

    def test_broader_exclusion(self):
        self.config.write_text(json.dumps({"files": {"includes": ["**", "!docs/design"]}}))
        with self.assertRaisesRegex(ValueError, "exclusions differ"):
            checker.verify(self.root)

    def test_manifest_and_config_broadened_together(self):
        data = json.loads(self.manifest.read_text())
        data["baselineIncludes"].append("!docs/design")
        self.manifest.write_text(json.dumps(data))
        self.config.write_text(json.dumps({"files": {"includes": data["baselineIncludes"] + ["!" + self.name]}}))
        with self.assertRaisesRegex(ValueError, "baseline lint exclusions changed"):
            checker.verify(self.root)

    def test_wildcard_exemption_rejected(self):
        self.row["path"] = "docs/design/**"
        self.row["optional"] = True
        self.save()
        self.config.write_text(json.dumps({"files": {"includes": self.baseline + ["!docs/design/**"]}}))
        with self.assertRaisesRegex(ValueError, "unsafe path"):
            checker.verify(self.root)

    def test_required_copy_missing(self):
        self.local.unlink()
        with self.assertRaisesRegex(ValueError, "frozen file changed"):
            checker.verify(self.root)

    def test_optional_copy_missing_still_checks_archive(self):
        self.row["optional"] = True
        self.save()
        self.local.unlink()
        checker.verify(self.root)
        self.archive.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, "archive changed"):
            checker.verify(self.root)

    def test_symlink_rejected(self):
        self.local.unlink()
        self.local.symlink_to(self.archive)
        with self.assertRaisesRegex(ValueError, "symlink"):
            checker.verify(self.root)

    def test_actual_biome_maintained_tool(self):
        # Use the real repository config, not a permissive fixture substitute.
        self.config.write_bytes((ROOT / "biome.json").read_bytes())
        tool = self.root / "docs/design/causal-cost-investigation/new-maintained-tool.mjs"
        tool.parent.mkdir(parents=True)
        tool.write_text("let value = 1;\nvalue = value;\n")
        run = subprocess.run(["node", str(ROOT / "node_modules/@biomejs/biome/bin/biome"),
                              "check", str(tool), "--config-path", str(self.root)],
                             cwd=self.root, capture_output=True, text=True, timeout=30)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("noSelfAssign", run.stdout + run.stderr)


if __name__ == "__main__":
    unittest.main()
