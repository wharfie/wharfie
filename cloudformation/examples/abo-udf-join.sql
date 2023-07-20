USING EXTERNAL FUNCTION UDF_name(url varchar)
RETURNS varchar
LAMBDA 'WharfieUDF-d9b6638737a91e07d0874ff072c70ed5'
SELECT objects.item_id, objects.marketplace, CAST(UDF_name(CONCAT('https://amazon-berkeley-objects.s3.us-east-1.amazonaws.com/images/original/', images.path)) AS bigint)
FROM "wharfie_testing_2_examples"."amazon_berkeley_objects" AS objects
LEFT JOIN "wharfie_testing_2_examples"."amazon_berkeley_object_images" AS images
ON objects.main_image_id = images.image_id
ORDER BY objects.item_id DESC
LIMIT 10
