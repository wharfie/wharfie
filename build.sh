#!/bin/bash

# Exit immediately on error, unset variable, or pipeline failure
set -euo pipefail

DIR_PATH="./tmp"

# Check if the directory exists
if [ ! -d "$DIR_PATH" ]; then
  echo "Directory $DIR_PATH does not exist. Creating it..."
  mkdir -p "$DIR_PATH"
fi

# esbuild lambdas
npx esbuild ./lambdas/daemon.js --bundle --platform=node --minify --keep-names --sourcemap=inline --target=node22 > ./tmp/daemon.js
npx esbuild ./lambdas/events.js --bundle --platform=node --minify --keep-names --sourcemap=inline --target=node22 > ./tmp/events.js
npx esbuild ./lambdas/monitor.js --bundle --platform=node --minify --keep-names --sourcemap=inline --target=node22 > ./tmp/monitor.js
npx esbuild ./lambdas/cleanup.js --bundle --platform=node --minify --keep-names --sourcemap=inline --target=node22 > ./tmp/cleanup.js

# esbuild CLI
npx esbuild ./bin/wharfie --bundle --platform=node --minify --keep-names --sourcemap=inline --target=node22 > ./tmp/wharfie.js
echo -e "\033[32m✔ esbuild complete\033[0m"

# npx xsea ./tmp/wharfie.js -o ./dist/wharfie --node $(node -v) -t linux-x64 -t darwin-arm64 -t linux-arm64

# Generate the blob to be injected
node --experimental-sea-config sea-config.json 

# Create a copy of the Node.js executable
cp $(command -v node) ./tmp/wharfie

# Remove the signature of the binary (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
    codesign --remove-signature ./tmp/wharfie
fi

# Inject the blob into the copied binary using postject
if [[ "$OSTYPE" == "darwin"* ]]; then
    npx postject ./tmp/wharfie NODE_SEA_BLOB ./tmp/wharfie.blob \
        --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
        --macho-segment-name NODE_SEA
else
    npx postject ./tmp/wharfie NODE_SEA_BLOB ./tmp/wharfie.blob \
        --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
fi

# Sign the binary (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
    codesign --sign - ./tmp/wharfie
fi

cp ./tmp/wharfie ./dist/wharfie

echo -e "\033[32m✔ build complete\033[0m"