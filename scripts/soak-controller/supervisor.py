#!/usr/bin/python3
"""Finite, restartable campaign supervisor. No IAM or controller-delete calls."""
import concurrent.futures
import fcntl
import hashlib
import io
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import signal
import shutil
import stat
import subprocess
import tarfile
import threading
import time

ROOT = Path('/var/lib/wharfie-soak')
NODE = '/opt/wharfie-soak/node/bin/node'
RUNNER = '/opt/wharfie-soak/ops/gate.mjs'
HARNESS = '/opt/wharfie-soak/harness'
CANDIDATE = '/opt/wharfie-soak/candidate'
MAX_JSON = 262144
STOP = threading.Event()
STOP_REASON = None
REPORT_NAMES = (
    'run.json', 'report.json', 'cleanup-report.json', 'retirement.json',
    'failure.json', 'soak-progress.json', 'soak.json', 'preview.json',
    'preview-next.json', 'apply.json', 'package.json', 'status.json',
    'gate-request.json', 'gate-approved.json',
)
SOAK_HOURS = (48, 72)
# A resumed observation, including the final one and the runner's teardown, may
# use this budget. Its child limit is also capped at the campaign deadline, so a
# full soak must end at least this budget plus five minutes of scheduling slack
# before the deadline, or the final teardown would be terminated.
RESUME_BUDGET = 1800
FINAL_OBSERVATION_MARGIN = RESUME_BUDGET + 300
# Observation exports retried after a failure, and the first backoff in seconds.
EXPORT_ATTEMPTS = 4
EXPORT_BACKOFF = 15
# Runner phases that finish before `prepare-apply` persists a possible provider
# mutation (scripts/verify-live-deployment.js). A run that stopped in these
# phases, then removed its workspace, never created a guest. `preview-next` is
# excluded: the runner records the deployment identity before it, so a failure
# there is left to packaged cleanup and operator review.
PRE_APPLY_PHASES = ('package', 'verify-executable', 'local-cli', 'preview')
NEVER_CREATED_PHASES = frozenset(PRE_APPLY_PHASES + ('prepare-removal', 'remove-workspace'))


def request_stop(cause, signum=None):
    global STOP_REASON
    if STOP_REASON is None:
        STOP_REASON = {'cause': cause, 'signal': signum, 'at': time.time(),
                       'monotonicAt': time.monotonic()}
    STOP.set()


class CampaignTimeRefused(RuntimeError):
    """The remaining campaign time cannot hold a full soak and its final teardown."""


def read_json(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_JSON:
        raise RuntimeError('invalid-evidence-file')
    return json.loads(path.read_bytes())


def atomic_json(path, value):
    data = json.dumps(value, separators=(',', ':'), sort_keys=True).encode()
    if len(data) > MAX_JSON:
        raise RuntimeError('evidence-limit')
    temporary = path.with_name(path.name + '.tmp')
    with open(temporary, 'wb') as target:
        os.chmod(temporary, 0o600)
        target.write(data)
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def safe_relative_run(label):
    if label not in ('rehearsal-aws', 'rehearsal-hetzner', 'soak-aws', 'soak-hetzner'):
        raise RuntimeError('invalid-run-label')
    return ROOT / 'runs' / label


def provider_environment(provider, token):
    # No laptop SSO cache, profiles, access keys, or unrelated parent env.
    result = {
        'HOME': str(ROOT / 'homes' / provider), 'USER': 'wharfie-soak',
        'LOGNAME': 'wharfie-soak', 'PATH': '/opt/wharfie-soak/node/bin:/usr/bin:/bin',
        'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'TMPDIR': '/tmp',
    }
    if provider == 'aws':
        result['AWS_REGION'] = 'us-east-2'
        result['AWS_DEFAULT_REGION'] = 'us-east-2'
    elif provider == 'hetzner':
        result['HCLOUD_TOKEN'] = token
    else:
        raise RuntimeError('invalid-provider')
    return result


def soak_hours(config):
    value = config.get('soakHours')
    if type(value) is not int or value not in SOAK_HOURS:
        raise RuntimeError('invalid-soak-hours')
    return value


def cleanup_verified(run_dir):
    report = read_json(run_dir / 'report.json') if (run_dir / 'report.json').exists() else {}
    cleanup_file = run_dir / 'cleanup-report.json'
    cleanup = read_json(cleanup_file) if cleanup_file.exists() else report
    return (cleanup.get('workspaceRemoved') is True
            and (cleanup.get('cleanup') or {}).get('status') == 'absent'
            and not (run_dir / 'workspace').exists())


def never_created_evidence(provider, run, report, retirement, cleanup):
    """Exact runner evidence that no provider mutation was ever attempted.

    This is not verified absence: nothing was observed absent because nothing
    was created. It settles cleanup only; the run itself remains failed.
    """
    if provider not in ('aws', 'hetzner'):
        return False
    if not all(isinstance(value, dict) for value in (run, report, retirement, cleanup)):
        return False
    binding = retirement.get('binding')
    phases = report.get('phases')
    failure = report.get('failure')
    run_id = run.get('runId')
    return (run.get('applyAttempted') is False
            and run.get('deploymentInstanceId') is None
            and isinstance(run_id, str) and len(run_id) > 0
            and isinstance(binding, dict)
            and binding.get('provider') == run.get('provider') == report.get('provider') == provider
            and binding.get('runId') == run_id
            and binding.get('deploymentInstanceId') is None
            and retirement.get('cleanup') == {'status': 'not-created'}
            and report.get('status') == 'failed'
            and isinstance(failure, dict) and failure.get('phase') in PRE_APPLY_PHASES
            and isinstance(phases, list) and len(phases) > 0
            and all(isinstance(entry, dict) and entry.get('phase') in NEVER_CREATED_PHASES
                    for entry in phases)
            and report.get('cleanup') == {'status': 'not-created'}
            and cleanup.get('workspaceRemoved') is True
            and cleanup.get('cleanup') == {'status': 'not-created'})


def never_created(run_dir):
    try:
        run, report, retirement = (read_json(run_dir / name)
                                   for name in ('run.json', 'report.json', 'retirement.json'))
        cleanup_file = run_dir / 'cleanup-report.json'
        cleanup = read_json(cleanup_file) if cleanup_file.exists() else report
    except (OSError, ValueError, RuntimeError):
        return False
    provider = run_dir.name.split('-')[-1]
    return (never_created_evidence(provider, run, report, retirement, cleanup)
            and not (run_dir / 'workspace').exists())


def cleanup_settled(outcome):
    """Guest cleanup is finished: verified absent, or proven never created."""
    return outcome.get('cleanupVerifiedAbsent') is True or outcome.get('neverCreated') is True


def recovery_archive(run_dir, destination):
    # Entire exact retained run is needed: executable + journal + SSH authority.
    # Credentials are deliberately outside run_dir. No broad home/tree backup.
    if not stat.S_ISDIR(run_dir.lstat().st_mode) or run_dir.resolve() != run_dir.absolute():
        raise RuntimeError('nonregular-recovery-root')
    paths = []
    total = 0
    for base, dirs, files in os.walk(run_dir, followlinks=False):
        for name in [*dirs, *files]:
            path = Path(base) / name
            info = path.lstat()
            if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise RuntimeError('nonregular-recovery-authority')
            if stat.S_ISREG(info.st_mode):
                total += info.st_size
                paths.append(path)
                if len(paths) > 2048 or total > 1073741824:
                    raise RuntimeError('recovery-authority-limit')
    temporary = destination.with_suffix('.partial')
    with tarfile.open(temporary, 'w:gz', compresslevel=1) as output:
        for path in sorted(paths):
            output.add(path, arcname=path.relative_to(ROOT), recursive=False)
            if temporary.stat().st_size > 536870912:
                raise RuntimeError('recovery-archive-limit')
    if temporary.stat().st_size > 536870912:
        raise RuntimeError('recovery-archive-limit')
    os.replace(temporary, destination)
    return {'files': len(paths), 'uncompressedBytes': total}


class Evidence:
    def __init__(self, config, client):
        self.config, self.client = config, client

    def key(self, suffix):
        if '..' in suffix or suffix.startswith('/'):
            raise RuntimeError('invalid-proof-key')
        return self.config['campaignId'] + '/' + suffix

    def put_file(self, suffix, path, limit=MAX_JSON):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise RuntimeError('invalid-proof-size')
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for chunk in iter(lambda: source.read(1048576), b''):
                digest.update(chunk)
        expected = digest.hexdigest()
        with path.open('rb') as source:
            self.client.put_object(Bucket=self.config['bucket'], Key=self.key(suffix),
                                   Body=source, ContentLength=info.st_size,
                                   ServerSideEncryption='AES256',
                                   Metadata={'sha256': expected})
        # A success response alone is insufficient for retirement authority.
        received = self.client.get_object(Bucket=self.config['bucket'], Key=self.key(suffix))
        digest = hashlib.sha256()
        size = 0
        deadline = time.monotonic() + 600
        try:
            for chunk in received['Body'].iter_chunks(1048576):
                size += len(chunk)
                if size > limit or time.monotonic() > deadline:
                    raise RuntimeError('proof-readback-limit')
                digest.update(chunk)
        finally:
            received['Body'].close()
        if size != info.st_size or digest.hexdigest() != expected:
            raise RuntimeError('proof-readback-mismatch')
        return {'key': self.key(suffix), 'sha256': expected, 'size': size}

    def get_optional(self, suffix):
        if suffix not in ('gates/rehearsal-aws/approved.json', 'gates/soak-aws/approved.json'):
            raise RuntimeError('invalid-optional-proof-key')
        key = self.key(suffix)
        # GetObject of a missing object may be403 without unscoped ListBucket.
        # Explicitly list only the one allowed approval prefix instead.
        listed = self.client.list_objects_v2(Bucket=self.config['bucket'], Prefix=key, MaxKeys=2)
        entries = listed.get('Contents', [])
        if listed.get('IsTruncated') or any(entry['Key'] != key for entry in entries) or len(entries) > 1:
            raise RuntimeError('ambiguous-gate-approval')
        if not entries:
            return None
        result = self.client.get_object(Bucket=self.config['bucket'], Key=key)
        try:
            body = result['Body'].read(MAX_JSON + 1)
        finally:
            result['Body'].close()
        if len(body) > MAX_JSON:
            raise RuntimeError('oversized-approval')
        return json.loads(body)


class Campaign:
    def __init__(self, config, evidence, token):
        self.config, self.evidence, self.token = config, evidence, token
        self.state_path = ROOT / 'supervisor.json'
        if self.state_path.exists():
            self.state = read_json(self.state_path)
            if self.state['specSha256'] != config['specSha256']:
                raise RuntimeError('campaign-authority-changed')
        else:
            self.state = {'format': 'wharfie.soak.supervisor.v1', 'specSha256': config['specSha256'],
                          'campaignId': config['campaignId'], 'startedAt': time.time(), 'runs': {}}
            self.save()
        self.soak_hours = soak_hours(config)
        self.deadline = min(config['stopAt'] - 7200,
                            self.state['startedAt'] + (self.soak_hours + 4) * 3600)
        self.monotonic_deadline = time.monotonic() + max(0, self.deadline - time.time())
        self.lock = threading.Lock()
        self.event_lock = threading.Lock()
        self.diagnostic_lock = threading.Lock()
        self.diagnostic_thread = None
        self.diagnostic_start_lock = threading.Lock()

    def event(self, label, kind, **fields):
        """Best-effort fixed diagnostics must never block lifecycle actions."""
        try:
            path = ROOT / (label + '-observer.json')
            with self.event_lock:
                value = read_json(path) if path.exists() else {'events': []}
                value['events'] = value['events'][-127:] + [{
                    'event': kind, 'at': time.time(), 'monotonicAt': time.monotonic(), **fields}]
                atomic_json(path, value)
            return True
        except Exception:
            return False

    def schedule_diagnostics(self):
        """At most one bounded SDK/readback job; never wait in child supervision.

        The worker is a daemon so optional network I/O cannot retain the process
        after mandatory cleanup/export. Existing SDK timeouts, retry limits and
        readback byte/time limits bound each attempt. A stalled attempt prevents
        additional workers instead of accumulating threads or queued requests.
        """
        try:
            with self.diagnostic_start_lock:
                if self.diagnostic_thread is not None and self.diagnostic_thread.is_alive():
                    return False
                def work():
                    try:
                        self.export_controller()
                    except Exception:
                        pass
                self.diagnostic_thread = threading.Thread(target=work, daemon=True)
                self.diagnostic_thread.start()
            return True
        except Exception:
            return False

    def export_controller(self):
        if not self.diagnostic_lock.acquire(blocking=False):
            return
        try:
            return self._export_controller()
        finally:
            self.diagnostic_lock.release()

    def _export_controller(self):
        counters = {}
        path = Path('/sys/fs/cgroup/system.slice/wharfie-soak.service/memory.events')
        if path.exists():
            for line in path.read_text()[:2048].splitlines():
                key, value = line.split()
                if key in ('low', 'high', 'max', 'oom', 'oom_kill', 'oom_group_kill') and value.isdigit():
                    counters[key] = int(value)
        usage = shutil.disk_usage(ROOT)
        value = {'campaignId': self.config['campaignId'], 'at': time.time(),
                 'monotonicAt': time.monotonic(), 'pid': os.getpid(),
                 'stopRequested': STOP.is_set(), 'stopReason': STOP_REASON,
                 'deadline': self.deadline, 'monotonicDeadline': self.monotonic_deadline,
                 'memoryEvents': counters, 'diskAvailableBytes': usage.free}
        path = ROOT / 'supervisor-diagnostics.json'
        atomic_json(path, value)
        self.evidence.put_file('supervisor-diagnostics.json', path)

    def export_logs(self, label):
        archive = ROOT / (label + '-diagnostics.tar.gz')
        temporary = archive.with_suffix('.partial')
        with tarfile.open(temporary, 'w:gz', compresslevel=1) as output:
            for name in (label + '.log', label + '.log.1', label + '-observer.json'):
                path = ROOT / name
                if not path.exists():
                    continue
                info = path.lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_size > 4198400:
                    raise RuntimeError('diagnostic-log-limit')
                # Snapshot the current bounded rotation while its writer continues.
                with path.open('rb') as source:
                    data = source.read(4198401)
                if len(data) > 4198400:
                    raise RuntimeError('diagnostic-log-limit')
                member = tarfile.TarInfo(name)
                member.size, member.mode = len(data), 0o600
                output.addfile(member, io.BytesIO(data))
        os.replace(temporary, archive)
        return self.evidence.put_file('runs/' + label + '/diagnostics.tar.gz', archive, 16777216)

    def wait_for_tick(self, label):
        checkpoint = read_json(safe_relative_run(label) / 'soak.json')
        if checkpoint.get('pending') or checkpoint.get('complete'):
            return
        expected = (checkpoint['endAt'] - checkpoint['startedAt'] - 300000) // checkpoint['intervalMs'] + 1
        next_at = (checkpoint['endAt'] if len(checkpoint['completed']) == expected else
                   checkpoint['startedAt'] + len(checkpoint['completed']) * checkpoint['intervalMs']) / 1000
        previous = time.time()
        if not 0 <= max(0, next_at - previous) <= 900:
            raise RuntimeError('observer-wait-outside-schedule')
        deadline = time.monotonic() + max(0, next_at - previous) + 30
        self.event(label, 'waiting', nextAt=next_at)
        while time.time() < next_at:
            current = time.time()
            if current < previous or time.monotonic() >= deadline:
                raise RuntimeError('observer-wait-clock-failed')
            previous = current
            if STOP.is_set() or current >= self.deadline or time.monotonic() >= self.monotonic_deadline:
                raise RuntimeError('campaign-stop-during-wait')
            STOP.wait(min(5, next_at - current))

    def save(self):
        atomic_json(self.state_path, self.state)

    def export_run(self, label, recovery=False):
        run_dir = safe_relative_run(label)
        entries = []
        for name in REPORT_NAMES:
            path = run_dir / name
            if path.exists():
                read_json(path)
                entries.append(self.evidence.put_file('runs/' + label + '/' + name, path))
        diagnostic_failures = []
        observer = ROOT / (label + '-observer.json')
        try:
            if observer.exists():
                entries.append(self.evidence.put_file('runs/' + label + '/observer.json', observer))
        except Exception:
            diagnostic_failures.append('observer.json')
        try:
            entries.append(self.export_logs(label))
        except Exception:
            diagnostic_failures.append('diagnostics.tar.gz')
        if recovery and (run_dir / 'workspace').exists():
            archive = ROOT / (label + '-recovery.tar.gz')
            counts = recovery_archive(run_dir, archive)
            item = self.evidence.put_file('runs/' + label + '/recovery.tar.gz', archive, 536870912)
            item.update(counts)
            entries.append(item)
        manifest = ROOT / (label + '-export.json')
        atomic_json(manifest, {'campaignId': self.config['campaignId'], 'label': label,
                              'exportedAt': time.time(), 'files': entries,
                              'optionalDiagnosticsUnavailable': diagnostic_failures})
        self.evidence.put_file('runs/' + label + '/export.json', manifest)

    def export_observation(self, label):
        """Export a running soak's evidence; a transient failure is retried.

        Attempts and backoff are bounded (15 + 30 + 60 s) well inside one
        observation interval. A persistent failure still raises and fails the
        run: a soak whose evidence cannot be exported is not a pass.
        """
        for attempt in range(EXPORT_ATTEMPTS):
            try:
                return self.export_run(label)
            except Exception as error:
                if attempt + 1 == EXPORT_ATTEMPTS or STOP.is_set():
                    raise
                self.event(label, 'export-retry', attempt=attempt + 1, failureType=type(error).__name__)
                if STOP.wait(EXPORT_BACKOFF * 2 ** attempt):
                    raise

    def transfer_gate(self, label):
        run_dir = safe_relative_run(label)
        request = run_dir / 'gate-request.json'
        approval_path = run_dir / 'gate-approved.json'
        if request.exists() and not approval_path.exists():
            gate = read_json(request)
            if not (run_dir / 'gate-exported.json').exists():
                self.evidence.put_file('gates/' + label + '/request.json', request)
                atomic_json(run_dir / 'gate-exported.json', {'runId': gate['runId']})
            approval = self.evidence.get_optional('gates/' + label + '/approved.json')
            if approval is not None:
                for key in ('runId', 'runSha256', 'previewSha256', 'deploymentInstanceId', 'campaignId'):
                    if approval.get(key) != gate[key]:
                        raise RuntimeError('gate-approval-mismatch')
                atomic_json(approval_path, approval)

    def invoke(self, label, arguments, cleanup=False):
        provider = label.split('-')[-1]
        logger = logging.getLogger(label)
        logger.propagate = False
        logger.setLevel(logging.INFO)
        try:
            if not logger.handlers:
                handler = RotatingFileHandler(ROOT / (label + '.log'), maxBytes=4194304, backupCount=1)
                handler.setFormatter(logging.Formatter('%(message)s'))
                logger.addHandler(handler)
        except Exception:
            logger = None
        child = subprocess.Popen([NODE, RUNNER, *arguments], cwd=HARNESS,
                                 env=provider_environment(provider, self.token),
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        try:
            # Every post-spawn operation is protected by termination/reaping.
            self.event(label, 'child-started', pid=child.pid, cleanup=cleanup)
            # Keep draining even if optional log storage fails, so a full pipe
            # cannot deadlock the child or interfere with its cleanup.
            def drain():
                while True:
                    try:
                        chunk = os.read(child.stdout.fileno(), 4096)
                    except (OSError, ValueError):
                        return
                    if not chunk:
                        return
                    if logger is not None:
                        try:
                            logger.info(chunk.decode('utf-8', errors='replace'))
                        except Exception:
                            pass
            pump = threading.Thread(target=drain, daemon=True)
            pump.start()
            operation_budget = 1200 if cleanup else RESUME_BUDGET if '--resume' in arguments else 7200
            wall_limit = time.time() + operation_budget if cleanup else min(self.deadline, time.time() + operation_budget)
            mono_limit = time.monotonic() + operation_budget if cleanup else min(self.monotonic_deadline, time.monotonic() + operation_budget)
            term_at = None
            next_gate = 0
            next_diagnostics = 0
            while child.poll() is None:
                now = time.monotonic()
                if not cleanup and now >= next_gate:
                    self.transfer_gate(label)
                    next_gate = now + 5
                if now >= next_diagnostics:
                    self.schedule_diagnostics()
                    next_diagnostics = now + 60
                expired = time.time() >= wall_limit or now >= mono_limit
                if term_at is None and (expired or (STOP.is_set() and not cleanup)):
                    term_at = now
                    self.event(label, 'child-term-requested', pid=child.pid,
                               reason='operation-deadline' if expired else 'supervisor-stop',
                               stopReason=STOP_REASON, wallLimit=wall_limit, monotonicLimit=mono_limit)
                    try:
                        os.killpg(child.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                elif term_at is not None and now - term_at >= 900:
                    self.event(label, 'child-kill-requested', pid=child.pid)
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                time.sleep(1)
            pump.join(timeout=5)
            self.event(label, 'child-exited', pid=child.pid, exitCode=child.returncode,
                       terminatedBySupervisor=term_at is not None)
            return 124 if term_at is not None else child.returncode
        except BaseException:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=900)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait(timeout=30)
            raise
        finally:
            child.stdout.close()

    def run_one(self, label):
        provider = label.split('-')[-1]
        run_dir = safe_relative_run(label)
        if label in self.state['runs']:
            previous = self.state['runs'][label]
            if not (cleanup_settled(previous) and previous.get('proofExported')):
                return self.settle(label, dict(previous))
            return previous
        outcome = {'provider': provider, 'label': label, 'status': 'failed'}
        try:
            if STOP.is_set() or time.time() >= self.deadline:
                raise RuntimeError('campaign-deadline')
            if not run_dir.exists():
                if label.startswith('soak-') and time.time() + self.soak_hours * 3600 + FINAL_OBSERVATION_MARGIN > self.deadline:
                    raise CampaignTimeRefused('insufficient-campaign-time-for-full-soak-and-final-teardown')
                placement = ['--region', 'us-east-2'] if provider == 'aws' else ['--location', 'fsn1']
                code = self.invoke(label, ['--provider', provider, *placement,
                    '--allow-ssh-from', self.config['controllerIpv4'] + '/32',
                    '--soak-hours', '0.25' if label.startswith('rehearsal-') else str(self.soak_hours),
                    '--artifact-dir', CANDIDATE, '--expected-commit', self.config['sourceCommit'],
                    '--output-dir', str(run_dir), '--step'])
            else:
                # Never create a replacement when a response or process was lost.
                progress = read_json(run_dir / 'soak-progress.json') if (run_dir / 'soak-progress.json').exists() else {}
                if not progress or (run_dir / 'failure.json').exists():
                    raise RuntimeError('incomplete-setup-or-failed-proof')
                code = 0
            while True:
                report = read_json(run_dir / 'report.json')
                if code != 0 or report.get('status') != 'running':
                    break
                checkpoint = read_json(run_dir / 'soak.json')
                if checkpoint['endAt'] / 1000 + FINAL_OBSERVATION_MARGIN > self.deadline:
                    raise CampaignTimeRefused('full-soak-end-leaves-no-final-teardown-budget')
                self.export_observation(label)
                self.wait_for_tick(label)
                # A fresh packaged controller per observation; schedule remains
                # anchored to the runner's immutable first-apply deadline.
                code = self.invoke(label, ['--resume', str(run_dir), '--step'])
            progress = read_json(run_dir / 'soak-progress.json') if (run_dir / 'soak-progress.json').exists() else {}
            outcome.update(observerExitCode=code, complete=progress.get('complete', False),
                           completedRuns=progress.get('completedRuns', 0),
                           observations=progress.get('observations', 0), endAt=progress.get('endAt'))
            if code == 0 and report.get('status') == 'passed' and outcome['complete']:
                outcome['status'] = 'passed'
        except Exception as error:
            outcome['failureType'] = type(error).__name__
            if isinstance(error, CampaignTimeRefused):
                # A fixed reason, never a raw exception string.
                outcome['failureReason'] = str(error)
                self.event(label, 'campaign-time-refused', reason=str(error), deadline=self.deadline)
        finally:
            outcome = self.settle(label, outcome)
        return outcome

    def settle(self, label, outcome):
        """Only cleanup/export on restart; never resume or recreate failed work."""
        run_dir = safe_relative_run(label)
        while outcome.get('settlementAttempts', 0) < 3:
            if self.config['stopAt'] - time.time() < 2400:
                outcome['settlementDeferred'] = 'external-stop-close-preserve-authority'
                break
            outcome['settlementAttempts'] = outcome.get('settlementAttempts', 0) + 1
            outcome['proofExported'] = False
            with self.lock:
                self.state['runs'][label] = dict(outcome)
                self.save()
            try:
                if (run_dir / 'run.json').exists():
                    if not cleanup_verified(run_dir) and not never_created(run_dir):
                        outcome['cleanupExitCode'] = self.invoke(label, ['--cleanup', str(run_dir)], cleanup=True)
                    outcome['cleanupVerifiedAbsent'] = cleanup_verified(run_dir)
                    outcome['neverCreated'] = never_created(run_dir)
                    self.export_run(label, recovery=not cleanup_settled(outcome))
                    outcome['proofExported'] = True
                if cleanup_settled(outcome) and outcome.get('proofExported'):
                    break
            except Exception as error:
                outcome['exportOrCleanupFailureType'] = type(error).__name__
            time.sleep(5)
        if not (cleanup_settled(outcome) and outcome.get('proofExported')):
            outcome['status'] = 'failed'
        with self.lock:
            self.state['runs'][label] = dict(outcome)
            self.save()
            self.evidence.put_file('supervisor.json', self.state_path)
        return outcome

    def run(self):
        # Native rehearsal builds and short runs are sequential on the 4GiB host.
        for provider in ('aws', 'hetzner'):
            result = self.run_one('rehearsal-' + provider)
            if result['status'] != 'passed':
                return self.finish()
        # Offset the two native builds until AWS has its first observation.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.run_one, 'soak-aws')
            until = time.monotonic() + 3600
            while not first.done() and not (safe_relative_run('soak-aws') / 'soak-progress.json').exists():
                if STOP.is_set() or time.monotonic() >= until:
                    request_stop('full-build-start-deadline')
                    break
                time.sleep(2)
            if not STOP.is_set() and (not first.done() or first.result()['status'] == 'passed'):
                second = pool.submit(self.run_one, 'soak-hetzner')
                second.result()
            first.result()
        return self.finish()

    def finish(self):
        required = {'rehearsal-aws', 'rehearsal-hetzner', 'soak-aws', 'soak-hetzner'}
        passed = set(self.state['runs']) == required and all(
            x.get('status') == 'passed' and x.get('complete') and x.get('cleanupVerifiedAbsent')
            and x.get('proofExported') for x in self.state['runs'].values())
        self.state.update(status='passed' if passed else 'failed', finishedAt=time.time())
        self.state['stopReason'] = STOP_REASON
        self.save()
        self.schedule_diagnostics()
        self.evidence.put_file('supervisor.json', self.state_path)
        # A completed failure is terminal evidence, not a reason for systemd to
        # restart an already failed proof. Its JSON status remains failed.
        return 0

    def repair_cleanup(self, label):
        """One explicit operator cleanup after automatic attempts are exhausted.

        Preserves failed proof and its automatic-attempt counter. This command
        is never invoked by the unattended systemd service.
        """
        run_dir = safe_relative_run(label)
        outcome = dict(self.state['runs'][label])
        if outcome.get('status') != 'failed' or self.state.get('status') != 'failed':
            raise RuntimeError('repair-requires-terminal-failed-proof')
        if outcome.get('manualCleanupAttempts', 0) >= 32:
            raise RuntimeError('manual-cleanup-report-limit')
        outcome['manualCleanupAttempts'] = outcome.get('manualCleanupAttempts', 0) + 1
        outcome['proofExported'] = False
        self.state['runs'][label] = dict(outcome)
        self.save()
        if not cleanup_verified(run_dir) and not never_created(run_dir):
            outcome['manualCleanupExitCode'] = self.invoke(label, ['--cleanup', str(run_dir)], cleanup=True)
        outcome['cleanupVerifiedAbsent'] = cleanup_verified(run_dir)
        outcome['neverCreated'] = never_created(run_dir)
        self.export_run(label, recovery=not cleanup_settled(outcome))
        outcome['proofExported'] = True
        outcome['status'] = 'failed'
        self.state['runs'][label] = outcome
        self.state['status'] = 'failed'
        self.state['cleanupReconciledAt'] = time.time()
        self.save()
        self.evidence.put_file('supervisor.json', self.state_path)
        return 0 if cleanup_settled(outcome) else 1


def main():
    import argparse
    import boto3
    from botocore.config import Config
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--repair-cleanup', choices=[
        'rehearsal-aws', 'rehearsal-hetzner', 'soak-aws', 'soak-hetzner'])
    options = parser.parse_args()
    ROOT.mkdir(mode=0o700, exist_ok=True)
    lock = open(ROOT / 'supervisor.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    config = read_json(Path('/etc/wharfie-soak/campaign.json'))
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, lambda signum, _frame: request_stop('signal', signum))
    sdk_config = Config(connect_timeout=10, read_timeout=30, retries={'max_attempts': 2})
    ssm = boto3.client('ssm', region_name=config['region'], config=sdk_config)
    # No token in userdata, command payload, environment file, logs, or receipts.
    token = ssm.get_parameter(Name=config['tokenParameter'], WithDecryption=True)['Parameter']['Value']
    if not isinstance(token, str) or not 20 <= len(token) <= 4096 or '\n' in token:
        raise RuntimeError('invalid-token-format')
    client = boto3.client('s3', region_name=config['region'], config=sdk_config)
    campaign = Campaign(config, Evidence(config, client), token)
    if options.repair_cleanup:
        return campaign.repair_cleanup(options.repair_cleanup)
    return campaign.run()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        # SDK exception strings may contain sensitive request/response payloads.
        print('Campaign supervisor stopped: ' + type(error).__name__, flush=True)
        raise SystemExit(1)
