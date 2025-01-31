#! /bin/bash

source .env

aws s3 rm s3://wharfie.dev --recursive

aws s3 cp ./build/ s3://wharfie.dev --recursive

aws s3 cp \
    --exclude "index.html" \
    --content-type="text/html"  \
    --metadata-directive="REPLACE" \
    --recursive \
        s3://wharfie.dev/journal/ \
        s3://wharfie.dev/journal/
