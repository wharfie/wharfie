"""Render one exact CloudFormation-owned campaign. Pure, no cloud mutations."""
import base64
import hashlib
import lzma
import json
from datetime import datetime, timezone
from pathlib import Path
from policy import document, allow, infrastructure_policy, guest_policy

RUNTIME_FILES = ('supervisor.py', 'gate.mjs', 'gate_probe.py', 'download_candidate.py', 'bootstrap.sh', 'check_bootstrap.py')


def runtime_bundle(config, root=None, contents=None):
    """`contents` holds the operations bytes `prepare` froze; otherwise read `root`."""
    root = root or Path(__file__).resolve().parent
    frozen = contents
    def text(name):
        return frozen[name].decode() if frozen is not None else (root / name).read_text()
    contents = {name: text(name) for name in RUNTIME_FILES}
    # Local source-file hashes validate the operator bundle before launch. They
    # are not runtime inputs; omitting that duplicate high-entropy map keeps the
    # EC2 userdata below its hard16KiB limit without changing executable bytes.
    contents['campaign.json'] = json.dumps({key: value for key, value in config.items()
                                         if key != 'operationsFiles'}, sort_keys=True)
    contents['wharfie-soak.service'] = text('wharfie-soak.service')
    return lzma.compress(json.dumps(contents, sort_keys=True).encode(), preset=9)


def render(config, root=None, contents=None):
    bundle = runtime_bundle(config, root, contents)
    expected = {'bucket': config['bucket'], 'key': config['campaignId'] + '/inputs/operations.json.xz',
                'size': len(bundle), 'sha256': hashlib.sha256(bundle).hexdigest()}
    userdata = '''#!/bin/bash
set -euo pipefail
umask 077
export DEBIAN_FRONTEND=noninteractive
for attempt in $(seq 1 60); do
  if timeout 10 curl --proto '=https' --tlsv1.2 -fsS --connect-timeout 5 --max-time 8 https://nodejs.org/dist/v24.13.1/SHASUMS256.txt >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then exit 1; fi
  sleep 5
done
# apt-drain: begin
# Suppress new apt timer runs at once, then wait, boundedly, for one already
# running; its dpkg is never killed. Bootstrap masks the units later.
systemctl stop apt-daily.timer apt-daily-upgrade.timer
for attempt in $(seq 1 150); do
  # Both must report idle; a oneshot upgrade is "activating" while it runs.
  states=$(systemctl show -p ActiveState --value apt-daily.service apt-daily-upgrade.service) || states=unknown
  idle=0
  for state in $states; do case $state in inactive|failed) idle=$((idle + 1)) ;; esac; done
  if [ "$idle" = 2 ]; then break; fi
  if [ "$attempt" = 150 ]; then exit 1; fi
  sleep 10
done
# apt-drain: end
timeout 900 apt-get -o DPkg::Lock::Timeout=600 update -q
timeout 1500 apt-get -o DPkg::Lock::Timeout=600 install -y --no-install-recommends python3-boto3
timeout 1800 python3 - <<'WHARFIE_BUNDLE'
import hashlib, lzma, json, pathlib, time
import boto3
from botocore.config import Config
expected = ''' + repr(expected) + '''
client = boto3.client('s3', region_name='us-east-2', config=Config(connect_timeout=10, read_timeout=30, retries={'max_attempts': 2}))
deadline = time.monotonic() + 1500
while True:
    try:
        response = client.get_object(Bucket=expected['bucket'], Key=expected['key'])
        try:
            data = response['Body'].read(expected['size'] + 1)
        finally:
            response['Body'].close()
        break
    except Exception:
        if time.monotonic() >= deadline:
            raise RuntimeError('frozen-operations-input-unavailable') from None
        time.sleep(5)
assert len(data) == expected['size'] and hashlib.sha256(data).hexdigest() == expected['sha256']
files = json.loads(lzma.decompress(data))
root = pathlib.Path('/opt/wharfie-soak/ops')
root.mkdir(parents=True, exist_ok=True)
root.parent.chmod(0o755)
root.chmod(0o755)
for name, data in files.items():
    if name == 'campaign.json':
        config = json.loads(data)
        config['controllerIpv4'] = '${ControllerAddress}'
        path = pathlib.Path('/etc/wharfie-soak/campaign.json')
        path.parent.mkdir(mode=0o755, exist_ok=True)
        path.parent.chmod(0o755)
        data = json.dumps(config, sort_keys=True)
    elif name == 'wharfie-soak.service':
        path = pathlib.Path('/etc/systemd/system/wharfie-soak.service')
    else:
        path = root / name
    path.write_text(data)
    path.chmod(0o644)
WHARFIE_BUNDLE
timeout 3600 bash /opt/wharfie-soak/ops/bootstrap.sh
'''
    if len(userdata.encode()) > 16384:
        raise ValueError('EC2 userdata exceeds 16KiB decoded limit')
    campaign = config['campaignId']
    tags = [{'Key': 'wharfie:soak-campaign', 'Value': campaign},
            {'Key': 'wharfie:soak-spec', 'Value': config['specSha256']},
            {'Key': 'Name', 'Value': campaign + '-controller'}]
    stop_at = datetime.fromtimestamp(config['stopAt'], timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')
    resources = {
        'ProofBucket': {
            'Type': 'AWS::S3::Bucket', 'DeletionPolicy': 'Retain', 'UpdateReplacePolicy': 'Retain',
            'Properties': {'BucketName': config['bucket'],
                'BucketEncryption': {'ServerSideEncryptionConfiguration': [
                    {'ServerSideEncryptionByDefault': {'SSEAlgorithm': 'AES256'}}]},
                'OwnershipControls': {'Rules': [{'ObjectOwnership': 'BucketOwnerEnforced'}]},
                'PublicAccessBlockConfiguration': {x: True for x in [
                    'BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls', 'RestrictPublicBuckets']},
                'LifecycleConfiguration': {'Rules': [{
                    'Id': 'AbortIncompleteMultipart', 'Status': 'Enabled',
                    'AbortIncompleteMultipartUpload': {'DaysAfterInitiation': 1}}]},
                'Tags': tags}},
        'ProofBucketPolicy': {'Type': 'AWS::S3::BucketPolicy', 'Properties': {
            'Bucket': {'Ref': 'ProofBucket'}, 'PolicyDocument': document([{
                'Sid': 'TLSOnly', 'Effect': 'Deny', 'Principal': '*', 'Action': 's3:*',
                'Resource': ['arn:aws:s3:::' + config['bucket'], 'arn:aws:s3:::' + config['bucket'] + '/*'],
                'Condition': {'Bool': {'aws:SecureTransport': 'false'}}}])}},
        'ControllerRole': {'Type': 'AWS::IAM::Role', 'Properties': {
            'RoleName': campaign + '-controller', 'Tags': tags,
            'AssumeRolePolicyDocument': document([{
                'Effect': 'Allow', 'Principal': {'Service': 'ec2.amazonaws.com'}, 'Action': 'sts:AssumeRole'}]),
            'Policies': [
                {'PolicyName': 'CampaignInfrastructure', 'PolicyDocument': infrastructure_policy(config)},
                {'PolicyName': 'ExactGuestDeployment', 'PolicyDocument': {'Fn::If': [
                    'GuestAuthorized', guest_policy(config,
                        {'Fn::Split': [',', {'Ref': 'GuestDeploymentIds'}]}),
                    document(guest_policy(config, [])['Statement'][:2])]}},
            ]}},
        'ControllerProfile': {'Type': 'AWS::IAM::InstanceProfile', 'Properties': {
            'InstanceProfileName': campaign + '-controller', 'Roles': [{'Ref': 'ControllerRole'}]}},
        'ControllerSecurityGroup': {'Type': 'AWS::EC2::SecurityGroup', 'Properties': {
            'GroupDescription': 'Wharfie soak controller: SSM only, no inbound network access',
            'VpcId': config['vpcId'], 'Tags': tags,
            'SecurityGroupEgress': [{'IpProtocol': '-1', 'CidrIp': '0.0.0.0/0'}]}},
        'ControllerAddress': {'Type': 'AWS::EC2::EIP', 'Properties': {'Domain': 'vpc', 'Tags': tags}},
        'Controller': {'Type': 'AWS::EC2::Instance', 'DependsOn': ['ProofBucket'], 'Properties': {
            'ImageId': config['imageId'], 'InstanceType': 't3.large', 'Tags': tags,
            'IamInstanceProfile': {'Ref': 'ControllerProfile'},
            'CreditSpecification': {'CPUCredits': 'standard'},
            'InstanceInitiatedShutdownBehavior': 'stop',
            'MetadataOptions': {'HttpEndpoint': 'enabled', 'HttpTokens': 'required',
                                'HttpPutResponseHopLimit': 1},
            'BlockDeviceMappings': [{'DeviceName': '/dev/sda1', 'Ebs': {
                'VolumeSize': 40, 'VolumeType': 'gp3', 'Encrypted': True, 'DeleteOnTermination': True}}],
            'NetworkInterfaces': [{'DeviceIndex': '0', 'AssociatePublicIpAddress': False,
                'DeleteOnTermination': True, 'SubnetId': config['subnetId'],
                'GroupSet': [{'Ref': 'ControllerSecurityGroup'}]}],
            'UserData': {'Fn::Base64': {'Fn::Sub': userdata}}}},
        'ControllerAddressAssociation': {'Type': 'AWS::EC2::EIPAssociation', 'Properties': {
            'InstanceId': {'Ref': 'Controller'},
            'AllocationId': {'Fn::GetAtt': ['ControllerAddress', 'AllocationId']}}},
        'DeadlineGroup': {'Type': 'AWS::Scheduler::ScheduleGroup', 'Properties': {'Name': campaign, 'Tags': tags}},
        'DeadlineRole': {'Type': 'AWS::IAM::Role', 'Properties': {
            'RoleName': campaign + '-deadman', 'Tags': tags,
            'AssumeRolePolicyDocument': document([{
                'Effect': 'Allow', 'Principal': {'Service': 'scheduler.amazonaws.com'},
                'Action': 'sts:AssumeRole', 'Condition': {'StringEquals': {
                    'aws:SourceAccount': config['accountId']}, 'ArnEquals': {
                    'aws:SourceArn': f"arn:aws:scheduler:{config['region']}:{config['accountId']}:schedule-group/{campaign}"}}}]),
            'Policies': [{'PolicyName': 'StopExactController', 'PolicyDocument': document([
                allow('StopExactControllerPreservingDisk', ['ec2:StopInstances'],
                      {'Fn::Sub': f"arn:aws:ec2:{config['region']}:{config['accountId']}:instance/${{Controller}}"})])}]}},
        'Deadline': {'Type': 'AWS::Scheduler::Schedule', 'Properties': {
            'Name': campaign + '-stop', 'GroupName': {'Ref': 'DeadlineGroup'},
            'ScheduleExpression': 'at(' + stop_at + ')', 'ScheduleExpressionTimezone': 'UTC',
            'FlexibleTimeWindow': {'Mode': 'OFF'}, 'State': 'ENABLED',
            'Target': {'Arn': 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances',
                'RoleArn': {'Fn::GetAtt': ['DeadlineRole', 'Arn']},
                'Input': {'Fn::Sub': '{"InstanceIds":["${Controller}"],"Force":true}'},
                'RetryPolicy': {'MaximumEventAgeInSeconds': 3600, 'MaximumRetryAttempts': 3}}}},
    }
    return {'AWSTemplateFormatVersion': '2010-09-09',
        'Description': 'Exact bounded Wharfie soak campaign ' + campaign,
        'Parameters': {'GuestDeploymentIds': {'Type': 'String', 'Default': 'UNAUTHORIZED',
            'AllowedPattern': r'UNAUTHORIZED|wsnd1_[A-Za-z0-9_-]{43}(,wsnd1_[A-Za-z0-9_-]{43})?'}},
        'Conditions': {'GuestAuthorized': {'Fn::Not': [{'Fn::Equals': [
            {'Ref': 'GuestDeploymentIds'}, 'UNAUTHORIZED']}] }},
        'Resources': resources,
        'Outputs': {
            'ControllerId': {'Value': {'Ref': 'Controller'}},
            'ControllerIpv4': {'Value': {'Ref': 'ControllerAddress'}},
            'AllocationId': {'Value': {'Fn::GetAtt': ['ControllerAddress', 'AllocationId']}},
            'SecurityGroupId': {'Value': {'Ref': 'ControllerSecurityGroup'}},
            'RoleName': {'Value': {'Ref': 'ControllerRole'}},
            'Bucket': {'Value': {'Ref': 'ProofBucket'}},
            'DeadlineName': {'Value': {'Ref': 'Deadline'}},
        }}
