#!/usr/bin/env bash
# COPY of krizaka/krizaka-ui tools/publish-packages.sh (+ npm-publish-error.mjs), temporary: the shared home is a @krizaka/config bin (follow-up issue).
# Publish step of release.yml. Every package is tried FIRST with npm trusted publishing (GitHub Actions OIDC, no token: an EMPTY user
# config, so the only credential npm can use is the job's id-token). If npm answers ENEEDAUTH or the OIDC exchange 404s (no trusted
# publisher configured, or one that does not match), a ::warning:: names the package and the publish is retried with NPM_TOKEN
# (scripts/npm-publish-error.mjs decides). Any other error fails the run. The log thus shows which packages already publish by OIDC.
# Packages are packed by pnpm (workspace: ranges resolved); then `changeset tag` creates the tags.
set -euo pipefail
pnpm turbo run build --filter='./packages/*'
tmp=$(mktemp -d)
echo "registry=https://registry.npmjs.org/" > "$tmp/oidc.npmrc"
printf 'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n' > "$tmp/token.npmrc"
for f in packages/*/package.json; do
  node -e 'process.exit(require("./"+process.argv[1]).private?1:0)' "$f" || continue
  dir=$(dirname "$f"); name=$(node -p "require('./$f').name"); ver=$(node -p "require('./$f').version")
  if [ "$(npm view "$name@$ver" version 2>/dev/null || true)" = "$ver" ]; then echo "$name@$ver already on npm"; continue; fi
  out="$tmp/pack-$(basename "$dir")"; mkdir -p "$out"
  pnpm --filter "$name" pack --pack-destination "$out"
  tgz=$(ls "$out"/*.tgz)
  echo "Publishing $name@$ver with trusted publishing (OIDC, no token)"
  if env -u NODE_AUTH_TOKEN NPM_CONFIG_USERCONFIG="$tmp/oidc.npmrc" npm publish "$tgz" --access public --provenance --loglevel verbose 2>&1 | tee "$tmp/log"; then
    echo "$name@$ver published via OIDC"; continue
  fi
  if node scripts/npm-publish-error.mjs < "$tmp/log"; then
    echo "::warning::$name: trusted publisher not configured or mismatched (OIDC publish failed), retrying with NPM_TOKEN"
    NPM_CONFIG_USERCONFIG="$tmp/token.npmrc" npm publish "$tgz" --access public --provenance
    echo "$name@$ver published via NPM_TOKEN"
  else
    echo "::error::$name@$ver: publish failed (not an auth error)"; exit 1
  fi
done
pnpm changeset tag
