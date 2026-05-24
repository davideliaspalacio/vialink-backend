#!/usr/bin/env node
/**
 * Vialink MCP Server
 *
 * Expone los datos del transporte público de Barranquilla como tools
 * que cualquier cliente MCP (Claude Desktop, Claude Code, Cursor, etc)
 * puede invocar.
 *
 * Dos transportes:
 *   - stdio: para clientes locales (Claude Desktop, MCP CLI)
 *     uso: `node dist/server.js`  (default)
 *   - HTTP+SSE: para deployment cloud (Cloudflare Workers, Railway, etc)
 *     uso: `node dist/server.js --http`
 *
 * Configuración:
 *   VIALINK_API_URL=http://localhost:3000  (default)
 *   PORT=3333                               (solo modo HTTP)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ALL_TOOLS } from './tools/index.js';

const SERVER_NAME = 'vialink-mcp';
const SERVER_VERSION = '0.1.0';

// ============================================================
// Server setup
// ============================================================

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ListTools: cliente pregunta qué tools hay disponibles
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema, {
        $refStrategy: 'none',
      }) as Record<string, unknown>,
    })),
  };
});

// CallTool: cliente invoca un tool con args
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  // Validar args con el zod schema del tool
  const parsed = tool.inputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ Invalid arguments for ${name}: ${JSON.stringify(parsed.error.issues)}`,
        },
      ],
      isError: true,
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool.handler as any)(parsed.data);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: 'text',
          text: `❌ ${name} failed: ${msg}`,
        },
      ],
      isError: true,
    };
  }
});

// ============================================================
// Transport selection
// ============================================================

const useHttp = process.argv.includes('--http');

async function main() {
  if (useHttp) {
    // HTTP+SSE transport para deployment cloud
    // (Implementación pendiente — para MVP usamos stdio)
    console.error(
      'HTTP transport not yet implemented. Use stdio (default) for now.',
    );
    process.exit(1);
  }

  // stdio: el caso default. Claude Desktop lanza el server como child
  // process y se comunica vía stdin/stdout.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[${SERVER_NAME}] v${SERVER_VERSION} listening on stdio. ${ALL_TOOLS.length} tools registered.`,
  );
  console.error(
    `[${SERVER_NAME}] Backend: ${process.env.VIALINK_API_URL ?? 'http://localhost:3000'}`,
  );
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] fatal:`, err);
  process.exit(1);
});
