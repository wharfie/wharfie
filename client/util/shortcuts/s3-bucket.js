'use strict';
/**
 * @param {string} bucketName - name of the bucket
 * @returns {Array} - array of default policy statements
 */
function getDefaultPolicyStatements(bucketName) {
  return [
    {
      Sid: 'Deny changing the objects ACL',
      Effect: 'Deny',
      Principal: {
        AWS: '*',
      },
      Action: ['s3:PutObjectAcl'],
      Resource: [
        {
          'Fn::Join': [
            '',
            [
              'arn:',
              {
                Ref: 'AWS::Partition',
              },
              ':s3:::',
              bucketName,
              '/*',
            ],
          ],
        },
      ],
    },
    {
      Sid: 'Deny changing the bucket ACL',
      Effect: 'Deny',
      Principal: {
        AWS: '*',
      },
      Action: ['s3:PutBucketAcl'],
      Resource: [
        {
          'Fn::Join': [
            '',
            [
              'arn:',
              {
                Ref: 'AWS::Partition',
              },
              ':s3:::',
              bucketName,
            ],
          ],
        },
      ],
    },
  ];
}
/**
 * @param {string} bucketName - name of the bucket
 * @returns {object} - default bucket policy
 */
function getDefaultBucketPolicy(bucketName) {
  const bucketPolicy = {
    Type: 'AWS::S3::BucketPolicy',
    Properties: {
      Bucket: bucketName,
      PolicyDocument: {
        Statement: [],
      },
    },
    DependsOn: 'Bucket',
  };

  const defaultStatements = getDefaultPolicyStatements(bucketName);

  for (const statement of defaultStatements) {
    bucketPolicy.Properties.PolicyDocument.Statement.push(statement);
  }
  return bucketPolicy;
}

/**
 * @param {any} options - options for the bucket
 * @returns {object} - bucket resource
 */
function getBucketResource(options) {
  const bucketResource = {
    Type: 'AWS::S3::Bucket',
    DeletionPolicy: 'Delete',
    Properties: {
      BucketName: options.BucketName,
      AccessControl: 'Private',
      Tags: [],
      // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket-loggingconfig.html
      LoggingConfiguration: {
        DestinationBucketName: options.AccessLoggingBucketName,
        LogFilePrefix: {
          'Fn::Join': ['', [options.BucketName, '/']],
        },
      },
      LifecycleConfiguration: options.LifecycleConfiguration,
    },
  };

  if (options.PublicAccessBlock) {
    bucketResource.Properties.PublicAccessBlockConfiguration =
      options.PublicAccessBlockOptions;
  }

  if (options.Encryption) {
    bucketResource.Properties.BucketEncryption = {
      ServerSideEncryptionConfiguration: [
        {
          ServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256',
          },
        },
      ],
    };
  }

  if (options.Versioning) {
    bucketResource.Properties.VersioningConfiguration = {
      Status: 'Enabled',
    };
  }

  [
    'CorsConfiguration',
    'InventoryConfigurations',
    'NotificationConfiguration',
  ].forEach((prop) => {
    if (options[prop]) {
      bucketResource.Properties[prop] = options[prop];
    }
  });

  return bucketResource;
}

/**
 * Build an S3 bucket cloudformation template, optionally attach it to an existing template.
 * @param {object} options - Options for the bucket.
 * @param {string} options.BucketName - Name of the S3 bucket. Required.
 * @param {boolean} options.PublicAccessBlock - Disable or enable public access block. Default true.
 * @param {object} options.PublicAccessBlockOptions - Options for public access block. Default in README.
 * @param {string} options.AccountID - AWS Account ID for cross account access.
 * @param {string} options.CrossAccountPermissions - read, write and read/write. Default read.
 * @param {string} options.AccessLoggingBucketName - Name of the Logging Bucket.
 * @param {boolean} options.Encryption - Disable or enable bucket encryption. Default true.
 * @param {object} template - Existing template to attach the bucket to.
 * @returns {object} template
 */
function build(options, template) {
  template = template || {};
  template = JSON.parse(JSON.stringify(template));

  // set option defaults
  if (options.PublicAccessBlock === undefined) {
    options.PublicAccessBlock = true;
  }

  if (
    options.PublicAccessBlock &&
    options.PublicAccessBlockOptions === undefined
  ) {
    options.PublicAccessBlockOptions = {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    };
  }

  if (options.Encryption === undefined) {
    options.Encryption = true;
  }

  if (options.Versioning === undefined) {
    options.Versioning = false;
  }

  if (options.LifecycleConfiguration === undefined) {
    options.LifecycleConfiguration = {
      Rules: [
        {
          AbortIncompleteMultipartUpload: {
            DaysAfterInitiation: 7,
          },
          Status: 'Enabled',
        },
      ],
    };
  }

  template.Resources = template.Resources || {};
  template.Resources.Bucket = getBucketResource(options);

  // Default non-cross account bucket policy
  if (!options.BucketPolicy) {
    template.Resources.DefaultBucketPolicy = getDefaultBucketPolicy(
      options.BucketName
    );
  }

  // User passed BucketPolicy override
  if (options.BucketPolicy) {
    template.Resources.BucketPolicy = options.BucketPolicy;
  }

  return template;
}

module.exports.build = build;
