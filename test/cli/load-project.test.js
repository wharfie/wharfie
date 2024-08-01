/* eslint-disable jest/no-large-snapshots */
'use strict';

const path = require('path');

const { loadProject } = require('../../cli/project/load');

describe('load project', () => {
  it('fixtured', async () => {
    expect.assertions(1);

    const project = await loadProject({
      path: path.join(__dirname, '../fixtures/project-fixture'),
    });
    expect(project).toMatchInlineSnapshot(`
      {
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
            "name": "inline",
            "service_level_agreement": {
              "freshness": 60,
            },
            "sql": "SELECT objects.item_id, objects.marketplace, images.path FROM \${db}.amazon_berkely_objects AS objects LEFT JOIN \${db}.amazon_berkely_objects_images AS images ON objects.main_image_id = images.image_id",
          },
        ],
        "name": "project-fixture",
        "path": "/Users/Dev/Documents/workspace/wharfie/wharfie/test/fixtures/project-fixture",
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
          {
            "columns": [
              {
                "name": "name",
                "type": "string",
              },
              {
                "name": "count",
                "type": "bigint",
              },
            ],
            "description": "nice",
            "format": "json",
            "input_location": {
              "path": "s3://utility-079185815456-us-west-2/test/",
              "storage": "s3",
            },
            "name": "test",
            "service_level_agreement": {
              "freshness": 60,
            },
          },
        ],
      }
    `);
  }, 10000);
});
