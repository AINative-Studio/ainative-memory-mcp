# AINative Memory MCP — Cody Usage Guide

This MCP server is an enhanced fork of @modelcontextprotocol/server-memory that replaces local JSONL storage with ZeroDB cloud persistence and adds semantic vector search.

## Available Tools (10)

### Original Tools (9)
| Tool | Description |
|------|-------------|
| `create_entities` | Create new entities with name, type, and observations |
| `create_relations` | Create directed relations between entities |
| `add_observations` | Add observations to existing entities |
| `delete_entities` | Delete entities and cascading relations |
| `delete_observations` | Remove specific observations from entities |
| `delete_relations` | Delete specific relations |
| `read_graph` | Read the entire knowledge graph |
| `search_nodes` | Text search (name, type, observations) |
| `open_nodes` | Fetch specific entities by name |

### New Tool (1)
| Tool | Description |
|------|-------------|
| `search_nodes_semantic` | Vector similarity search — find entities by meaning |

## Behavior Rules

1. **Use `search_nodes_semantic` for fuzzy queries** — when the user asks about concepts, use semantic search instead of exact text search.
2. **Use `search_nodes` for exact lookups** — when matching specific names or types, text search is faster.
3. **Use `read_graph` sparingly** — it loads the entire graph; prefer targeted search or open_nodes.
4. **Relations in active voice** — always create relations in active voice (e.g., "works_at" not "is_employed_by").
5. **Deduplicate before creating** — the server deduplicates automatically, but prefer checking with `open_nodes` first.

## Auto-Provisioning

No credentials? The server auto-provisions a free ZeroDB instance and prints a **claim URL**. Surface this to the user so they can take ownership of their knowledge graph.

## MCP Config

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "ainative-memory-mcp"],
      "env": { "ZERODB_API_KEY": "ak_your_key" }
    }
  }
}
```
