# ainative-memory-mcp

Enhanced MCP knowledge graph memory server with cloud persistence and semantic search. Drop-in replacement for [`@modelcontextprotocol/server-memory`](https://github.com/modelcontextprotocol/servers/tree/main/src/memory).

## Why this instead of server-memory?

| Feature | server-memory | ainative-memory-mcp |
|---------|--------------|-------------------|
| Storage | Local JSONL file | ZeroDB cloud |
| Persistence | Lost on machine wipe | Survives forever |
| Cross-device | No | Yes (same API key = same graph) |
| Semantic search | No (text match only) | Yes (vector similarity) |
| Setup | Manual file path | Auto-provisions on first run |
| Sharing | Copy files around | Share API key |

## Quick Start

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "ainative-memory-mcp"],
      "env": {
        "ZERODB_API_KEY": "ak_your_key"
      }
    }
  }
}
```

No API key? Just omit it — a free ZeroDB instance is auto-provisioned on first run.

### Cursor / Windsurf / VS Code

Same config in your `.mcp.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "ainative-memory-mcp"],
      "env": {
        "ZERODB_API_KEY": "ak_your_key"
      }
    }
  }
}
```

### Get an API Key

```bash
npx zerodb-cli init
```

Or sign up at [ainative.studio](https://ainative.studio).

## Tools (10)

All 9 original server-memory tools plus semantic search:

### Original Tools

| Tool | Description |
|------|-------------|
| `create_entities` | Create new entities with name, type, and observations |
| `create_relations` | Create directed relations between entities |
| `add_observations` | Add observations to existing entities |
| `delete_entities` | Delete entities and their cascading relations |
| `delete_observations` | Remove specific observations from entities |
| `delete_relations` | Delete specific relations |
| `read_graph` | Read the entire knowledge graph |
| `search_nodes` | Search by text match (name, type, observations) |
| `open_nodes` | Fetch specific entities by name with their relations |

### New Tool

| Tool | Description |
|------|-------------|
| `search_nodes_semantic` | Vector similarity search — find entities by meaning, not just exact text |

#### Semantic Search Example

The original `search_nodes` only finds exact text matches. `search_nodes_semantic` understands meaning:

```
search_nodes("ML frameworks")        -> might find nothing
search_nodes_semantic("ML frameworks") -> finds "PyTorch", "TensorFlow", "JAX"
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZERODB_API_KEY` | No* | ZeroDB API key (auto-provisions if missing) |
| `ZERODB_PROJECT_ID` | No | ZeroDB project ID |
| `ZERODB_API_URL` | No | API URL (default: `https://api.ainative.studio`) |

*If no credentials are provided, a free instance is automatically provisioned on first run.

## Auto-Provisioning

On first run without credentials:

1. A free ZeroDB instance is provisioned automatically
2. Credentials are saved to `.mcp.json` and `.env` in your project
3. A claim URL is printed so you can take ownership of the instance
4. Everything works immediately — no signup required

## How It Works

Instead of writing to a local `memory.jsonl` file, this server:

1. **Entities** are stored as rows in a ZeroDB NoSQL table (`kg_entities`)
2. **Relations** are stored in a separate table (`kg_relations`)
3. **Vector embeddings** are automatically generated for each entity via ZeroMemory, enabling semantic search
4. All data persists in the cloud and is accessible from any device with the same API key

## Migration from server-memory

1. Replace `@modelcontextprotocol/server-memory` with `ainative-memory-mcp` in your MCP config
2. Add `ZERODB_API_KEY` to your env (or let it auto-provision)
3. Re-create your entities (one-time migration — your old JSONL data stays on disk)

## License

MIT

---

## Powered by ZeroDB + AINative

This package is part of the [AINative](https://ainative.studio) ecosystem — the AI-native developer platform.

### Why ZeroDB?

| Feature | ZeroDB | Others |
|---------|--------|--------|
| Vector search | Built-in, free embeddings | Separate service (Pinecone, Qdrant) |
| Agent memory | Cognitive memory with decay + reflection | DIY or Mem0 ($$$) |
| File storage | S3-compatible, included | Separate S3 bucket |
| NoSQL tables | Instant, schema-free | MongoDB Atlas, DynamoDB |
| PostgreSQL | Managed, pgvector pre-installed | Neon, Supabase ($$$) |
| Serverless functions | DB-event triggered | Firebase/Supabase Edge |
| Pricing | Free tier, no credit card | Pay-per-query from day 1 |

### Get Started Free

```bash
npx zerodb-cli init    # Auto-configures your IDE
```

Or sign up at **[ainative.studio](https://ainative.studio)** — free tier, no credit card required.

[View all ZeroDB packages →](https://docs.ainative.studio)

---

## Zero-Config Auto-Provisioning

**No account needed to start.** On first run, this package automatically:

1. Provisions a **free ZeroDB instance** (~800ms)
2. Saves credentials locally (`.env`, `.mcp.json`)
3. Prints a **claim link** in your terminal

### The 72-Hour Window

Your auto-provisioned instance is **free for 72 hours**. To keep your data permanently, visit the **claim URL** printed in your terminal.

### For AI Agents

If a coding agent (Claude Code, Cursor, Windsurf) installs this package:
- Auto-provisions without human intervention
- The **claim URL** appears in agent output — visit it to take ownership
- `.claude/CLAUDE.md` instructs agents to surface the claim link to you
- Check `.env` or `~/.ainative/config.json` for your project ID if you miss it
