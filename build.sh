#!/bin/bash

# Exit immediately on error, unset variable, or pipeline failure
set -euo pipefail

DIR_PATH="./tmp"

# Check if the directory exists
if [ ! -d "$DIR_PATH" ]; then
  echo "Directory $DIR_PATH does not exist. Creating it..."
  mkdir -p "$DIR_PATH"
fi

# Run esbuild
npx esbuild ./bin/wharfie --bundle --platform=node --minify --keep-names --sourcemap=inline --target=node22 --external:esbuild > ./tmp/wharfie.js
echo -e "\033[32m✔ esbuild complete\033[0m"

npx xsea ./tmp/wharfie.js -o ./dist/wharfie --node $(node -v) -t linux-x64 -t darwin-arm64 -t linux-arm64

echo -e "\033[32m✔ build complete\033[0m"