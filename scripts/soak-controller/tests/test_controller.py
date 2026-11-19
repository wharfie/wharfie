import base64
import copy
from datetime import datetime, timezone
import lzma
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ops
import policy
import supervisor
import template


def config():
    return {
        'format': 'wharfie.soak.campaign.v1', 'campaignId': 'wharfie-soak-test-01234567',
        'region': 'us-east-2', 'accountId': '123456789012',
        'imageId': 'ami-0123456789abcdef0', 'snapshotId': 'snap-0123456789abcdef0',
        'vpcId': 'vpc-0123456789abcdef0', 'subnetId': 'subnet-0123456789abcdef0',
        'guestSubnetIds': ['subnet-0123456789abcdef0'], 'guestRootGiB': 8,
        'controllerCommit': '1' * 40, 'sourceCommit': '2' * 40, 'version': '0.0.16',
        'soakHours': 72, 'createdAt': 2000000000, 'stopAt': 2000000000 + 78 * 3600,
        'bucket': 'wharfie-soak-test-01234567-123456789012',
        'tokenParameter': '/wharfie-soak/wharfie-soak-test-01234567/hetzner-token',
        'specSha256': 'a' * 64, 'controllerIpv4': '198.51.100.15',
        'assets': {name: {'size': 175639744 if name.endswith('x64') else 1612702,
                          'sha256': hashlib.sha256(name.encode()).hexdigest()} for name in ops.asset_names('0.0.16')},
        'operationsFiles': {name: ops.sha256(ops.HERE / name) for name in [
            *template.RUNTIME_FILES, 'wharfie-soak.service', 'policy.py', 'template.py', 'ops.py']},
    }


def fake_gate(c):
    identity = 'wsnd1_' + 'A' * 43
    run_id = 'a7dc5d08-44bf-4e60-8e06-321e76a97fde'
    run = {
        'runId': run_id, 'deploymentInstanceId': identity, 'provider': 'aws',
        'placement': 'us-east-2', 'deploymentId': 'acceptance-' + run_id,
        'appId': 'steady-file-demo', 'applyAttempted': True,
        'allowedIpv4': c['controllerIpv4'] + '/32',
        'soak': {'startedAt': None, 'durationMs': 900000},
    }
    preview = {
        'provider': 'aws', 'status': 'actionable', 'journal': {'state': 'absent'},
        'deployment': {'deploymentInstanceId': identity, 'deploymentId': run['deploymentId'],
                       'access': {'allowedIpv4': [run['allowedIpv4']]}},
        'providerSpec': {
            'scope': {'accountId': c['accountId'], 'partition': 'aws', 'region': 'us-east-2'},
            'machineType': 't3.small',
            'image': {'id': c['imageId'], 'ownerAccountId': '099720109477', 'rootBlockDevice': {
                'snapshotId': c['snapshotId'], 'encrypted': True, 'volumeType': 'gp3', 'sizeGiB': 8}},
            'network': {'vpcId': c['vpcId'], 'subnet': {'id': c['subnetId']}},
        },
    }
    return {
        'format': 'wharfie.soak.apply-gate.v1', 'campaignId': c['campaignId'],
        'controllerCommit': '1' * 40, 'sourceCommit': '2' * 40, 'version': '0.0.16',
        'runId': run_id, 'deploymentInstanceId': identity,
        'runDir': '/var/lib/wharfie-soak/runs/rehearsal-aws',
        'requestedAt': time.time() * 1000, 'runSha256': 'c' * 64, 'previewSha256': 'd' * 64,
        'run': run, 'preview': preview,
    }


class PolicyTests(unittest.TestCase):
    def test_initial_cfn_policy_really_has_no_guest_writes(self):
        value = template.render(config())
        policies = value['Resources']['ControllerRole']['Properties']['Policies']
        guest = next(x for x in policies if x['PolicyName'] == 'ExactGuestDeployment')
        condition, authorized, initial = guest['PolicyDocument']['Fn::If']
        self.assertEqual(condition, 'GuestAuthorized')
        actions = {x for s in initial['Statement'] for x in s['Action']}
        self.assertTrue(all(x.startswith('ec2:Describe') or x == 'sts:GetCallerIdentity' for x in actions))
        self.assertIn('ec2:RunInstances', {x for s in authorized['Statement'] for x in s['Action']})

    def test_no_guest_approval_write_or_iam_or_broad_parameter_read(self):
        c = config()
        value = policy.infrastructure_policy(c)
        actions = {x for statement in value['Statement'] for x in statement['Action']}
        self.assertFalse(any(x.startswith('iam:') for x in actions))
        self.assertNotIn('ssm:GetParameters', actions)
        reads = [s for s in value['Statement'] if 'ssm:GetParameter' in s['Action']]
        self.assertEqual(len(reads), 1)
        self.assertTrue(reads[0]['Resource'].endswith(c['tokenParameter']))
        put = next(s for s in value['Statement'] if 's3:PutObject' in s['Action'])
        self.assertFalse(any('approved' in x or x.endswith(c['campaignId'] + '/*') for x in put['Resource']))
        lists = next(s for s in value['Statement'] if 's3:ListBucket' in s['Action'])
        self.assertEqual(lists['Condition']['StringEquals']['s3:prefix'], [
            c['campaignId'] + '/gates/rehearsal-aws/approved.json',
            c['campaignId'] + '/gates/soak-aws/approved.json'])

    def test_multi_resource_launch_and_pinned_disk(self):
        c = config()
        statements = {s['Sid']: s for s in policy.guest_policy(c, ['wsnd1_' + 'A' * 43])['Statement']}
        inputs = statements['ExistingLaunchInputs']
        self.assertNotIn('Condition', inputs)
        self.assertIn('arn:aws:ec2:us-east-2::snapshot/' + c['snapshotId'], inputs['Resource'])
        self.assertEqual(statements['TaggedGuestVolume']['Condition']['NumericEquals']['ec2:VolumeSize'], 8)
        self.assertEqual(statements['TaggedGuestInstance']['Condition']['StringEquals']['ec2:InstanceType'], 't3.small')

    def test_template_deadman_and_bootstrap_pins(self):
        c = config()
        value = template.render(c)
        resources = value['Resources']
        deadline = resources['Deadline']['Properties']
        self.assertEqual(deadline['Target']['Arn'], 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances')
        self.assertEqual(json.loads(deadline['Target']['Input']['Fn::Sub']), {'InstanceIds': ['${Controller}'], 'Force': True})
        actions = resources['DeadlineRole']['Properties']['Policies'][0]['PolicyDocument']['Statement'][0]['Action']
        self.assertEqual(actions, ['ec2:StopInstances'])
        user_data = resources['Controller']['Properties']['UserData']['Fn::Base64']['Fn::Sub']
        self.assertLessEqual(len(user_data.encode()), 16384)
        bundle = json.loads(lzma.decompress(template.runtime_bundle(c)))
        self.assertIn('controller_commit', bundle['bootstrap.sh'])
        self.assertIn(hashlib.sha256(template.runtime_bundle(c)).hexdigest(), user_data)
        self.assertIn('timeout 900 python3', bundle['bootstrap.sh'])
        self.assertNotIn('systemctl enable wharfie-soak.service', bundle['bootstrap.sh'])
        self.assertNotIn('systemctl start wharfie-soak.service', bundle['bootstrap.sh'])
        self.assertEqual(set(json.loads(bundle['campaign.json'])['assets']), ops.asset_names('0.0.16'))
        self.assertNotIn('HETZNER_TOKEN=', user_data)
        self.assertEqual(resources['ControllerSecurityGroup']['Properties'].get('SecurityGroupIngress', []), [])

    def test_native_build_memory_headroom_preserves_credit_and_stop_bounds(self):
        c = config()
        resources = template.render(c)['Resources']
        controller = resources['Controller']['Properties']
        self.assertEqual(controller['InstanceType'], 't3.large')
        self.assertEqual(controller['CreditSpecification'], {'CPUCredits': 'standard'})
        service = (Path(template.__file__).parent / 'wharfie-soak.service').read_text()
        self.assertEqual([line for line in service.splitlines() if line.startswith('MemoryMax=')],
                         ['MemoryMax=7000M'])
        stop_at = datetime.fromtimestamp(c['createdAt'] + 78 * 3600, timezone.utc)
        self.assertEqual(resources['Deadline']['Properties']['ScheduleExpression'],
                         'at(' + stop_at.strftime('%Y-%m-%dT%H:%M:%S') + ')')


class GateTests(unittest.TestCase):
    def setUp(self):
        self.operator = object.__new__(ops.Operator)
        self.operator.config = config()
        self.operator.ownership = {'outputs': {'ControllerIpv4': config()['controllerIpv4']}}

    def test_accepts_exact_pinned_gate(self):
        self.operator.validate_gate(fake_gate(config()), 'rehearsal-aws')

    def test_rejects_changed_authority(self):
        mutations = [
            lambda x: x.update(sourceCommit='e' * 40),
            lambda x: x.update(runId='not-a-uuid'),
            lambda x: x.update(requestedAt=(time.time() - 1801) * 1000),
            lambda x: x['preview']['providerSpec']['scope'].update(accountId='999999999999'),
            lambda x: x['preview']['providerSpec']['network'].update(vpcId='vpc-foreign'),
            lambda x: x['preview']['providerSpec']['image']['rootBlockDevice'].update(sizeGiB=100),
            lambda x: x['preview']['deployment']['access'].update(allowedIpv4=['0.0.0.0/0']),
            lambda x: x['run']['soak'].update(startedAt=time.time()),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                gate = fake_gate(config())
                mutate(gate)
                with self.assertRaises((AssertionError, KeyError)):
                    self.operator.validate_gate(gate, 'rehearsal-aws')

    def test_missing_approval_is_exact_prefix_list_not_ambiguous_403(self):
        client = mock.Mock()
        client.list_objects_v2.return_value = {'Contents': [], 'IsTruncated': False}
        evidence = supervisor.Evidence(config(), client)
        self.assertIsNone(evidence.get_optional('gates/rehearsal-aws/approved.json'))
        client.get_object.assert_not_called()
        self.assertEqual(client.list_objects_v2.call_args.kwargs['MaxKeys'], 2)
        self.assertEqual(client.list_objects_v2.call_args.kwargs['Prefix'],
                         config()['campaignId'] + '/gates/rehearsal-aws/approved.json')
        client.list_objects_v2.side_effect = RuntimeError('access-denied')
        with self.assertRaises(RuntimeError):
            evidence.get_optional('gates/rehearsal-aws/approved.json')

    def test_watcher_restart_accepts_old_matching_approval_without_writes(self):
        gate = fake_gate(config())
        gate['requestedAt'] = (time.time() - 3600) * 1000
        self.operator.ownership['outputs']['RoleName'] = 'campaign-controller'
        approval = {key: gate[key] for key in (
            'campaignId', 'runId', 'runSha256', 'previewSha256', 'deploymentInstanceId')}
        approval.update(controllerRole='campaign-controller', policyDeploymentIds=[gate['deploymentInstanceId']])
        self.operator.remote_json = mock.Mock(return_value=approval)
        self.operator.stack = mock.Mock(return_value={'Parameters': [
            {'ParameterKey': 'GuestDeploymentIds', 'ParameterValue': gate['deploymentInstanceId']}]})
        self.operator.aws = mock.Mock(side_effect=AssertionError('must not mutate retained approval'))
        self.operator.approve(gate, 'rehearsal-aws')
        self.operator.aws.assert_not_called()
        self.operator.remote_json.return_value = None
        with self.assertRaises(AssertionError):
            self.operator.approve(gate, 'rehearsal-aws')


class OperatorLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.operator = object.__new__(ops.Operator)
        self.operator.root = Path(self.temp.name)
        self.operator.config = config()
        self.operator.ownership = {'stackId': 'arn:aws:cloudformation:exact', 'outputs': {'ControllerId': 'i-exact'},
                                   'controllerVolumeIds': ['vol-exact']}
        self.operator.save = mock.Mock()

    def test_remote_json_download_is_bounded_before_read(self):
        def aws(service, action, value, **kwargs):
            self.assertEqual(value['Range'], 'bytes=0-262144')
            Path(kwargs['extra'][0]).write_bytes(b' ' * (supervisor.MAX_JSON + 1))
            return {'ContentLength': supervisor.MAX_JSON + 1}
        self.operator.aws = aws
        with self.assertRaises(RuntimeError):
            self.operator.remote_json('supervisor.json')
        self.assertFalse((self.operator.root / 'download.tmp.json').exists())

    def test_resumes_after_controller_deletion_and_token_already_absent(self):
        self.operator.stack = mock.Mock(return_value={'StackStatus': 'DELETE_COMPLETE'})
        calls = []
        def aws(service, action, value, **kwargs):
            calls.append((service, action, value))
            responses = {
                'describe-instances': {'Reservations': []}, 'describe-addresses': {'Addresses': []},
                'describe-security-groups': {'SecurityGroups': []}, 'describe-volumes': {'Volumes': []},
                'get-parameters': {'Parameters': [], 'InvalidParameters': [config()['tokenParameter']]},
            }
            if service in ('iam', 'scheduler'):
                raise ops.AwsError(service, action, 254, 'NoSuchEntity' if service == 'iam' else 'ResourceNotFoundException')
            return responses[action]
        self.operator.ownership['bucketCreated'] = False
        self.operator.aws = aws
        with mock.patch('sys.stdout', new=io.StringIO()):
            self.operator.delete_controller()
        actions = [action for _, action, _ in calls]
        self.assertNotIn('delete-stack', actions)
        self.assertNotIn('delete-parameter', actions)
        self.assertIn('describe-volumes', actions)
        self.assertEqual(self.operator.ownership['status'], 'controller-cleaned-proofs-retained')

    def test_refuses_abort_after_guest_authorization(self):
        self.operator.identity = mock.Mock()
        self.operator.stack = mock.Mock(return_value={'Parameters': [
            {'ParameterKey': 'GuestDeploymentIds', 'ParameterValue': 'wsnd1_' + 'A' * 43}]})
        self.operator.delete_controller = mock.Mock()
        with self.assertRaises(RuntimeError):
            self.operator.abort_setup()
        self.operator.delete_controller.assert_not_called()

    def test_purge_refuses_foreign_bucket_keys(self):
        self.operator.identity = mock.Mock()
        self.operator.ownership.update(status='controller-cleaned-proofs-retained', abortBeforeGuestAuthorization=True)
        def aws(service, action, value, **kwargs):
            if action == 'get-bucket-tagging':
                return {'TagSet': [{'Key': 'wharfie:soak-campaign', 'Value': config()['campaignId']},
                                   {'Key': 'wharfie:soak-spec', 'Value': config()['specSha256']}]}
            if action == 'list-objects-v2':
                return {'Contents': [{'Key': 'foreign-prefix/data'}], 'IsTruncated': False}
            self.fail('unexpected mutation: ' + action)
        self.operator.aws = aws
        with self.assertRaises(RuntimeError):
            self.operator.purge_proofs()

    def test_abort_before_bucket_creation_finishes_only_on_independent_404(self):
        self.operator.identity = mock.Mock()
        self.operator.ownership.update(status='controller-cleaned-proofs-retained',
                                       abortBeforeGuestAuthorization=True, bucketCreated=False)
        self.operator.bucket_absent = mock.Mock(return_value=True)
        self.operator.aws = mock.Mock(side_effect=AssertionError('no bucket mutation is needed'))
        with mock.patch('sys.stdout', new=io.StringIO()):
            self.operator.purge_proofs()
        self.assertEqual(self.operator.ownership['status'], 'all-campaign-resources-cleaned')
        self.operator.aws.assert_not_called()


if __name__ == '__main__':
    unittest.main()
