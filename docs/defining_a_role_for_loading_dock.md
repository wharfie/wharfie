# Defining a Role for Wharfie

**Note: For most usage using the shortcut `ld.Role()` will work the best**

Wharfie requires users to explicilty grant it permissions to their data. The interface for this is the `DaemonConfig.Role` property which accepts an iam role ARN.

The role that is defined needs to have three things

1. it needs to grant the `wharfie-production-role` permissions to assume it:

```js
AssumeRolePolicyDocument: {
  Statement: [
    {
      Action: 'sts:AssumeRole',
      Effect: 'Allow',
      Principal: {
        AWS: cf.importValue('wharfie-production-role')
      }
    }
  ],
  Version: '2012-10-17'
}
```

2. it needs to include the `wharfie-production-base-policy` Managed Policy

```js
ManagedPolicyArns: [
  cf.importValue('wharfie-production-base-policy')
],
```

3. It needs to allow S3 list/read access to the raw data s3 locations and S3 \* access to the compressed data output locations

### Complete example

```js
{
  Source: {
    Type: 'Custom::Wharfie',
    Properties: {
      DaemonConfig: {
        Role: cf.getAtt('Role', 'Arn'),
        ...
      }
      ...
    }
  },
  Role: {
    Type: 'AWS::IAM::Role',
    Properties: {
      RoleName: cf.sub('${AWS::StackName}-wharfie-role'),
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              AWS: cf.importValue('wharfie-production-role')
            }
          }
        ],
        Version: '2012-10-17'
      },
      ManagedPolicyArns: [
        cf.importValue('wharfie-production-base-policy')
      ],
      Policies: [
        {
          PolicyName: 'main',
          PolicyDocument: {
            Statement: [
              {
                Sid: 'BucketList',
                Effect: 'Allow',
                Action: [
                  's3:GetBucketLocation',
                  's3:ListBucket',
                  's3:ListBucketMultipartUploads',
                  's3:AbortMultipartUpload'
                ],
                Resource: [
                  cf.sub('arn:aws:s3:::${AWS::StackName}'),
                ]
              },
              {
                Sid: 'Compacted',
                Effect: 'Allow',
                Action: ['s3:*'],
                Resource: [
                  cf.sub('arn:aws:s3:::${AWS::StackName}/compacted/*')
                ]
              },
              {
                Sid: 'Raw',
                Effect: 'Allow',
                Action: ['s3:GetObject'],
                Resource: [
                  cf.sub('arn:aws:s3:::${AWS::StackName}/raw/*')
                ]
              }
            ]
          }
        }
      ]
    }
  }
}
```
