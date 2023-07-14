#!/bin/bash

version=${1#refs/tags/v}

zip -r -j wordbook-bob-plugin-v$version.bobplugin src/*

sha256_wordbook=$(sha256sum wordbook-bob-plugin-v$version.bobplugin | cut -d ' ' -f 1)
echo $sha256_wordbook

download_link="https://github.com/yuhaowin/wordbook-bob-plugin/releases/download/v$version/wordbook-bob-plugin-v$version.bobplugin"

new_version="{\"version\": \"$version\", \"desc\": \"https://github.com/yuhaowin/wordbook-bob-plugin/releases/tag/v$version\", \"sha256\": \"$sha256_wordbook\", \"url\": \"$download_link\", \"minBobVersion\": \"0.5.4\"}"

json_file='appcast.json'
json_data=$(cat $json_file)

updated_json=$(echo $json_data | jq --argjson new_version "$new_version" '.versions += [$new_version]' | jq .)

echo $updated_json >$json_file
mkdir dist
mv *.bobplugin dist
