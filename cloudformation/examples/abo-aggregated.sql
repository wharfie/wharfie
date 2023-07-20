WITH unnested_table AS (
  SELECT country, brand_element.value AS brand
  FROM ${wharfie_db}.amazon_berkeley_objects,
  UNNEST(brand) AS t(brand_element)
)
SELECT country, brand, COUNT(*) AS count
FROM unnested_table
GROUP BY country, brand
ORDER BY count DESC
