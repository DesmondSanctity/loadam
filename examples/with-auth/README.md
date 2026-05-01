# Example: with auth + multi-server

Walks through a spec that has bearer auth and two declared servers — the [bookstore](../../fixtures/specs/bookstore.openapi.yaml) fixture.

## What this demonstrates

- Bearer auth flowing into every emitted rig as an env var (`API_TOKEN`)
- Multi-server specs (loadam picks the first; CLI `--target` overrides)
- `--writes` opting in destructive ops (DELETE) on the MCP server
- `auth import` inferring a profile from a curl

## Inferring an auth profile from curl

If you already have a working curl, loadam can produce the matching profile:

```bash
echo "curl https://api.bookstore.example.com/v1/books -H 'Authorization: Bearer abc.def.ghi'" \
  | node ./packages/cli/dist/bin.js auth import --json
```

```jsonc
{
 "profile": {
  "id": "bearer",
  "kind": "bearer",
  "tokenEnv": "API_TOKEN",
 },
 "notes": ["Bearer token detected; will be read from env API_TOKEN"],
}
```

The literal token is **never** baked into the inferred profile.

## Generate the rigs

```bash
SPEC=fixtures/specs/bookstore.openapi.yaml
TARGET=https://api.bookstore.example.com/v1

# k6 — load test rig.
node ./packages/cli/dist/bin.js test $SPEC -o /tmp/bookstore-k6 --target $TARGET
# Run with: API_TOKEN=... k6 run /tmp/bookstore-k6/smoke.js

# MCP — read-only by default.
node ./packages/cli/dist/bin.js mcp $SPEC -o /tmp/bookstore-mcp --target $TARGET
# Tools: listBooks, getBook  (no createBook/deleteBook)

# MCP — opt in to writes (creates AND deletes).
node ./packages/cli/dist/bin.js mcp $SPEC -o /tmp/bookstore-mcp-writes --target $TARGET --writes
# Tools: listBooks, getBook, createBook, deleteBook

# Contract suite (Python).
node ./packages/cli/dist/bin.js contract $SPEC -o /tmp/bookstore-contract --target $TARGET
# Run with: API_TOKEN=... pytest
```

## Running the MCP server

```bash
cd /tmp/bookstore-mcp
npm install

# stdio transport (Claude Desktop, Cursor)
API_TOKEN=your-token BASE_URL=$TARGET node bin.js

# Streamable HTTP transport
API_TOKEN=your-token BASE_URL=$TARGET node bin.js --http --port 3333
```

## Anatomy of the generated `auth.js`

Bearer profiles emit a tiny ESM module the runtime imports:

```js
// auth.js — generated
export function authHeaders() {
 const h = {};
 h['Authorization'] = `Bearer ${process.env.API_TOKEN || ''}`;
 return h;
}

export function authQuery() {
 return {};
}
```

Same shape across `@loadam/test-k6`, `@loadam/mcp`, and the contract suite — single source of behaviour.
