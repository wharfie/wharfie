#!/bin/bash

# Set your bucket and prefix
BUCKET_NAME="wharfie-testing-3-079185815456-us-west-2"
PREFIX="logs/raw"

# Directory where the script is run
RUN_DIR=$(pwd)

# Create a temporary directory for downloads
TMP_DIR=$(mktemp -d)
echo "Temporary directory created at $TMP_DIR"

# Change to the temporary directory
cd $TMP_DIR

# Get the list of objects with their creation dates
aws s3api list-objects --bucket $BUCKET_NAME --prefix $PREFIX --query 'Contents[].{Key: Key, LastModified: LastModified}' --output text > objects_list.txt

# Sort the objects by creation date
sort -k2 objects_list.txt > sorted_objects_list.txt

# Download, decompress, and concatenate files in the order they were created
while IFS= read -r line; do
    OBJECT_KEY=$(echo $line | awk '{print $1}')
    aws s3 cp s3://$BUCKET_NAME/$OBJECT_KEY $TMP_DIR

    # Extract filename from OBJECT_KEY
    FILENAME=$(basename $OBJECT_KEY)

    # Decompress the file
    gunzip -c "$TMP_DIR/$FILENAME" >> $RUN_DIR/concatenated_file.txt
done < sorted_objects_list.txt


# Clean up: delete the temporary directory
rm -r $TMP_DIR
echo "Temporary files cleaned up."
