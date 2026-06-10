#!/usr/bin/env node

/**
 * AINative Memory MCP Server
 *
 * Enhanced fork of @modelcontextprotocol/server-memory that replaces local
 * JSONL storage with ZeroDB cloud persistence and adds semantic vector search.
 *
 * Drop-in replacement: all 9 original tools work identically, plus:
 *   - search_nodes_semantic: find entities by meaning via vector embeddings
 *
 * Cloud benefits:
 *   - Knowledge graph persists across machine restarts
 *   - Shared across devices (same API key = same graph)
 *   - Automatic vector embeddings for every entity
 *   - Auto-provisioning: free ZeroDB instance on first run
 *
 * Original tools (from server-memory):
 *   create_entities, create_relations, add_observations,
 *   delete_entities, delete_observations, delete_relations,
 *   read_graph, search_nodes, open_nodes
 *
 * New tools:
 *   search_nodes_semantic — vector similarity search across entities
 *
 * Usage:
 *   npx ainative-memory-mcp                    # Auto-provisions on first run
 *   ZERODB_API_KEY=ak_... node index.js        # Run with existing API key
 *
 * Refs #3938
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import axios from 'axios';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('./package.json');

dotenv.config();

const SERVER_NAME = 'ainative-memory-mcp';

// ─────────────────────────────────────────────────────────────────
// Credential resolution: env -> .mcp.json scan -> auto-provision
// ─────────────────────────────────────────────────────────────────
if (!process.env.ZERODB_API_KEY && !process.env.ZERODB_USERNAME) {
  const { existsSync, readFileSync, writeFileSync, appendFileSync } = await import('fs');
  const { dirname, join } = await import('path');

  // 1. Scan up directory tree for .mcp.json
  let dir = process.cwd();
  let foundInMcp = false;
  for (let i = 0; i < 6; i++) {
    const candidatePath = join(dir, '.mcp.json');
    if (existsSync(candidatePath)) {
      try {
        const mcp = JSON.parse(readFileSync(candidatePath, 'utf-8'));
        const servers = mcp.mcpServers || {};
        const memServer = servers['ainative-memory']
          || servers['memory']
          || servers['memory-server']
          || servers['zerodb-memory']
          || Object.values(servers).find(s => (s.args || []).join(' ').includes('memory'));
        const env = memServer?.env;
        if (env) {
          if (env.ZERODB_API_KEY) process.env.ZERODB_API_KEY = env.ZERODB_API_KEY;
          if (env.ZERODB_USERNAME) process.env.ZERODB_USERNAME = env.ZERODB_USERNAME;
          if (env.ZERODB_PASSWORD) process.env.ZERODB_PASSWORD = env.ZERODB_PASSWORD;
          if (env.ZERODB_PROJECT_ID) process.env.ZERODB_PROJECT_ID = env.ZERODB_PROJECT_ID;
          if (env.ZERODB_API_URL) process.env.ZERODB_API_URL = env.ZERODB_API_URL;
          console.error(`  Loaded credentials from ${candidatePath}`);
          foundInMcp = true;
          break;
        }
      } catch (_) {}
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Auto-provision a free ZeroDB instance if still no credentials
  if (!foundInMcp && !process.env.ZERODB_API_KEY && !process.env.ZERODB_USERNAME) {
    console.error('\n  No credentials found — provisioning a free ZeroDB instance...');
    try {
      const https = await import('https');
      const creds = await new Promise((resolve, reject) => {
        const body = JSON.stringify({ agree_terms: true });
        const req = https.default.request({
          hostname: 'api.ainative.studio',
          port: 443,
          path: '/api/v1/public/instant-db',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) resolve(JSON.parse(data));
            else reject(new Error(`HTTP ${res.statusCode}`));
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      process.env.ZERODB_API_KEY = creds.api_key;
      process.env.ZERODB_PROJECT_ID = creds.project_id;
      process.env.ZERODB_API_URL = 'https://api.ainative.studio';

      // Write .mcp.json so next run loads from file
      const mcpPath = join(process.cwd(), '.mcp.json');
      const mcpConfig = {
        mcpServers: {
          'ainative-memory': {
            command: 'npx',
            args: ['-y', 'ainative-memory-mcp'],
            env: {
              ZERODB_API_KEY: creds.api_key,
              ZERODB_PROJECT_ID: creds.project_id,
              ZERODB_API_URL: 'https://api.ainative.studio'
            }
          }
        }
      };
      let existing = {};
      if (existsSync(mcpPath)) { try { existing = JSON.parse(readFileSync(mcpPath, 'utf-8')); } catch (_) {} }
      writeFileSync(mcpPath, JSON.stringify({ ...existing, mcpServers: { ...(existing.mcpServers || {}), ...mcpConfig.mcpServers } }, null, 2) + '\n');

      // Append to .env
      const envPath = join(process.cwd(), '.env');
      const envBlock = `\n# ZeroDB (auto-provisioned by ainative-memory-mcp)\nZERODB_API_KEY=${creds.api_key}\nZERODB_PROJECT_ID=${creds.project_id}\nZERODB_API_URL=https://api.ainative.studio\n`;
      if (existsSync(envPath)) { if (!readFileSync(envPath, 'utf-8').includes('ZERODB_API_KEY')) appendFileSync(envPath, envBlock); }
      else writeFileSync(envPath, envBlock.trimStart());

      console.error(`  Auto-provisioned! Project: ${creds.project_id}`);
      console.error(`  API Key: ${creds.api_key.slice(0, 16)}...`);
      if (creds.expires_at) console.error(`  Expires: ${creds.expires_at}`);
      if (creds.claim_url) console.error(`  Claim your account: ${creds.claim_url}`);
      console.error(`  Saved to .mcp.json and .env\n`);
    } catch (provisionErr) {
      console.error(`  Auto-provision failed: ${provisionErr.message}`);
      console.error('  Get credentials: npx zerodb-cli init');
      console.error('  Or sign up: https://ainative.studio\n');
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// ZeroDB HTTP Client
// ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env.ZERODB_API_URL || 'https://api.ainative.studio';
const API_KEY = process.env.ZERODB_API_KEY;
const PROJECT_ID = process.env.ZERODB_PROJECT_ID;

// Auth header builder
function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  if (PROJECT_ID) headers['X-Project-ID'] = PROJECT_ID;
  return headers;
}

// Table names for structured storage
const ENTITIES_TABLE = 'kg_entities';
const RELATIONS_TABLE = 'kg_relations';

// ─────────────────────────────────────────────────────────────────
// ZeroDB-backed KnowledgeGraphManager
// Replaces local JSONL with ZeroDB NoSQL tables + vector embeddings
// ─────────────────────────────────────────────────────────────────

class KnowledgeGraphManager {
  constructor() {
    this._initialized = false;
  }

  async ensureTables() {
    if (this._initialized) return;
    try {
      // Create entities table if it doesn't exist
      await axios.post(`${BASE_URL}/api/v1/public/tables`, {
        table_name: ENTITIES_TABLE,
        schema: {
          name: 'string',
          entityType: 'string',
          observations: 'json'
        }
      }, { headers: authHeaders() }).catch(() => {});

      // Create relations table if it doesn't exist
      await axios.post(`${BASE_URL}/api/v1/public/tables`, {
        table_name: RELATIONS_TABLE,
        schema: {
          from_entity: 'string',
          to_entity: 'string',
          relationType: 'string'
        }
      }, { headers: authHeaders() }).catch(() => {});

      this._initialized = true;
    } catch (err) {
      console.error(`  [${SERVER_NAME}] Table init warning: ${err.message}`);
      this._initialized = true; // Don't block on table creation errors
    }
  }

  async loadGraph() {
    await this.ensureTables();
    const entities = [];
    const relations = [];

    try {
      // Load entities
      const entRes = await axios.post(`${BASE_URL}/api/v1/public/tables/${ENTITIES_TABLE}/query`, {
        limit: 10000
      }, { headers: authHeaders() });
      const entRows = entRes.data?.rows || entRes.data?.data || entRes.data || [];
      for (const row of (Array.isArray(entRows) ? entRows : [])) {
        entities.push({
          name: row.name,
          entityType: row.entityType || row.entity_type || '',
          observations: Array.isArray(row.observations) ? row.observations :
            (typeof row.observations === 'string' ? JSON.parse(row.observations) : [])
        });
      }
    } catch (err) {
      // Table may not exist yet or be empty — that's fine
      if (!String(err.message).includes('404') && !String(err.message).includes('not found')) {
        console.error(`  [${SERVER_NAME}] Load entities warning: ${err.message}`);
      }
    }

    try {
      // Load relations
      const relRes = await axios.post(`${BASE_URL}/api/v1/public/tables/${RELATIONS_TABLE}/query`, {
        limit: 10000
      }, { headers: authHeaders() });
      const relRows = relRes.data?.rows || relRes.data?.data || relRes.data || [];
      for (const row of (Array.isArray(relRows) ? relRows : [])) {
        relations.push({
          from: row.from_entity || row.from,
          to: row.to_entity || row.to,
          relationType: row.relationType || row.relation_type || ''
        });
      }
    } catch (err) {
      if (!String(err.message).includes('404') && !String(err.message).includes('not found')) {
        console.error(`  [${SERVER_NAME}] Load relations warning: ${err.message}`);
      }
    }

    return { entities, relations };
  }

  async saveEntity(entity) {
    await this.ensureTables();
    // Upsert entity row
    try {
      await axios.post(`${BASE_URL}/api/v1/public/tables/${ENTITIES_TABLE}/rows`, {
        rows: [{
          name: entity.name,
          entityType: entity.entityType,
          observations: JSON.stringify(entity.observations)
        }],
        upsert_key: 'name'
      }, { headers: authHeaders() });
    } catch (err) {
      console.error(`  [${SERVER_NAME}] Save entity error: ${err.message}`);
      throw err;
    }

    // Store vector embedding for semantic search via ZeroMemory
    try {
      const text = `${entity.name} (${entity.entityType}): ${entity.observations.join('. ')}`;
      await axios.post(`${BASE_URL}/api/v1/public/memory/v2/remember`, {
        content: text,
        metadata: {
          type: 'kg_entity',
          entity_name: entity.name,
          entity_type: entity.entityType,
          source: 'ainative-memory-mcp'
        },
        tags: ['kg_entity', entity.entityType, entity.name]
      }, { headers: authHeaders() });
    } catch (err) {
      // Non-fatal — entity is saved, just no embedding
      console.error(`  [${SERVER_NAME}] Embedding warning: ${err.message}`);
    }
  }

  async deleteEntityRow(entityName) {
    try {
      await axios.request({
        method: 'DELETE',
        url: `${BASE_URL}/api/v1/public/tables/${ENTITIES_TABLE}/rows`,
        headers: authHeaders(),
        data: { filter: { name: entityName } }
      });
    } catch (err) {
      console.error(`  [${SERVER_NAME}] Delete entity error: ${err.message}`);
    }
  }

  async deleteRelationRows(filter) {
    try {
      await axios.request({
        method: 'DELETE',
        url: `${BASE_URL}/api/v1/public/tables/${RELATIONS_TABLE}/rows`,
        headers: authHeaders(),
        data: { filter }
      });
    } catch (err) {
      console.error(`  [${SERVER_NAME}] Delete relation error: ${err.message}`);
    }
  }

  async saveRelation(relation) {
    await this.ensureTables();
    try {
      await axios.post(`${BASE_URL}/api/v1/public/tables/${RELATIONS_TABLE}/rows`, {
        rows: [{
          from_entity: relation.from,
          to_entity: relation.to,
          relationType: relation.relationType
        }],
        upsert_key: ['from_entity', 'to_entity', 'relationType']
      }, { headers: authHeaders() });
    } catch (err) {
      console.error(`  [${SERVER_NAME}] Save relation error: ${err.message}`);
      throw err;
    }
  }

  async createEntities(entities) {
    const graph = await this.loadGraph();
    const newEntities = entities.filter(e => !graph.entities.some(ex => ex.name === e.name));
    for (const entity of newEntities) {
      await this.saveEntity(entity);
    }
    return newEntities;
  }

  async createRelations(relations) {
    const graph = await this.loadGraph();
    const newRelations = relations.filter(r => !graph.relations.some(ex =>
      ex.from === r.from && ex.to === r.to && ex.relationType === r.relationType
    ));
    for (const relation of newRelations) {
      await this.saveRelation(relation);
    }
    return newRelations;
  }

  async addObservations(observations) {
    const graph = await this.loadGraph();
    const results = [];
    for (const o of observations) {
      const entity = graph.entities.find(e => e.name === o.entityName);
      if (!entity) {
        throw new Error(`Entity with name ${o.entityName} not found`);
      }
      const newObs = o.contents.filter(c => !entity.observations.includes(c));
      entity.observations.push(...newObs);
      await this.saveEntity(entity);
      results.push({ entityName: o.entityName, addedObservations: newObs });
    }
    return results;
  }

  async deleteEntities(entityNames) {
    for (const name of entityNames) {
      await this.deleteEntityRow(name);
      // Delete relations involving this entity
      await this.deleteRelationRows({ from_entity: name });
      await this.deleteRelationRows({ to_entity: name });
    }
  }

  async deleteObservations(deletions) {
    const graph = await this.loadGraph();
    for (const d of deletions) {
      const entity = graph.entities.find(e => e.name === d.entityName);
      if (entity) {
        entity.observations = entity.observations.filter(o => !d.observations.includes(o));
        await this.saveEntity(entity);
      }
    }
  }

  async deleteRelations(relations) {
    for (const r of relations) {
      await this.deleteRelationRows({
        from_entity: r.from,
        to_entity: r.to,
        relationType: r.relationType
      });
    }
  }

  async readGraph() {
    return this.loadGraph();
  }

  async searchNodes(query) {
    const graph = await this.loadGraph();
    const q = query.toLowerCase();

    const filteredEntities = graph.entities.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.entityType.toLowerCase().includes(q) ||
      e.observations.some(o => o.toLowerCase().includes(q))
    );

    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));

    const filteredRelations = graph.relations.filter(r =>
      filteredEntityNames.has(r.from) || filteredEntityNames.has(r.to)
    );

    return { entities: filteredEntities, relations: filteredRelations };
  }

  async openNodes(names) {
    const graph = await this.loadGraph();

    const filteredEntities = graph.entities.filter(e => names.includes(e.name));
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));

    const filteredRelations = graph.relations.filter(r =>
      filteredEntityNames.has(r.from) || filteredEntityNames.has(r.to)
    );

    return { entities: filteredEntities, relations: filteredRelations };
  }

  async searchNodesSemantic(query, limit = 10) {
    // Use ZeroMemory recall for vector similarity search
    try {
      const res = await axios.post(`${BASE_URL}/api/v1/public/memory/v2/recall`, {
        query: query,
        limit: limit,
        filter: {
          tags: ['kg_entity']
        }
      }, { headers: authHeaders() });

      const memories = res.data?.memories || res.data?.results || res.data || [];
      const entityNames = new Set();
      const scoredEntities = [];

      for (const mem of (Array.isArray(memories) ? memories : [])) {
        const name = mem.metadata?.entity_name;
        if (name) entityNames.add(name);
        scoredEntities.push({
          entity_name: name || 'unknown',
          entity_type: mem.metadata?.entity_type || '',
          similarity: mem.score || mem.similarity || 0,
          content_preview: (mem.content || '').slice(0, 200)
        });
      }

      // Load full entities for matched names
      const graph = await this.loadGraph();
      const matchedEntities = graph.entities.filter(e => entityNames.has(e.name));
      const matchedEntityNames = new Set(matchedEntities.map(e => e.name));
      const matchedRelations = graph.relations.filter(r =>
        matchedEntityNames.has(r.from) || matchedEntityNames.has(r.to)
      );

      return {
        entities: matchedEntities,
        relations: matchedRelations,
        semantic_matches: scoredEntities
      };
    } catch (err) {
      console.error(`  [${SERVER_NAME}] Semantic search error: ${err.message}`);
      // Fallback to text search
      const fallback = await this.searchNodes(query);
      return {
        ...fallback,
        semantic_matches: [],
        fallback: true,
        fallback_reason: err.message
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Tool definitions — all 9 original + 1 new semantic search
// ─────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'create_entities',
    description: 'Create multiple new entities in the knowledge graph. Entities are the fundamental nodes with a name, type, and list of observations. Stored in ZeroDB cloud — persists across sessions and devices.',
    inputSchema: {
      type: 'object',
      properties: {
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'The name of the entity' },
              entityType: { type: 'string', description: 'The type of the entity' },
              observations: {
                type: 'array',
                items: { type: 'string' },
                description: 'An array of observation contents associated with the entity'
              }
            },
            required: ['name', 'entityType', 'observations']
          },
          description: 'Array of entities to create'
        }
      },
      required: ['entities']
    }
  },
  {
    name: 'create_relations',
    description: 'Create multiple new relations between entities in the knowledge graph. Relations should be in active voice.',
    inputSchema: {
      type: 'object',
      properties: {
        relations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'The name of the entity where the relation starts' },
              to: { type: 'string', description: 'The name of the entity where the relation ends' },
              relationType: { type: 'string', description: 'The type of the relation' }
            },
            required: ['from', 'to', 'relationType']
          },
          description: 'Array of relations to create'
        }
      },
      required: ['relations']
    }
  },
  {
    name: 'add_observations',
    description: 'Add new observations to existing entities in the knowledge graph.',
    inputSchema: {
      type: 'object',
      properties: {
        observations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entityName: { type: 'string', description: 'The name of the entity to add observations to' },
              contents: {
                type: 'array',
                items: { type: 'string' },
                description: 'An array of observation contents to add'
              }
            },
            required: ['entityName', 'contents']
          },
          description: 'Array of observations to add'
        }
      },
      required: ['observations']
    }
  },
  {
    name: 'delete_entities',
    description: 'Delete multiple entities and their associated relations from the knowledge graph.',
    inputSchema: {
      type: 'object',
      properties: {
        entityNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'An array of entity names to delete'
        }
      },
      required: ['entityNames']
    }
  },
  {
    name: 'delete_observations',
    description: 'Delete specific observations from entities in the knowledge graph.',
    inputSchema: {
      type: 'object',
      properties: {
        deletions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entityName: { type: 'string', description: 'The name of the entity containing the observations' },
              observations: {
                type: 'array',
                items: { type: 'string' },
                description: 'An array of observations to delete'
              }
            },
            required: ['entityName', 'observations']
          },
          description: 'Array of deletions'
        }
      },
      required: ['deletions']
    }
  },
  {
    name: 'delete_relations',
    description: 'Delete multiple relations from the knowledge graph.',
    inputSchema: {
      type: 'object',
      properties: {
        relations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'The name of the entity where the relation starts' },
              to: { type: 'string', description: 'The name of the entity where the relation ends' },
              relationType: { type: 'string', description: 'The type of the relation' }
            },
            required: ['from', 'to', 'relationType']
          },
          description: 'Array of relations to delete'
        }
      },
      required: ['relations']
    }
  },
  {
    name: 'read_graph',
    description: 'Read the entire knowledge graph from ZeroDB cloud storage.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'search_nodes',
    description: 'Search for nodes in the knowledge graph based on a text query. Matches against entity names, types, and observation content (case-insensitive substring match).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query to match against entity names, types, and observation content' }
      },
      required: ['query']
    }
  },
  {
    name: 'open_nodes',
    description: 'Open specific nodes in the knowledge graph by their names.',
    inputSchema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'An array of entity names to retrieve'
        }
      },
      required: ['names']
    }
  },
  {
    name: 'search_nodes_semantic',
    description: 'Search for nodes in the knowledge graph using semantic vector similarity. Unlike search_nodes which does exact text matching, this finds entities by meaning — e.g., searching "machine learning frameworks" would find entities about "PyTorch" or "TensorFlow" even without those exact words.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language query to search by meaning' },
        limit: { type: 'number', description: 'Maximum number of results (default: 10)', default: 10 }
      },
      required: ['query']
    }
  }
];

// ─────────────────────────────────────────────────────────────────
// Tool execution router
// ─────────────────────────────────────────────────────────────────

async function executeTool(name, args, manager) {
  switch (name) {
    case 'create_entities':
      return await manager.createEntities(args.entities || []);
    case 'create_relations':
      return await manager.createRelations(args.relations || []);
    case 'add_observations':
      return await manager.addObservations(args.observations || []);
    case 'delete_entities':
      await manager.deleteEntities(args.entityNames || []);
      return { success: true, message: 'Entities deleted successfully' };
    case 'delete_observations':
      await manager.deleteObservations(args.deletions || []);
      return { success: true, message: 'Observations deleted successfully' };
    case 'delete_relations':
      await manager.deleteRelations(args.relations || []);
      return { success: true, message: 'Relations deleted successfully' };
    case 'read_graph':
      return await manager.readGraph();
    case 'search_nodes':
      return await manager.searchNodes(args.query || '');
    case 'open_nodes':
      return await manager.openNodes(args.names || []);
    case 'search_nodes_semantic':
      return await manager.searchNodesSemantic(args.query || '', args.limit || 10);
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Main server
// ─────────────────────────────────────────────────────────────────

async function main() {
  console.error('\n');
  console.error('  ███╗   ███╗███████╗███╗   ███╗');
  console.error('  ████╗ ████║██╔════╝████╗ ████║');
  console.error('  ██╔████╔██║█████╗  ██╔████╔██║');
  console.error('  ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║');
  console.error('  ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║');
  console.error('  ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝');
  console.error('\n  AINative Memory — Cloud Knowledge Graph');
  console.error('\n===========================================');
  console.error(`  Memory MCP Server v${PKG_VERSION}`);
  console.error('  Powered by ZeroDB + ZeroMemory');
  console.error('  Drop-in replacement for server-memory');
  console.error('===========================================\n');

  const manager = new KnowledgeGraphManager();

  // Verify connectivity
  let connected = false;
  if (API_KEY || process.env.ZERODB_USERNAME) {
    try {
      const graph = await manager.loadGraph();
      connected = true;
      console.error(`  Connected to ZeroDB (${BASE_URL})`);
      console.error(`  Graph: ${graph.entities.length} entities, ${graph.relations.length} relations`);
      console.error(`  All ${TOOLS.length} tools available (9 original + semantic search)\n`);
    } catch (err) {
      console.error(`  ZeroDB connection warning: ${err.message}`);
      console.error('  Tools will attempt to reconnect on each call\n');
    }
  } else {
    console.error('  No ZeroDB credentials — tools will return errors');
    console.error('  Get credentials: npx zerodb-cli init');
    console.error('  Or sign up: https://ainative.studio\n');
  }

  // Create MCP server
  const server = new Server(
    { name: SERVER_NAME, version: PKG_VERSION },
    { capabilities: { tools: {} } }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }));

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = TOOLS.find(t => t.name === name);

    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true
      };
    }

    try {
      const result = await executeTool(name, args || {}, manager);

      if (result === null) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Tool ${name} not implemented` }) }],
          isError: true
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (err) {
      console.error(`  [${SERVER_NAME}] Tool ${name} error:`, err.message);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: err.message,
            tool: name,
            hint: err.message.includes('credentials') || err.message.includes('401')
              ? 'Set ZERODB_API_KEY for full functionality. Get one free: npx zerodb-cli init'
              : undefined
          })
        }],
        isError: true
      };
    }
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`  MCP Server connected and ready (${TOOLS.length} tools)\n`);
}

// Graceful shutdown
process.on('SIGINT', () => { console.error('\n  Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.error('\n  Shutting down...'); process.exit(0); });

main().catch(err => {
  console.error(`[${SERVER_NAME}] Fatal error:`, err.message);
  console.error('\n  Get credentials: npx zerodb-cli init');
  console.error('  Or sign up: https://ainative.studio\n');
  process.exit(1);
});
