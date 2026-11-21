import crypto from 'node:crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import type {
  BluesMindsVerificationResult,
  DiscoveredModel,
  LLMCallLog,
} from '../../shared/types.ts';

const DEFAULT_BASE_URL = 'https://api.bluesminds.com/v1';
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TRANSIENT_RETRIES = 2;

const callLogs: LLMCallLog[] = [];
let lastVerificationResult: BluesMindsVerificationResult | null = null;
let runtimeSelectedModel: string | null = null;

export function getBluesMindsBaseUrl(): string {
  const raw = (process.env.BLUESMINDS_BASE_URL || DEFAULT_BASE_URL).trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return DEFAULT_BASE_URL;
    }
    return raw.replace(/\/+$/, '');
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function getConfiguredBluesMindsModel(): string | null {
  const fromEnv = process.env.BLUESMINDS_MODEL?.trim();
  if (fromEnv) return fromEnv;
  if (runtimeSelectedModel) return runtimeSelectedModel;
  return null;
}

export function setRuntimeSelectedModel(modelId: string | null): void {
  runtimeSelectedModel = modelId ? modelId.trim() : null;
}

export function isBluesMindsConfigured(): boolean {
  return Boolean(process.env.BLUESMINDS_API_KEY?.trim());
}

export function getRecentLLMLogs(): LLMCallLog[] {
  return [...callLogs];
}

export function getLastVerificationResult(): BluesMindsVerificationResult | null {
  return lastVerificationResult;
}

function recordLLMLog(entry: LLMCallLog): void {
  callLogs.unshift(entry);
  if (callLogs.length > 40) {
    callLogs.length = 40;
  }
  // Safe server-side metadata log — NEVER log API keys or transcript contents
  console.info(
    `[BluesMinds] op=${entry.operation} model=${entry.model} status=${entry.status} latency=${entry.latencyMs}ms tokens=${entry.totalTokens ?? 'n/a'} repair=${entry.repairAttempted}${entry.errorCode ? ` err=${entry.errorCode}` : ''}`
  );
}

function createClient(): OpenAI {
  const apiKey = process.env.BLUESMINDS_API_KEY?.trim();
  if (!apiKey) {
    throw new BluesMindsError(
      'BLUESMINDS_API_KEY is not configured in server environment secrets.',
      'MISSING_API_KEY',
      401,
      false
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: getBluesMindsBaseUrl(),
    timeout: DEFAULT_TIMEOUT_MS,
    maxRetries: 0, // Managed explicitly so auth/model errors are never retried blindly
  });
}

export class BluesMindsError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, code: string, status?: number, retryable = false) {
    super(message);
    this.name = 'BluesMindsError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function classifyProviderError(err: unknown): BluesMindsError {
  if (err instanceof BluesMindsError) return err;

  const anyErr = err as {
    status?: number;
    code?: string;
    message?: string;
    name?: string;
    error?: { message?: string; code?: string };
  };
  const status = typeof anyErr?.status === 'number' ? anyErr.status : undefined;
  const rawMessage =
    anyErr?.error?.message || anyErr?.message || 'Unknown BluesMinds API error';
  // Scrub any accidental bearer tokens from error strings
  const safeMessage = rawMessage.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');

  if (anyErr?.name === 'AbortError' || anyErr?.name === 'APIConnectionTimeoutError') {
    return new BluesMindsError(
      `BluesMinds request timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
      'TIMEOUT',
      408,
      true
    );
  }

  // Never retry authentication, authorization, bad request, or invalid model errors
  if (status === 401 || status === 403) {
    return new BluesMindsError(
      `BluesMinds authentication failed (HTTP ${status}): ${safeMessage}`,
      'AUTH_ERROR',
      status,
      false
    );
  }

  if (status === 400 || status === 404 || status === 422) {
    return new BluesMindsError(
      `BluesMinds rejected the request or model (HTTP ${status}): ${safeMessage}`,
      'INVALID_REQUEST_OR_MODEL',
      status,
      false
    );
  }

  // Retry only rate limits and transient 5xx server failures
  if (status === 429) {
    return new BluesMindsError(
      `BluesMinds rate limit reached (HTTP 429): ${safeMessage}`,
      'RATE_LIMITED',
      429,
      true
    );
  }

  if (status && status >= 500 && status <= 599) {
    return new BluesMindsError(
      `BluesMinds temporary server error (HTTP ${status}): ${safeMessage}`,
      'SERVER_ERROR',
      status,
      true
    );
  }

  return new BluesMindsError(safeMessage, anyErr?.code || 'PROVIDER_ERROR', status, false);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function isResponseFormatUnsupported(err: BluesMindsError): boolean {
  if (err.status !== 400 && err.status !== 422) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('response_format') ||
    msg.includes('json_object') ||
    msg.includes('json_schema') ||
    msg.includes('structured')
  );
}

async function requestCompletionWithRetries(params: {
  client: OpenAI;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  useJsonFormat: boolean;
  temperature: number;
  timeoutMs: number;
}): Promise<{
  content: string;
  actualModel: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}> {
  let attempt = 0;
  let useJson = params.useJsonFormat;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);

    try {
      const completion = await params.client.chat.completions.create(
        {
          model: params.model,
          messages: params.messages,
          temperature: params.temperature,
          ...(useJson ? { response_format: { type: 'json_object' } } : {}),
        },
        { signal: controller.signal }
      );
      clearTimeout(timer);

      const content = completion.choices?.[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new BluesMindsError(
          'BluesMinds returned an empty completion content.',
          'EMPTY_RESPONSE',
          502,
          true
        );
      }

      return {
        content,
        actualModel: completion.model || params.model,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined,
      };
    } catch (rawErr) {
      clearTimeout(timer);
      const classified = classifyProviderError(rawErr);

      // Graceful downgrade if the specific model rejects response_format: json_object
      if (useJson && isResponseFormatUnsupported(classified)) {
        useJson = false;
        continue;
      }

      if (classified.retryable && attempt < MAX_TRANSIENT_RETRIES) {
        attempt += 1;
        const jitter = Math.floor(Math.random() * 250);
        const backoff = 600 * Math.pow(2, attempt - 1) + jitter;
        await sleep(backoff);
        continue;
      }

      throw classified;
    }
  }
}

export interface CallLLMOptions<T extends z.ZodTypeAny> {
  system: string;
  prompt: string;
  schema: T;
  operation?: string;
  modelOverride?: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface CallLLMResult<T> {
  data: T;
  modelUsed: string;
  latencyMs: number;
  repairAttempted: boolean;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export async function callLLM<T extends z.ZodTypeAny>(
  options: CallLLMOptions<T>
): Promise<CallLLMResult<z.infer<T>>> {
  const startedAt = Date.now();
  const operation = options.operation || 'structured_call';
  const model = options.modelOverride?.trim() || getConfiguredBluesMindsModel();

  if (!model) {
    throw new BluesMindsError(
      'BLUESMINDS_MODEL is not configured. Run Model Discovery in Settings or set BLUESMINDS_MODEL in server Secrets.',
      'MISSING_MODEL',
      400,
      false
    );
  }

  const client = createClient();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const temperature = options.temperature ?? 0.1;

  let repairAttempted = false;
  let actualModelUsed = model;
  let totalUsage:
    | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
    | undefined;

  try {
    const first = await requestCompletionWithRetries({
      client,
      model,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.prompt },
      ],
      useJsonFormat: true,
      temperature,
      timeoutMs,
    });

    actualModelUsed = first.actualModel;
    totalUsage = first.usage;

    const firstValidation = parseAndValidate(first.content, options.schema);
    if (firstValidation.ok) {
      const latencyMs = Date.now() - startedAt;
      recordLLMLog({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        operation,
        model: actualModelUsed,
        status: 'success',
        latencyMs,
        promptTokens: totalUsage?.promptTokens,
        completionTokens: totalUsage?.completionTokens,
        totalTokens: totalUsage?.totalTokens,
        repairAttempted: false,
      });
      return {
        data: firstValidation.data,
        modelUsed: actualModelUsed,
        latencyMs,
        repairAttempted: false,
        usage: totalUsage,
      };
    }

    // Exactly ONE repair retry for malformed JSON or Zod validation failure
    repairAttempted = true;
    const repairPrompt = [
      'Your previous response did not match the required JSON schema.',
      `Validation error: ${firstValidation.errorSummary}`,
      'Return ONLY a single valid JSON object conforming strictly to the schema. No markdown fences, no commentary.',
      'Previous invalid response (truncated for repair):',
      first.content.slice(0, 6000),
    ].join('\n\n');

    const repaired = await requestCompletionWithRetries({
      client,
      model,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: repairPrompt },
      ],
      useJsonFormat: true,
      temperature: 0,
      timeoutMs,
    });

    actualModelUsed = repaired.actualModel;
    if (repaired.usage) {
      totalUsage = {
        promptTokens: (totalUsage?.promptTokens || 0) + (repaired.usage.promptTokens || 0),
        completionTokens:
          (totalUsage?.completionTokens || 0) + (repaired.usage.completionTokens || 0),
        totalTokens: (totalUsage?.totalTokens || 0) + (repaired.usage.totalTokens || 0),
      };
    }

    const secondValidation = parseAndValidate(repaired.content, options.schema);
    if (!secondValidation.ok) {
      throw new BluesMindsError(
        `Structured JSON validation failed after repair retry: ${secondValidation.errorSummary}`,
        'SCHEMA_VALIDATION_FAILED',
        502,
        false
      );
    }

    const latencyMs = Date.now() - startedAt;
    recordLLMLog({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      operation,
      model: actualModelUsed,
      status: 'success',
      latencyMs,
      promptTokens: totalUsage?.promptTokens,
      completionTokens: totalUsage?.completionTokens,
      totalTokens: totalUsage?.totalTokens,
      repairAttempted: true,
    });

    return {
      data: secondValidation.data,
      modelUsed: actualModelUsed,
      latencyMs,
      repairAttempted: true,
      usage: totalUsage,
    };
  } catch (err) {
    const classified = classifyProviderError(err);
    const latencyMs = Date.now() - startedAt;
    recordLLMLog({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      operation,
      model: actualModelUsed,
      status: 'error',
      latencyMs,
      promptTokens: totalUsage?.promptTokens,
      completionTokens: totalUsage?.completionTokens,
      totalTokens: totalUsage?.totalTokens,
      repairAttempted,
      errorCode: classified.code,
      errorMessage: classified.message,
    });
    throw classified;
  }
}

function parseAndValidate<T extends z.ZodTypeAny>(
  rawContent: string,
  schema: T
): { ok: true; data: z.infer<T> } | { ok: false; errorSummary: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonString(rawContent));
  } catch (e) {
    return {
      ok: false,
      errorSummary: `Malformed JSON: ${(e as Error).message}`,
    };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const summary = result.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, errorSummary: summary };
  }

  return { ok: true, data: result.data };
}

function scoreModelSuitability(modelId: string): { recommended: boolean; notes: string } {
  const lower = modelId.toLowerCase();
  if (
    lower.includes('embed') ||
    lower.includes('whisper') ||
    lower.includes('tts') ||
    lower.includes('dall-e') ||
    lower.includes('image') ||
    lower.includes('moderation')
  ) {
    return {
      recommended: false,
      notes: 'Non-chat utility model — not suitable for transcript extraction.',
    };
  }
  if (
    lower.includes('mini') ||
    lower.includes('flash') ||
    lower.includes('haiku') ||
    lower.includes('4o') ||
    lower.includes('sonnet') ||
    lower.includes('deepseek-chat') ||
    lower.includes('qwen') ||
    lower.includes('llama-3.3') ||
    lower.includes('gpt-4.1') ||
    lower.includes('gpt-5')
  ) {
    return {
      recommended: true,
      notes: 'Chat model well-suited for structured JSON extraction and cost-efficient long transcripts.',
    };
  }
  return {
    recommended: false,
    notes: 'Available chat model — verify JSON formatting and latency before production use.',
  };
}

export async function discoverBluesMindsModels(): Promise<{
  baseUrl: string;
  models: DiscoveredModel[];
  recommendedModel: string | null;
}> {
  const apiKey = process.env.BLUESMINDS_API_KEY?.trim();
  const baseUrl = getBluesMindsBaseUrl();

  if (!apiKey) {
    throw new BluesMindsError(
      'BLUESMINDS_API_KEY is not configured in server environment secrets.',
      'MISSING_API_KEY',
      401,
      false
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const bodyText = (await res.text().catch(() => '')).slice(0, 300);
      throw new BluesMindsError(
        `Model discovery failed (HTTP ${res.status}): ${bodyText || res.statusText}`,
        res.status === 401 || res.status === 403 ? 'AUTH_ERROR' : 'DISCOVERY_ERROR',
        res.status,
        false
      );
    }

    const json = (await res.json()) as {
      data?: Array<{ id?: string; owned_by?: string; created?: number }>;
    };
    const rawList = Array.isArray(json?.data) ? json.data : [];

    const models: DiscoveredModel[] = rawList
      .filter((m): m is { id: string; owned_by?: string; created?: number } =>
        Boolean(m && typeof m.id === 'string')
      )
      .map((m) => {
        const evalResult = scoreModelSuitability(m.id);
        return {
          id: m.id,
          ownedBy: m.owned_by,
          created: m.created,
          recommended: evalResult.recommended,
          notes: evalResult.notes,
        };
      })
      .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.id.localeCompare(b.id));

    const recommendedModel = models.find((m) => m.recommended)?.id || models[0]?.id || null;
    return { baseUrl, models, recommendedModel };
  } catch (err) {
    clearTimeout(timer);
    throw classifyProviderError(err);
  }
}

const VerificationTestSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  echo: z.string().min(1),
});

export async function verifyBluesMindsConnection(
  modelOverride?: string
): Promise<BluesMindsVerificationResult> {
  const baseUrl = getBluesMindsBaseUrl();
  const configuredModel = modelOverride?.trim() || getConfiguredBluesMindsModel();
  const timestamp = new Date().toISOString();

  const steps: BluesMindsVerificationResult['steps'] = [
    { step: 1, name: 'API key configuration', status: 'skipped', detail: 'Pending' },
    { step: 2, name: 'Model discovery & accessibility', status: 'skipped', detail: 'Pending' },
    { step: 3, name: 'Small test prompt execution', status: 'skipped', detail: 'Pending' },
    { step: 4, name: 'Structured JSON & Zod validation', status: 'skipped', detail: 'Pending' },
    { step: 5, name: 'Record actual model ID', status: 'skipped', detail: 'Pending' },
  ];

  // Step 1: API key check
  if (!isBluesMindsConfigured()) {
    steps[0] = {
      step: 1,
      name: 'API key configuration',
      status: 'fail',
      detail: 'BLUESMINDS_API_KEY is missing from server environment secrets.',
    };
    const result: BluesMindsVerificationResult = {
      verified: false,
      timestamp,
      baseUrl,
      configuredModel,
      actualModelUsed: null,
      latencyMs: null,
      steps,
      error: 'BLUESMINDS_API_KEY is not configured. Add it in Settings -> Secrets and retry.',
    };
    lastVerificationResult = result;
    return result;
  }

  steps[0] = {
    step: 1,
    name: 'API key configuration',
    status: 'pass',
    detail: 'BLUESMINDS_API_KEY is present on the server.',
  };

  // Step 2: Model discovery & accessibility
  let selectedModel = configuredModel;
  try {
    const discovery = await discoverBluesMindsModels();
    if (discovery.models.length === 0) {
      steps[1] = {
        step: 2,
        name: 'Model discovery & accessibility',
        status: 'fail',
        detail: 'BluesMinds /v1/models returned zero accessible models.',
      };
      const result: BluesMindsVerificationResult = {
        verified: false,
        timestamp,
        baseUrl,
        configuredModel,
        actualModelUsed: null,
        latencyMs: null,
        steps,
        error: 'No models were returned by GET /v1/models for this API key.',
      };
      lastVerificationResult = result;
      return result;
    }

    if (selectedModel) {
      const exact = discovery.models.find((m) => m.id === selectedModel);
      if (!exact) {
        steps[1] = {
          step: 2,
          name: 'Model discovery & accessibility',
          status: 'fail',
          detail: `Configured model "${selectedModel}" was not found in the ${discovery.models.length} models accessible on your BluesMinds account.`,
        };
        const result: BluesMindsVerificationResult = {
          verified: false,
          timestamp,
          baseUrl,
          configuredModel,
          actualModelUsed: null,
          latencyMs: null,
          steps,
          error: `Model "${selectedModel}" is not available on this BluesMinds account. Available sample: ${discovery.models
            .slice(0, 5)
            .map((m) => m.id)
            .join(', ')}`,
        };
        lastVerificationResult = result;
        return result;
      }
      steps[1] = {
        step: 2,
        name: 'Model discovery & accessibility',
        status: 'pass',
        detail: `Confirmed "${selectedModel}" is accessible (${discovery.models.length} total models discovered).`,
      };
    } else {
      selectedModel = discovery.recommendedModel;
      if (selectedModel) {
        setRuntimeSelectedModel(selectedModel);
      }
      steps[1] = {
        step: 2,
        name: 'Model discovery & accessibility',
        status: 'pass',
        detail: `Discovered ${discovery.models.length} models; selected "${selectedModel}" for verification.`,
      };
    }
  } catch (err) {
    const classified = classifyProviderError(err);
    steps[1] = {
      step: 2,
      name: 'Model discovery & accessibility',
      status: 'fail',
      detail: classified.message,
    };
    const result: BluesMindsVerificationResult = {
      verified: false,
      timestamp,
      baseUrl,
      configuredModel,
      actualModelUsed: null,
      latencyMs: null,
      steps,
      error: classified.message,
    };
    lastVerificationResult = result;
    return result;
  }

  // Steps 3, 4, 5: Send small test prompt & validate structured JSON with Zod
  try {
    const callResult = await callLLM({
      operation: 'api_verification',
      modelOverride: selectedModel || undefined,
      system:
        'You are a connectivity verifier. Return ONLY a JSON object with keys: "status" ("ok"), "service" ("followthrough"), and "echo" ("verified").',
      prompt: 'Respond with the exact verification JSON object.',
      schema: VerificationTestSchema,
      temperature: 0,
      timeoutMs: 20_000,
    });

    steps[2] = {
      step: 3,
      name: 'Small test prompt execution',
      status: 'pass',
      detail: `Received response in ${callResult.latencyMs}ms.`,
    };
    steps[3] = {
      step: 4,
      name: 'Structured JSON & Zod validation',
      status: 'pass',
      detail: `Validated JSON payload (status="${callResult.data.status}", service="${callResult.data.service}").`,
    };
    steps[4] = {
      step: 5,
      name: 'Record actual model ID',
      status: 'pass',
      detail: `Recorded active model ID: ${callResult.modelUsed}`,
    };

    const result: BluesMindsVerificationResult = {
      verified: true,
      timestamp,
      baseUrl,
      configuredModel: selectedModel,
      actualModelUsed: callResult.modelUsed,
      latencyMs: callResult.latencyMs,
      tokenUsage: callResult.usage,
      steps,
    };
    lastVerificationResult = result;
    return result;
  } catch (err) {
    const classified = classifyProviderError(err);
    const failedAtValidation = classified.code === 'SCHEMA_VALIDATION_FAILED';
    steps[2] = {
      step: 3,
      name: 'Small test prompt execution',
      status: failedAtValidation ? 'pass' : 'fail',
      detail: failedAtValidation
        ? 'Received provider response, but JSON schema validation failed.'
        : classified.message,
    };
    steps[3] = {
      step: 4,
      name: 'Structured JSON & Zod validation',
      status: failedAtValidation ? 'fail' : 'skipped',
      detail: failedAtValidation ? classified.message : 'Skipped due to request failure.',
    };
    steps[4] = {
      step: 5,
      name: 'Record actual model ID',
      status: 'skipped',
      detail: 'Skipped until test prompt succeeds.',
    };

    const result: BluesMindsVerificationResult = {
      verified: false,
      timestamp,
      baseUrl,
      configuredModel: selectedModel,
      actualModelUsed: null,
      latencyMs: null,
      steps,
      error: classified.message,
    };
    lastVerificationResult = result;
    return result;
  }
}
