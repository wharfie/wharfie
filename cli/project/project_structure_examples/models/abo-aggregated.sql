WITH unnested_table AS (
  SELECT country, brand_element.value AS brands
  FROM ${db}.amazon_berkely_objects,
  UNNEST(brand) AS t(brand_element)
)
SELECT country, brands, COUNT(*) AS count
FROM unnested_table
GROUP BY country, brands
ORDER BY count DESC
