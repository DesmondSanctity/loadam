# Example: basic OpenAPI

Tiny end-to-end walkthrough using the [petstore](../../fixtures/specs/petstore.openapi.yaml) spec. No auth required.

## What this demonstrates

- IR inspection (`init`)
- k6 smoke + load (`test`)
- Contract suite (`contract`)
- MCP server (`mcp`)
- Drift detection (`diff`)

## Run it

From the repository root:

```bash
# 1. Inspect the IR + resource graph.
node ./packages/cli/dist/bin.js init fixtures/specs/petstore.openapi.yaml -o /tmp/petstore.ir.json
```

Expected output:

```
✔ Wrote /tmp/petstore.ir.json
ℹ   4 operations · 3 schemas · 1 auth profile(s)
ℹ   1 resource kind(s) · 0 edge(s)

Pet
    list:   listPets (GET /pets)
    create: createPet (POST /pets)
    read:   showPetById (GET /pets/{petId})
    delete: deletePet (DELETE /pets/{petId})
```

```bash
# 2. Stand up a mock so we have somewhere to point the rigs.
npx @stoplight/prism-cli mock fixtures/specs/petstore.openapi.yaml &
PRISM_PID=$!
sleep 2

# 3. Generate + run the k6 smoke test.
node ./packages/cli/dist/bin.js test fixtures/specs/petstore.openapi.yaml -o /tmp/petstore-k6
( cd /tmp/petstore-k6 && X_API_KEY=test-key BASE_URL=http://localhost:4010 k6 run smoke.js )

# 4. Generate the MCP server.
node ./packages/cli/dist/bin.js mcp fixtures/specs/petstore.openapi.yaml \
  -o /tmp/petstore-mcp \
  --target http://localhost:4010
( cd /tmp/petstore-mcp && npm install && X_API_KEY=test-key node bin.js --http --port 3333 ) &
MCP_PID=$!

# 5. Drift check.
node ./packages/cli/dist/bin.js diff fixtures/specs/petstore.openapi.yaml \
  --target http://localhost:4010 \
  -H "X-API-Key: test-key"

# Cleanup.
kill $PRISM_PID $MCP_PID
```

## Connect the MCP server to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
 "mcpServers": {
  "petstore": {
   "command": "node",
   "args": ["/tmp/petstore-mcp/bin.js"],
   "env": {
    "BASE_URL": "https://petstore.swagger.io/v1",
    "X_API_KEY": "your-key"
   }
  }
 }
}
```

Restart Claude Desktop. The petstore tools (`listPets`, `showPetById`) are now available to the agent.
