import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { ApiFailure, type ApiClient, type SearchRequest } from '../src/api.ts'
import { registerTools, type ToolCall } from '../src/tools.ts'
import { transcription } from './fixtures.ts'

const unused = () => Promise.reject(new Error('not expected in this test'))

const connect = async (api: Partial<ApiClient>) => {
  const calls: ToolCall[] = []
  const server = new McpServer({ name: 'khronist', version: '0.0.0' })
  registerTools(server, { transcribe: unused, explain: unused, search: unused, ...api }, (call) => {
    calls.push(call)
  })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return { client, calls }
}

const textOf = (content: unknown): string => {
  const first: unknown = Array.isArray(content) ? content[0] : undefined
  return typeof first === 'object' && first !== null && 'text' in first ? String(first.text) : ''
}

describe('tools', () => {
  it('offers the three tools of the contract', async () => {
    const { client } = await connect({})
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'explain',
      'search_sources',
      'transcribe',
    ])
  })

  it('returns a reading with the shelfmark as a label and logs the call', async () => {
    const { client, calls } = await connect({ transcribe: async () => transcription })
    const result = await client.callTool({
      name: 'transcribe',
      arguments: { image_base64: 'cG5n' },
    })
    expect(result.structuredContent).toMatchObject({
      transcription_id: transcription.id,
      shelfmark: 'ЦДІАК України, ф. 127, оп. 1078, спр. 2276, зобр. 21',
    })
    expect(calls).toEqual([{ tool: 'transcribe', ms: expect.any(Number), ok: true }])
  })

  it('says "do not know" when the corpus has no sources', async () => {
    const { client } = await connect({
      explain: async () => ({ answer: null, reason: 'no_sources', citations: [] }),
    })
    const result = await client.callTool({
      name: 'explain',
      arguments: { kind: 'term', text: 'однодворецъ' },
    })
    expect(textOf(result.content)).toMatch(/^Не знаю/)
    expect(result.structuredContent).toMatchObject({ answer: null, citations: [] })
  })

  it('searches Commons and marks drafts', async () => {
    const received: SearchRequest[] = []
    const { client } = await connect({
      search: async (request) => {
        received.push(request)
        return {
          items: [
            {
              transcriptionId: transcription.id,
              shelfmark: {
                archive: 'ЦДІАК України',
                fond: '127',
                opys: '1078',
                sprava: '2276',
                image: 21,
              },
              yearFrom: 1884,
              snippet: 'Евтихій Михайловъ Кононенко',
              status: 'draft',
            },
          ],
        }
      },
    })
    const result = await client.callTool({
      name: 'search_sources',
      arguments: { query: 'Кононенко', limit: 5 },
    })
    expect(received).toEqual([{ query: 'Кононенко', verifiedOnly: undefined, limit: 5 }])
    expect(result.structuredContent).toMatchObject({
      items: [
        {
          transcription_id: transcription.id,
          shelfmark: 'ЦДІАК України, ф. 127, оп. 1078, спр. 2276, зобр. 21',
          year_from: 1884,
          status: 'draft',
        },
      ],
    })
    expect(textOf(result.content)).toMatch(/^Частина результатів — чернетки/)
  })

  it('turns an API failure into a tool error and logs it', async () => {
    const { client, calls } = await connect({
      transcribe: () =>
        Promise.reject(new ApiFailure(429, 'too_many_requests', 'Забагато запитів')),
    })
    const result = await client.callTool({
      name: 'transcribe',
      arguments: { image_base64: 'cG5n' },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('too_many_requests: Забагато запитів')
    expect(calls[0]).toMatchObject({ tool: 'transcribe', ok: false })
  })
})
