"""Original snapshot metadata ordering; isolated fake libvirt, no VM operations."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SnapshotRegistrationTests(unittest.TestCase):
    def register(self, existing=(), missing_parent=False, wrong_disk=False, cycle=False):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            for name, parent in [('base', 'installed' if cycle else ''), ('installed', 'base')]:
                if name == 'base' and missing_parent:
                    continue
                disk = '/wrong/disk' if name == 'base' and wrong_disk else '/owned/tester.qcow2'
                (path / f'{name}.original.xml').write_text(
                    f'<domainsnapshot><name>{name}</name>'
                    + (f'<parent><name>{parent}</name></parent>' if parent else '')
                    + f'<domain><devices><disk><source file="{disk}"/></disk></devices></domain></domainsnapshot>')
            for name in existing:
                (path / f'{name}.registered').touch()
            result = subprocess.run(['bash', '-c', '''
set -euo pipefail
source scripts/vm/preflight.sh
lv() {
  case "$1" in
    snapshot-info) test -f "$out/$3.registered";;
    snapshot-create)
      test "$4" = --redefine
      local name parent
      name=$(basename "$3" .original.xml)
      parent=$(python3 -c 'import sys,xml.etree.ElementTree as E;print(E.parse(sys.argv[1]).findtext("parent/name") or "")' "$3")
      if [ -n "$parent" ] && [ ! -f "$out/$parent.registered" ]; then
        echo 'parent registration missing' >&2; return 1
      fi
      printf '%s\n' "$name" >> "$out/calls"
      touch "$out/$name.registered";;
    *) return 97;;
  esac
}
vm_register_snapshot installed
'''], cwd=ROOT, env=dict(os.environ, out=tmp, GKOS_VM_SNAPSHOT_XML_DIR=tmp,
                         LV_DISK='/owned/tester.qcow2', VM_NAME='fixture'),
                                    capture_output=True, text=True, timeout=15)
            calls = path / 'calls'
            return result.returncode, calls.read_text().splitlines() if calls.exists() else []

    def test_missing_parent_is_registered_first(self):
        self.assertEqual(self.register(), (0, ['base', 'installed']))

    def test_existing_parent_is_not_redefined(self):
        self.assertEqual(self.register(existing=['base']), (0, ['installed']))

    def test_existing_target_is_untouched(self):
        self.assertEqual(self.register(existing=['base', 'installed']), (0, []))

    def test_missing_original_parent_fails_closed(self):
        code, calls = self.register(missing_parent=True)
        self.assertNotEqual(code, 0)
        self.assertEqual(calls, [])

    def test_parent_wrong_disk_fails_closed(self):
        code, calls = self.register(wrong_disk=True)
        self.assertNotEqual(code, 0)
        self.assertEqual(calls, [])

    def test_parent_cycle_fails_closed(self):
        code, calls = self.register(cycle=True)
        self.assertNotEqual(code, 0)
        self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
