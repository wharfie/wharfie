"""Read-only EC2 authorization probe. No resource can be created: DryRun=True."""
import json
import re
import sys
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

if __name__ == '__main__':
    try:
        config = json.load(open('/etc/wharfie-soak/campaign.json'))
        deployment = sys.argv[1]
        assert re.fullmatch(r'wsnd1_[A-Za-z0-9_-]{43}', deployment)
        tags = {
            'wharfie:managed-by': 'wharfie', 'wharfie:single-node-schema': '1',
            'wharfie:deployment-instance-id': deployment,
        }
        client = boto3.client('ec2', region_name=config['region'], config=Config(
            connect_timeout=5, read_timeout=10, retries={'max_attempts': 1}))
        client.create_security_group(
            GroupName=config['campaignId'] + '-permission-probe',
            Description='Read-only acceptance permission probe', VpcId=config['vpcId'],
            TagSpecifications=[{'ResourceType': 'security-group', 'Tags': [
                {'Key': k, 'Value': v} for k, v in tags.items()]}], DryRun=True)
        sys.exit(2)
    except ClientError as error:
        sys.exit(0 if error.response['Error']['Code'] == 'DryRunOperation' else 1)
    except Exception:
        sys.exit(1)
