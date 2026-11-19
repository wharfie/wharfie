import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile


def main():
    os.umask(0o077)
    assert os.getuid() == 60710
    import boto3
    import botocore.config
    config_path = Path('/etc/wharfie-soak/campaign.json')
    config = json.loads(config_path.read_text())
    code = Path('/opt/wharfie-soak')
    checks = [code, code / 'ops', code / 'node', code / 'node/bin/node',
              code / 'node/bin/npm', code / 'node/lib/node_modules/npm/bin/npm-cli.js',
              code / 'harness', code / 'harness/package.json',
              code / 'harness/node_modules', code / 'harness/scripts/verify-live-deployment.js',
              code / 'candidate', config_path.parent, config_path,
              *[code / 'ops' / name for name in ('supervisor.py', 'gate.mjs', 'gate_probe.py')],
              *[code / 'candidate' / name for name in config['assets']]]
    for path in checks:
        info = path.stat()
        assert info.st_uid == 0, f'Code must be owned by root: {path}'
        assert os.access(path, os.R_OK), f'Code is unreadable: {path}'
        assert not os.access(path, os.W_OK), f'Code is writable: {path}'
        if path.is_dir():
            assert os.access(path, os.X_OK), f'Code directory is not traversable: {path}'
    for name, expected in [('node', 'v24.13.1'), ('npm', '11.12.0')]:
        result = subprocess.run([str(code / 'node/bin' / name), '--version'],
                                check=True, capture_output=True, text=True, timeout=30)
        assert result.stdout.strip() == expected
    home = Path('/var/lib/wharfie-soak')
    for path in (home, home / 'runs', home / 'homes', home / 'homes/aws', home / 'homes/hetzner'):
        info = path.stat()
        assert info.st_uid == 60710 and stat.S_IMODE(info.st_mode) == 0o700
        descriptor, name = tempfile.mkstemp(prefix='bootstrap-access-', dir=path)
        try:
            assert stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o600
            os.write(descriptor, b'private bootstrap permission probe\n')
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
            os.unlink(name)
    verify = '''
      import fs from 'node:fs';
      const config = JSON.parse(fs.readFileSync('/etc/wharfie-soak/campaign.json', 'utf8'));
      import { verifyPreviewRecipientCandidate } from './scripts/preview-recipient-download.js';
      await import('./scripts/verify-live-deployment.js');
      await verifyPreviewRecipientCandidate('/opt/wharfie-soak/candidate', {
        expectedCommit: config.sourceCommit
      });
    '''
    subprocess.run([str(code / 'node/bin/node'), '--input-type=module', '-e', verify],
                   cwd=code / 'harness', check=True, timeout=120)
    print(json.dumps({'serviceUid': os.getuid(), 'publicCodeReadOnly': True,
                      'privateHomesWritable': True, 'candidateVerified': True}))


if __name__ == '__main__':
    main()
