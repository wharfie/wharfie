"""Render campaign-scoped policies; pure functions, no AWS calls."""

def document(statements):
    return {'Version': '2012-10-17', 'Statement': statements}


def allow(sid, actions, resources, condition=None):
    value = {'Sid': sid, 'Effect': 'Allow', 'Action': actions, 'Resource': resources}
    if condition:
        value['Condition'] = condition
    return value


def guest_policy(config, deployment_ids):
    region, account = config['region'], config['accountId']
    arn = f'arn:aws:ec2:{region}:{account}:'
    request_tags = {
        'aws:RequestTag/wharfie:managed-by': 'wharfie',
        'aws:RequestTag/wharfie:single-node-schema': '1',
        'aws:RequestTag/wharfie:deployment-instance-id': deployment_ids,
    }
    resource_tags = {
        'ec2:ResourceTag/wharfie:managed-by': 'wharfie',
        'ec2:ResourceTag/wharfie:single-node-schema': '1',
        'ec2:ResourceTag/wharfie:deployment-instance-id': deployment_ids,
    }
    reads = [
        'DescribeImages', 'DescribeInstanceAttribute',
        'DescribeInstanceCreditSpecifications', 'DescribeInstances',
        'DescribeInstanceTypeOfferings', 'DescribeInternetGateways',
        'DescribeNetworkAcls', 'DescribeRouteTables', 'DescribeSecurityGroups',
        'DescribeSubnets', 'DescribeVolumes', 'DescribeVpcs',
    ]
    return document([
        allow('Identity', ['sts:GetCallerIdentity'], '*'),
        allow('OhioReadOnlyPreflightAndAudit', ['ec2:' + x for x in reads], '*',
              {'StringEquals': {'aws:RequestedRegion': region}}),
        allow('ExistingLaunchInputs', ['ec2:RunInstances'], [
            f'arn:aws:ec2:{region}::image/' + config['imageId'],
            f'arn:aws:ec2:{region}::snapshot/' + config['snapshotId'],
            *[arn + 'subnet/' + s for s in config['guestSubnetIds']],
            arn + 'network-interface/*',
        ]),
        allow('OwnedLaunchSecurityGroup', ['ec2:RunInstances'], arn + 'security-group/*',
              {'StringEquals': resource_tags}),
        allow('TaggedGuestInstance', ['ec2:RunInstances'], arn + 'instance/*', {
            'StringEquals': {**request_tags, 'ec2:InstanceType': 't3.small',
                             'ec2:MetadataHttpTokens': 'required'},
            'NumericEquals': {'ec2:MetadataHttpPutResponseHopLimit': 1},
        }),
        allow('TaggedGuestVolume', ['ec2:RunInstances'], arn + 'volume/*', {
            'StringEquals': {**request_tags, 'ec2:VolumeType': 'gp3'},
            'Bool': {'ec2:Encrypted': 'true'},
            'NumericEquals': {'ec2:VolumeSize': config['guestRootGiB']},
        }),
        allow('DefaultVpcSecurityGroupParent', ['ec2:CreateSecurityGroup'],
              arn + 'vpc/' + config['vpcId']),
        allow('TaggedGuestSecurityGroup', ['ec2:CreateSecurityGroup'],
              arn + 'security-group/*', {'StringEquals': request_tags}),
        allow('TagsOnlyAtInstanceCreation', ['ec2:CreateTags'],
              [arn + 'instance/*', arn + 'volume/*'],
              {'StringEquals': {**request_tags, 'ec2:CreateAction': 'RunInstances'}}),
        allow('TagsOnlyAtSecurityGroupCreation', ['ec2:CreateTags'],
              arn + 'security-group/*',
              {'StringEquals': {**request_tags, 'ec2:CreateAction': 'CreateSecurityGroup'}}),
        allow('OwnedGuestIngressAndRemoval',
              ['ec2:AuthorizeSecurityGroupIngress', 'ec2:DeleteSecurityGroup'],
              arn + 'security-group/*', {'StringEquals': resource_tags}),
        allow('OwnedGuestInstanceRemoval', ['ec2:TerminateInstances'],
              arn + 'instance/*', {'StringEquals': resource_tags}),
        allow('OwnedGuestVolumeRemoval', ['ec2:DeleteVolume'],
              arn + 'volume/*', {'StringEquals': resource_tags}),
    ])


def infrastructure_policy(config):
    prefix = f"arn:aws:s3:::{config['bucket']}/{config['campaignId']}/"
    parameter = (f"arn:aws:ssm:{config['region']}:{config['accountId']}:"
                 f"parameter{config['tokenParameter']}")
    return document([
        allow('ExactHetznerCredential', ['ssm:GetParameter'], parameter),
        allow('EncryptedCampaignEvidence', ['s3:PutObject'], [
            prefix + 'runs/*', prefix + 'supervisor.json', prefix + 'supervisor-diagnostics.json',
            prefix + 'gates/rehearsal-aws/request.json',
            prefix + 'gates/soak-aws/request.json',
        ],
              {'StringEquals': {'s3:x-amz-server-side-encryption': 'AES256'}}),
        allow('VerifyCampaignEvidence', ['s3:GetObject'], prefix + '*'),
        allow('DiscoverOnlyExactGateApprovals', ['s3:ListBucket'],
              'arn:aws:s3:::' + config['bucket'], {'StringEquals': {'s3:prefix': [
                  config['campaignId'] + '/gates/rehearsal-aws/approved.json',
                  config['campaignId'] + '/gates/soak-aws/approved.json',
              ]}}),
        # Deliberately does not include the managed policy's broad GetParameter(s).
        allow('SystemsManagerAgent', [
            'ssm:DescribeAssociation', 'ssm:GetDeployablePatchSnapshotForInstance',
            'ssm:GetDocument', 'ssm:DescribeDocument', 'ssm:GetManifest',
            'ssm:ListAssociations', 'ssm:ListInstanceAssociations',
            'ssm:PutInventory', 'ssm:PutComplianceItems',
            'ssm:PutConfigurePackageResult', 'ssm:UpdateAssociationStatus',
            'ssm:UpdateInstanceAssociationStatus', 'ssm:UpdateInstanceInformation',
            'ssmmessages:CreateControlChannel', 'ssmmessages:CreateDataChannel',
            'ssmmessages:OpenControlChannel', 'ssmmessages:OpenDataChannel',
            'ec2messages:AcknowledgeMessage', 'ec2messages:DeleteMessage',
            'ec2messages:FailMessage', 'ec2messages:GetEndpoint',
            'ec2messages:GetMessages', 'ec2messages:SendReply',
        ], '*'),
    ])
