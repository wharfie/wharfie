'use strict';

const wharfie = require('../../client');

const AmazonBerkeleyObjects = new wharfie.Resource({
  LogicalName: 'AmazonBerkeleyObjects',
  DatabaseName: wharfie.util.ref('Database'),
  TableName: 'amazon_berkeley_objects',
  WharfieDeployment: wharfie.util.ref('Deployment'),
  Description:
    'Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html',
  Format: 'json',
  Columns: [
    {
      Name: 'brand',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'bullet_point',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'color',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'color_code',
      Type: 'array<string>',
    },
    {
      Name: 'country',
      Type: 'string',
    },
    {
      Name: 'domain_name',
      Type: 'string',
    },
    {
      Name: 'fabric_type',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'finish_type',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'item_dimensions',
      Type: 'struct<height:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,length:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,width:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>',
    },
    {
      Name: 'item_id',
      Type: 'string',
    },
    {
      Name: 'item_keywords',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'item_name',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'item_shape',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'item_weight',
      Type: 'array<struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>',
    },
    {
      Name: 'main_image_id',
      Type: 'string',
    },
    {
      Name: 'marketplace',
      Type: 'string',
    },
    {
      Name: 'material',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'model_name',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'model_number',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'model_year',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'node',
      Type: 'array<struct<node_id:bigint,path:string>>',
    },
    {
      Name: 'other_image_id',
      Type: 'array<string>',
    },
    {
      Name: 'pattern',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'product_description',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: 'product_type',
      Type: 'array<struct<value:string>>',
    },
    {
      Name: 'spin_id',
      Type: 'string',
    },
    {
      Name: 'style',
      Type: 'array<struct<language_tag:string,value:string>>',
    },
    {
      Name: '3dmodel_id',
      Type: 'string',
    },
  ],
  InputLocation: 's3://amazon-berkeley-objects/listings/metadata/',
  CompactedConfig: {
    Location: wharfie.util.sub('s3://${Bucket}/AmazonBerkelyObjects/'),
  },
  DaemonConfig: {
    Role: wharfie.util.getAtt('WharfieExamplesRole', 'Arn'),
    Schedule: 60,
  },
});

module.exports = AmazonBerkeleyObjects;
