import {
  chatOutputSchema,
  isGroundedQuote,
  maxChatMessageLength,
  type ChatOutput,
  type ChatRequest,
  type ChatResponse,
} from '@khronist/contracts'
import { loadPrompt, loadProviderNotes, renderPrompt } from '@khronist/prompts'
import type { Config } from '../config.ts'
import type { Database } from '../db/client.ts'
import { ApiError } from '../lib/errors.ts'
import { chatBudgetShare, chatPrimaryLimitMs, chatTimeoutMs, maxChatTurns } from '../lib/limits.ts'
import {
  anyCaseConfidenceSchema,
  chunkCitationOf,
  promptChunksOf,
  recordOf,
  type FoundChunk,
  type TranscriptionRecord,
} from './answers.ts'
import type { CallBudget, LlmCallLog, LlmProvider } from './llm/index.ts'
import { createProvider, selectProvider, type ProviderFactory } from './llm/select.ts'
import { retrieve } from './retrieval.ts'

const modelOutputSchema = chatOutputSchema.extend({ confidence: anyCaseConfidenceSchema })

const maxOutputTokens = 2048
const maxFollowups = 3
const markerPattern = /\[(\d+)\]/g

type Message = ChatRequest['messages'][number]
type ChatCitation = ChatResponse['citations'][number]
type ModelCitation = ChatOutput['citations'][number]

type ModelInput = {
  messages: Message[]
  period: string | undefined
  record: TranscriptionRecord | null
  chunks: FoundChunk[]
}

const unavailable = () => new ApiError(503, 'reader_unavailable', 'Чат тимчасово недоступний')

export const marksEveryCitation = (answer: string, citations: number): boolean => {
  const markers = new Set([...answer.matchAll(markerPattern)].map((match) => Number(match[1])))
  return (
    citations > 0 &&
    markers.size === citations &&
    [...markers].every((marker) => marker >= 1 && marker <= citations)
  )
}

const citationOf = (
  cited: ModelCitation,
  chunks: Map<string, FoundChunk>,
  record: TranscriptionRecord | null,
): ChatCitation | undefined => {
  const quote = cited.quote.trim()
  if (cited.source === 'record') {
    return record && isGroundedQuote(quote, record.text)
      ? { kind: 'record', transcriptionId: record.transcriptionId, quote }
      : undefined
  }
  const chunk = chunks.get(cited.chunkId)
  return chunk && isGroundedQuote(quote, chunk.text) ? chunkCitationOf(chunk, quote) : undefined
}

const citationsOf = (
  output: ChatOutput,
  chunks: FoundChunk[],
  record: TranscriptionRecord | null,
) => {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  const citations: ChatCitation[] = []
  for (const cited of output.citations) {
    const citation = citationOf(cited, byId, record)
    if (!citation) return undefined
    citations.push(citation)
  }
  return citations
}

const followupsOf = (output: ChatOutput) =>
  output.followups
    .map((question) => question.trim())
    .filter((question) => question.length > 0 && question.length <= maxChatMessageLength)
    .slice(0, maxFollowups)

const answerOf = (
  output: ChatOutput,
  chunks: FoundChunk[],
  record: TranscriptionRecord | null,
): ChatResponse => {
  const trimmed = output.answer?.trim()
  const answer = trimmed && trimmed.length <= maxChatMessageLength ? trimmed : undefined
  const citations = answer ? citationsOf(output, chunks, record) : undefined
  const followups = followupsOf(output)
  return answer && citations && marksEveryCitation(answer, citations.length)
    ? { answer, confidence: output.confidence, citations, followups }
    : { answer: null, reason: 'no_sources', citations: [], followups }
}

const recentMessages = (messages: Message[]) => {
  const recent = messages.slice(-maxChatTurns)
  return recent.slice(recent.findIndex((message) => message.role === 'user'))
}

const searchTextOf = (messages: Message[]) =>
  messages
    .filter((message) => message.role === 'user')
    .slice(-2)
    .reverse()
    .map((message) => message.content)
    .join(' ')

type ChatDeps = {
  db: Database
  llm: LlmProvider | undefined
  budget: CallBudget
  minRank: number
}

export type ChatResponder = (request: ChatRequest, log?: LlmCallLog) => Promise<ChatResponse>

export const createChatResponder = ({ db, llm, budget, minRank }: ChatDeps): ChatResponder => {
  const prompt = loadPrompt('chat')

  const ask = async (input: ModelInput, log?: LlmCallLog) => {
    if (!llm || !(await budget.available(chatBudgetShare))) return undefined
    const text = renderPrompt(prompt.user, {
      period: input.period ?? 'unknown',
      record: JSON.stringify(input.record?.text ?? null),
      chunks: promptChunksOf(input.chunks),
      messages: JSON.stringify(input.messages),
    })
    const startedAt = Date.now()
    try {
      const { value, model, usage } = await llm.complete({
        system: prompt.system,
        content: [{ type: 'text', text }],
        schema: modelOutputSchema,
        maxTokens: maxOutputTokens,
        signal: AbortSignal.timeout(chatTimeoutMs),
        log,
      })
      log?.info({ model, usage, durationMs: Date.now() - startedAt }, 'chat answered')
      return value
    } catch (error) {
      log?.warn({ err: error }, 'chat model failed')
      return undefined
    }
  }

  return async (request, log) => {
    const messages = recentMessages(request.messages)
    const { transcriptionId, period } = request.context ?? {}
    const [record, found] = await Promise.all([
      recordOf(db, transcriptionId),
      retrieve(db, { text: searchTextOf(messages), period }, minRank),
    ])
    if (!record && !found.confident) {
      return { answer: null, reason: 'no_sources', citations: [], followups: [] }
    }
    const chunks = found.confident ? found.chunks : []
    const output = await ask({ messages, period, record, chunks }, log)
    if (!output) throw unavailable()
    return answerOf(output, chunks, record)
  }
}

export const selectChatResponder = (
  config: Config,
  db: Database,
  budget: CallBudget,
  makeProvider: ProviderFactory = createProvider,
): ChatResponder => {
  const llm = config.LLM_FIXTURES
    ? undefined
    : selectProvider(
        config,
        budget,
        {
          primary: config.LLM_MODEL_PRIMARY,
          fallback: config.LLM_MODEL_FALLBACK,
          effort: config.LLM_EFFORT,
          primaryLimitMs: chatPrimaryLimitMs,
          geminiNotes: loadProviderNotes('chat', 'gemini'),
        },
        makeProvider,
      )
  return createChatResponder({ db, llm, budget, minRank: config.RETRIEVAL_MIN_RANK })
}
