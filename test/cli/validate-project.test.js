/* eslint-disable jest/no-large-snapshots */
'use strict';

const { validateProject } = require('../../cli/project/schema');

describe('validate project', () => {
  it('basic', async () => {
    expect.assertions(1);

    const project = {
      name: 'project_fixture',
      path: '/Users/Dev/Documents/workspace/wharfie/wharfie/test/fixtures/project_fixture',
      environments: [{ name: '__wharfie_default_environment__' }],
      definitions: [],
      taps: [],
      sinks: [],
      models: [
        {
          sql: 'WITH unnested_table AS (\n  SELECT country, brand_element.value AS brands\n  FROM ${db}.amazon_berkely_objects,\n  UNNEST(brand) AS t(brand_element)\n)\nSELECT country, brands, COUNT(*) AS count\nFROM unnested_table\nGROUP BY country, brands\nORDER BY count DESC\n',
          name: 'amazon_berkely_objects_aggregated',
          description: 'Materialized Table',
          columns: [
            { name: 'country', type: 'string' },
            { name: 'brands', type: 'string' },
            { name: 'count', type: 'bigint' },
          ],
          service_level_agreement: { freshness: 60 },
        },
        {
          sql: 'SELECT objects.item_id, objects.marketplace, images.path\nFROM ${db}.amazon_berkely_objects AS objects\nLEFT JOIN ${db}.amazon_berkely_objects_images AS images\nON objects.main_image_id = images.image_id\n',
          name: 'amazon_berkely_objects_join',
          description: 'Materialized Table',
          columns: [
            { name: 'item_id', type: 'string' },
            { name: 'marketplace', type: 'string' },
            { name: 'path', type: 'string' },
          ],
          service_level_agreement: { freshness: 60 },
        },
      ],
      sources: [
        {
          name: 'amazon_berkely_objects_images',
          description:
            'Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html',
          custom_format: {
            input_format: 'org.apache.hadoop.mapred.TextInputFormat',
            output_format:
              'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
            serde_info: {
              serialization_library:
                'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe',
              parameters: {
                'field.delim': ',',
                'serialization.format': ',',
                'skip.header.line.count': '1',
              },
            },
            compressed: false,
          },
          input_location: {
            storage: 's3',
            path: 's3://amazon-berkeley-objects/images/metadata/',
          },
          service_level_agreement: { freshness: 60 },
          columns: [
            { name: 'image_id', type: 'string' },
            { name: 'height', type: 'bigint' },
            { name: 'width', type: 'bigint' },
            { name: 'path', type: 'string' },
          ],
        },
        {
          name: 'amazon_berkely_objects',
          description:
            'Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html',
          format: 'json',
          input_location: {
            storage: 's3',
            path: 's3://amazon-berkeley-objects/listings/metadata/',
          },
          service_level_agreement: { freshness: 60 },
          columns: [
            {
              name: 'brand',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'bullet_point',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'color',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            { name: 'color_code', type: 'array<string>' },
            { name: 'country', type: 'string' },
            { name: 'domain_name', type: 'string' },
            {
              name: 'fabric_type',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'finish_type',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'item_dimensions',
              type: 'struct<height:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,length:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,width:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>',
            },
            { name: 'item_id', type: 'string' },
            {
              name: 'item_keywords',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'item_name',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'item_shape',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'item_weight',
              type: 'array<struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>',
            },
            { name: 'main_image_id', type: 'string' },
            { name: 'marketplace', type: 'string' },
            {
              name: 'material',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'model_name',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'model_number',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'model_year',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            { name: 'node', type: 'array<struct<node_id:bigint,path:string>>' },
            { name: 'other_image_id', type: 'array<string>' },
            {
              name: 'pattern',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'product_description',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            { name: 'product_type', type: 'array<struct<value:string>>' },
            { name: 'spin_id', type: 'string' },
            {
              name: 'style',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            { name: '3dmodel_id', type: 'string' },
          ],
        },
      ],
    };
    const validatedProject = validateProject(project);

    expect(validatedProject).toMatchInlineSnapshot(`
      {
        "definitions": [],
        "environments": [
          {
            "name": "__wharfie_default_environment__",
          },
        ],
        "models": [
          {
            "columns": [
              {
                "name": "country",
                "type": "string",
              },
              {
                "name": "brands",
                "type": "string",
              },
              {
                "name": "count",
                "type": "bigint",
              },
            ],
            "description": "Materialized Table",
            "name": "amazon_berkely_objects_aggregated",
            "service_level_agreement": {
              "freshness": 60,
            },
            "sql": "WITH unnested_table AS (
        SELECT country, brand_element.value AS brands
        FROM \${db}.amazon_berkely_objects,
        UNNEST(brand) AS t(brand_element)
      )
      SELECT country, brands, COUNT(*) AS count
      FROM unnested_table
      GROUP BY country, brands
      ORDER BY count DESC
      ",
          },
          {
            "columns": [
              {
                "name": "item_id",
                "type": "string",
              },
              {
                "name": "marketplace",
                "type": "string",
              },
              {
                "name": "path",
                "type": "string",
              },
            ],
            "description": "Materialized Table",
            "name": "amazon_berkely_objects_join",
            "service_level_agreement": {
              "freshness": 60,
            },
            "sql": "SELECT objects.item_id, objects.marketplace, images.path
      FROM \${db}.amazon_berkely_objects AS objects
      LEFT JOIN \${db}.amazon_berkely_objects_images AS images
      ON objects.main_image_id = images.image_id
      ",
          },
        ],
        "name": "project_fixture",
        "path": "/Users/Dev/Documents/workspace/wharfie/wharfie/test/fixtures/project_fixture",
        "sinks": [],
        "sources": [
          {
            "columns": [
              {
                "name": "image_id",
                "type": "string",
              },
              {
                "name": "height",
                "type": "bigint",
              },
              {
                "name": "width",
                "type": "bigint",
              },
              {
                "name": "path",
                "type": "string",
              },
            ],
            "custom_format": {
              "compressed": false,
              "input_format": "org.apache.hadoop.mapred.TextInputFormat",
              "number_of_buckets": 0,
              "output_format": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
              "serde_info": {
                "parameters": {
                  "field.delim": ",",
                  "serialization.format": ",",
                  "skip.header.line.count": "1",
                },
                "serialization_library": "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe",
              },
              "stored_as_sub_directories": true,
            },
            "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
            "input_location": {
              "path": "s3://amazon-berkeley-objects/images/metadata/",
              "storage": "s3",
            },
            "name": "amazon_berkely_objects_images",
            "service_level_agreement": {
              "freshness": 60,
            },
          },
          {
            "columns": [
              {
                "name": "brand",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "bullet_point",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "color",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "color_code",
                "type": "array<string>",
              },
              {
                "name": "country",
                "type": "string",
              },
              {
                "name": "domain_name",
                "type": "string",
              },
              {
                "name": "fabric_type",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "finish_type",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "item_dimensions",
                "type": "struct<height:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,length:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,width:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
              },
              {
                "name": "item_id",
                "type": "string",
              },
              {
                "name": "item_keywords",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "item_name",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "item_shape",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "item_weight",
                "type": "array<struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
              },
              {
                "name": "main_image_id",
                "type": "string",
              },
              {
                "name": "marketplace",
                "type": "string",
              },
              {
                "name": "material",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "model_name",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "model_number",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "model_year",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "node",
                "type": "array<struct<node_id:bigint,path:string>>",
              },
              {
                "name": "other_image_id",
                "type": "array<string>",
              },
              {
                "name": "pattern",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "product_description",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "product_type",
                "type": "array<struct<value:string>>",
              },
              {
                "name": "spin_id",
                "type": "string",
              },
              {
                "name": "style",
                "type": "array<struct<language_tag:string,value:string>>",
              },
              {
                "name": "3dmodel_id",
                "type": "string",
              },
            ],
            "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
            "format": "json",
            "input_location": {
              "path": "s3://amazon-berkeley-objects/listings/metadata/",
              "storage": "s3",
            },
            "name": "amazon_berkely_objects",
            "service_level_agreement": {
              "freshness": 60,
            },
          },
        ],
        "taps": [],
      }
    `);
  }, 10000);
});
