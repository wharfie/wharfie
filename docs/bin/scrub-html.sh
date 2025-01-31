#! /bin/bash

export DEPLOY_DIR="./build"
# Remove the .html extension from all blog posts for clean URLs
for filename in $DEPLOY_DIR/journal/*.html; do
    if [ $filename != "$DEPLOY_DIR/journal/index.html" ];
    then
        original="$filename"

        # Get the filename without the path/extension
        filename=$(basename "$filename")
        extension="${filename##*.}"
        filename="${filename%.*}"

        # copy it
        cp $original $DEPLOY_DIR/journal/$filename
    fi
done