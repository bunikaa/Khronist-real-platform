import {
  explainOutputSchema,
  isGroundedQuote,
  type Citation,
  type ExplainOutput,
  type ExplainRequest,
  type ExplainResponse,
} from '@khronist/contracts'
import { loadPrompt, loadProviderNotes, renderPrompt } from '@khronist/prompts'
import type { Config } from '../config.ts'
import type { Database } from '../db/client.ts'
import { ApiError } from '../lib/errors.ts'
import { explainBudgetShare, explainPrimaryLimitMs, explainTimeoutMs } from '../lib/limits.ts'
import {
  anyCaseConfidenceSchema,
  chunkCitationOf,
  promptChunksOf,
  recordOf,
  type FoundChunk,
} from './answers.ts'
import { describeDate } from './calendar.ts'
import type { CallBudget, LlmCallLog, LlmProvider } from './llm/index.ts'
import { createProvider, selectProvider, type ProviderFactory } from './llm/select.ts'
import { retrieve, type RetrievalQuery } from './retrieval.ts'

const modelOutputSchema = explainOutputSchema.extend({ confidence: anyCaseConfidenceSchema })

const chunkTypeOf: Record<ExplainRequest['kind'], RetrievalQuery['type']> = {
  term: undefined,
  entity: undefined,
  place: 'place',
  date: 'date',
}

const maxOutputTokens = 2048

const unavailable = () => new ApiError(503, 'reader_unavailable', 'Пояснення тимчасово недоступне')

const citationsOf = (output: ExplainOutput, chunks: FoundChunk[]): Citation[] | undefined => {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  const citations: Citation[] = []
  for (const { chunkId, quote } of output.citations) {
    const chunk = byId.get(chunkId)
    if (!chunk || !isGroundedQuote(quote, chunk.text)) return undefined
    citations.push(chunkCitationOf(chunk, quote.trim()))
  }
  return citations.length > 0 ? citations : undefined
}

const answerOf = (output: ExplainOutput, chunks: FoundChunk[]) => {
  const answer = output.answer?.trim()
  const citations = answer ? citationsOf(output, chunks) : undefined
  return answer && citations
    ? { answer, confidence: output.confidence, citations }
    : { answer: null, reason: 'no_sources' as const, citations: [] }
}

type ExplainDeps = {
  db: Database
  llm: LlmProvider | undefined
  budget: CallBudget
  minRank: number
}

export type Explainer = (request: ExplainRequest, log?: LlmCallLog) => Promise<ExplainResponse>

export const createExplainer = ({ db, llm, budget, minRank }: ExplainDeps): Explainer => {
  const prompt = loadPrompt('explain')

  const ask = async (request: ExplainRequest, found: FoundChunk[], log?: LlmCallLog) => {
    if (!llm || !(await budget.available(explainBudgetShare))) return undefined
    const record = await recordOf(db, request.context?.transcriptionId)
    const text = renderPrompt(prompt.user, {
      kind: request.kind,
      text: JSON.stringify(request.text),
      period: request.context?.period ?? 'unknown',
      record: JSON.stringify(record?.text ?? null),
      chunks: promptChunksOf(found),
    })
    try {
      const { value } = await llm.complete({
        system: prompt.system,
        content: [{ type: 'text', text }],
        schema: modelOutputSchema,
        maxTokens: maxOutputTokens,
        signal: AbortSignal.timeout(explainTimeoutMs),
        log,
      })
      return value
    } catch (error) {
      log?.warn({ err: error }, 'explain model failed')
      return undefined
    }
  }

  return async (request, log) => {
    const date = request.kind === 'date' ? describeDate(request.text) : undefined
    const withDate = date ? { date } : {}
    const query = {
      text: request.text,
      type: chunkTypeOf[request.kind],
      period: request.context?.period,
    }
    const found = await retrieve(db, query, minRank)
    if (!found.confident) return { answer: null, reason: 'no_sources', citations: [], ...withDate }
    const output = await ask(request, found.chunks, log)
    if (output) return { ...answerOf(output, found.chunks), ...withDate }
    if (date) return { answer: null, citations: [], date }
    throw unavailable()
  }
}

export const selectExplainer = (
  config: Config,
  db: Database,
  budget: CallBudget,
  makeProvider: ProviderFactory = createProvider,
): Explainer => {
  const llm = config.LLM_FIXTURES
    ? undefined
    : selectProvider(
        config,
        budget,
        {
          primary: config.LLM_MODEL_PRIMARY,
          fallback: config.LLM_MODEL_FALLBACK,
          effort: config.LLM_EFFORT,
          primaryLimitMs: explainPrimaryLimitMs,
          geminiNotes: loadProviderNotes('explain', 'gemini'),
        },
        makeProvider,
      )
  return createExplainer({ db, llm, budget, minRank: config.RETRIEVAL_MIN_RANK })
}
