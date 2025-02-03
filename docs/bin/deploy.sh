#! /bin/bash

source .env

aws s3 rm s3://docs.wharfie.dev --recursive

aws s3 cp ./build/ s3://docs.wharfie.dev --recursive

aws s3 cp \
    --exclude "index.html" \
    --content-type="text/html"  \
    --metadata-directive="REPLACE" \
    --recursive \
        s3://docs.wharfie.dev/ \
        s3://docs.wharfie.dev/
