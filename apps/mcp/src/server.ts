import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createApiClient } from './api.ts'
import { registerTools } from './tools.ts'

const server = new McpServer({ name: 'khronist', version: '0.0.0' })

registerTools(
  server,
  createApiClient({
    baseUrl: process.env.KHRONIST_API_URL || 'https://api.khronist.org',
    apiKey: process.env.KHRONIST_API_KEY || undefined,
  }),
)

await server.connect(new StdioServerTransport())
