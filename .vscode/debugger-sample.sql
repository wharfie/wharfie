WITH unnested_table AS (
  SELECT country, brand_element.value as brand
  FROM wharfie.amazon_berkeley_objects,
  UNNEST(brand) AS t(brand_element)
)
SELECT country, brand, COUNT(*) AS count
FROM unnested_table
GROUP BY country, brand
ORDER BY count desc;
