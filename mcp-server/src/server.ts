#!/usr/bin/env node
/**
 * Vialink MCP Server
 *
 * Expone los datos del transporte público de Barranquilla como tools
 * que cualquier cliente MCP (Claude Desktop, Claude Code, Cursor, etc)
 * puede invocar.
 *
 * Dos transportes soportados:
 *   - stdio  (default): para clientes locales (Claude Desktop)
 *     uso:  `node dist/server.js`
 *   - HTTP   (Streamable HTTP, MCP spec 2024-11-05+): para deploy cloud
 *     uso:  `node dist/server.js --http`
 *     env:  PORT (default 3333), VIALINK_API_URL
 *
 * En modo HTTP también expone:
 *   - GET /health      → healthcheck para Railway/k8s
 *   - POST /mcp        → endpoint MCP principal
 *
 * Configuración env vars:
 *   VIALINK_API_URL  URL base del backend Vialink (default localhost:3000)
 *   PORT             Puerto HTTP (Railway lo setea automático)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import express from 'express';
import cors from 'cors';
import { ALL_TOOLS } from './tools/index.js';

const SERVER_NAME = 'vialink-mcp';
const SERVER_VERSION = '0.1.0';

// ============================================================
// Server factory — crea una instancia con todos los handlers
// En HTTP stateless, creamos una nueva instancia por request
// ============================================================

function createMcpServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  // ListTools: cliente pregunta qué tools hay disponibles
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema, {
        $refStrategy: 'none',
      }) as Record<string, unknown>,
    })),
  }));

  // CallTool: cliente invoca un tool con args
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = ALL_TOOLS.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

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
        content: [{ type: 'text', text: `❌ ${name} failed: ${msg}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ============================================================
// stdio transport — para Claude Desktop / clientes locales
// ============================================================

async function startStdio() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr porque stdout es usado por el protocolo MCP
  console.error(
    `[${SERVER_NAME}] v${SERVER_VERSION} stdio mode. ${ALL_TOOLS.length} tools.`,
  );
  console.error(
    `[${SERVER_NAME}] Backend: ${process.env.VIALINK_API_URL ?? 'http://localhost:3000'}`,
  );
}

// ============================================================
// HTTP transport — para deploy en Railway/Vercel/Cloudflare
// Modo STATELESS: cada request crea nueva instancia de server+transport.
// Simple, sin manejo de sessions, escala horizontal sin pegamento.
// ============================================================

async function startHttp() {
  const app = express();

  // CORS abierto — el MCP es READ-ONLY y los endpoints del backend ya
  // tienen sus propias restricciones. Si en algún momento exponemos
  // tools de mutación, esto debe restringirse.
  app.use(cors({ origin: '*', exposedHeaders: ['Mcp-Session-Id'] }));
  app.use(express.json({ limit: '4mb' }));

  // Healthcheck para Railway / k8s / load balancers
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      server: SERVER_NAME,
      version: SERVER_VERSION,
      tools: ALL_TOOLS.length,
      backend: process.env.VIALINK_API_URL ?? 'http://localhost:3000',
      uptime_seconds: Math.round(process.uptime()),
    });
  });

  // Root → redirect a /health para diagnosis fácil
  app.get('/', (_req, res) => {
    res.redirect('/health');
  });

  // POST /mcp — endpoint principal MCP (Streamable HTTP)
  app.post('/mcp', async (req, res) => {
    try {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // GET /mcp y DELETE /mcp en stateless devuelven 405
  app.get('/mcp', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed in stateless mode. Use POST.' });
  });

  app.delete('/mcp', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed in stateless mode. Use POST.' });
  });

  // Listen en 0.0.0.0 para que Railway pueda enrutarle tráfico
  const port = Number(process.env.PORT) || 3333;
  app.listen(port, '0.0.0.0', () => {
    console.log(
      `[${SERVER_NAME}] v${SERVER_VERSION} HTTP listening on :${port}`,
    );
    console.log(
      `[${SERVER_NAME}] Backend: ${process.env.VIALINK_API_URL ?? 'http://localhost:3000'}`,
    );
    console.log(`[${SERVER_NAME}] ${ALL_TOOLS.length} tools registered.`);
    console.log(
      `[${SERVER_NAME}] Endpoints: GET /health · POST /mcp`,
    );
  });
}

// ============================================================
// Entry point
// ============================================================

const useHttp =
  process.argv.includes('--http') || process.env.MCP_HTTP === 'true';

async function main() {
  if (useHttp) {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] fatal:`, err);
  process.exit(1);
});
