SELECT objects.item_id, objects.marketplace, images.path
FROM ${wharfie_db}."amazon_berkeley_objects" AS objects
LEFT JOIN ${wharfie_db}."amazon_berkeley_object_images" AS images
ON objects.main_image_id = images.image_id
