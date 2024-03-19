'use strict';

const wharfie = require('../../../client');

const Resources = {
  WharfieEventBus: {
    Type: 'AWS::Events::EventBus',
    Properties: {
      Name: wharfie.util.sub('${AWS::StackName}-Event-Bus'),
    },
  },
};
const Outputs = {
  WharfieEventBusName: {
    Value: wharfie.util.ref('WharfieEventBus'),
    Export: { Name: wharfie.util.sub('${AWS::StackName}-Event-Bus') },
  },
};

module.exports = { Outputs, Resources };
