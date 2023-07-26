'use strict';

const Role = require('./role');

/**
 * Create an IAM role that will be assumed by an AWS service, e.g. Lambda or ECS.
 * @param {Object} options - Extends
 * the options for [`Role`](#role). You do not need to provide
 * an `AssumeRolePrincipals` attribute, but do need to include the following
 * additional attributes:
 * @param {String} options.Service - The name of the AWS service that will assume this role, e.g. `lambda`.
 * @returns {Object} -
 */
class ServiceRole extends Role {
  constructor(options) {
    if (!options) throw new Error('Options required');
    const { LogicalName } = options;
    let { Service } = options;

    const required = [LogicalName, Service];
    if (required.some((variable) => !variable))
      throw new Error('You must provide a LogicalName and Service');

    const avoidSuffix = [
      'apigateway',
      'autoscaling',
      'cloudformation',
      'codedeploy',
      'ecs-tasks',
      'elasticbeanstalk',
      'firehose',
      'iot',
      'lambda',
      'rds',
      'redshift',
      's3',
      'sms',
      'storagegateway',
      'swf',
    ];

    const prefix = Service.replace(/\.amazonaws.com(\..*)?$/, '');

    Service = {
      'Fn::Sub': avoidSuffix.includes(prefix)
        ? `${prefix}.amazonaws.com`
        : `${prefix}.\${AWS::URLSuffix}`,
    };

    const AssumeRolePrincipals = [{ Service }];
    super(Object.assign({ AssumeRolePrincipals }, options));
  }
}

module.exports = ServiceRole;
