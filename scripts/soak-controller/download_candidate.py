"""Download exactly six privately archived candidate assets and verify all bytes."""
import hashlib
import json
from pathlib import Path
import time


def download(client, bucket, key, destination, expected):
    digest = hashlib.sha256()
    temporary = destination.with_suffix(destination.suffix + '.partial')
    size = 0
    deadline = time.monotonic() + 600
    response = client.get_object(Bucket=bucket, Key=key)
    try:
        with temporary.open('wb') as output:
            for chunk in response['Body'].iter_chunks(1048576):
                size += len(chunk)
                if size > expected['size'] or time.monotonic() > deadline:
                    raise RuntimeError('candidate-download-limit')
                digest.update(chunk)
                output.write(chunk)
    finally:
        response['Body'].close()
    if size != expected['size'] or digest.hexdigest() != expected['sha256']:
        raise RuntimeError('asset-digest-mismatch')
    temporary.replace(destination)
    destination.chmod(0o644)


if __name__ == '__main__':
    import boto3
    from botocore.config import Config
    config = json.load(open('/etc/wharfie-soak/campaign.json'))
    root = Path('/opt/wharfie-soak/candidate')
    client = boto3.client('s3', region_name=config['region'],
                         config=Config(connect_timeout=10, read_timeout=30, retries={'max_attempts': 2}))
    assert len(config['assets']) == 6
    for name, expected in config['assets'].items():
        assert '/' not in name and 0 < expected['size'] <= 536870912
        download(client, config['bucket'], config['campaignId'] + '/inputs/assets/' + name,
                 root / name, expected)
    manifest = json.loads((root / 'preview-release.json').read_bytes())
    assert manifest['source'] == {
        'repository': 'https://github.com/wharfie/wharfie', 'commit': config['sourceCommit']}
    assert manifest['version'] == config['version'] and manifest['tag'] == 'v' + config['version']
