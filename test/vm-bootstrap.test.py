"""Regression checks for fail-closed VM bootstrap; no hypervisor or guest needed."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BootstrapTests(unittest.TestCase):
    def run_bootstrap(self, failure):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            tool = path / 'multipass'
            tool.write_text('''#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$VM_TEST_LOG"
case "$1" in
info) exit 0;;
exec)
  case "${!#}" in
    *cloud-init*) [ "$VM_TEST_FAILURE" != cloud-init ];;
    *command\\ -v\\ node*) [ "$VM_TEST_FAILURE" != node-present ];;
    *) exit 0;;
  esac;;
*) exit 0;;
esac
''')
            tool.chmod(0o755)
            log = path / 'calls'
            env = dict(os.environ, PATH=f'{tmp}:{os.environ["PATH"]}',
                       CLAWOS_VM_DRIVER='multipass', VM_TEST_LOG=str(log),
                       VM_TEST_FAILURE=failure)
            result = subprocess.run(['bash', 'scripts/vm/up.sh'], cwd=ROOT,
                                    env=env, capture_output=True)
            return result.returncode, log.read_text().splitlines()

    def test_cloud_init_failure_cannot_create_base(self):
        code, calls = self.run_bootstrap('cloud-init')
        self.assertNotEqual(code, 0)
        self.assertNotIn('snapshot', calls)

    def test_preinstalled_node_cannot_create_base(self):
        code, calls = self.run_bootstrap('node-present')
        self.assertNotEqual(code, 0)
        self.assertNotIn('snapshot', calls)


if __name__ == '__main__':
    unittest.main()
