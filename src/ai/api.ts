import { useStore } from '../store/useStore';
import { currentSignal, isAbortError } from './abort';
import type { AgentSlot } from '../store/useStore';

// ---------- Shared message / tool types ----------

export interface ToolDef {
  name: string;
  description: string;
  parameters: any; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

// A provider sometimes emits tool-call arguments that are not valid JSON
// (constrained-grammar glitches, truncation). Silently substituting {} made
// the tool run with EMPTY args — e.g. clear_graph executing for real while the
// model believed it had passed a node list. Instead the parse failure is
// marked so the agent loop can return a tool-result ERROR and let the model
// resend the call.
export const MALFORMED_TOOL_ARGS_KEY = '__malformed_tool_args__';
export function isMalformedToolArgs(args: any): boolean {
  return !!args && typeof args === 'object' && MALFORMED_TOOL_ARGS_KEY in args;
}

export type AgentMessage =
  | { role: 'system' | 'user'; content: string; imageDataUrl?: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ModelTurn {
  text: string | null;
  toolCalls: ToolCall[];
  // True when the provider cut the response at the output-token limit — later
  // tool calls (typically `connect` after a big `add_nodes`) never arrived.
  truncated?: boolean;
}

// Output ceiling: generous enough to avoid truncating large graphs mid-`edges`.
// The primary defense against truncation is the reasoning-field diet in the
// system prompt (keep the plan to 1-2 sentences); this ceiling is the secondary
// safety margin for genuinely large multi-part builds. It is only a CAP, not a
// charge — providers bill actual usage — and the one provider that checks
// max_tokens against remaining credit upfront (OpenRouter, HTTP 402) is handled
// by the affordability retry below, which recomputes a cap it can afford.
// Every provider request carries the current run's abort signal, so pressing
// Stop rejects in-flight HTTP instead of waiting out a 250-second completion.
async function abortableFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, signal: init.signal ?? currentSignal() });
}

const MAX_OUTPUT_TOKENS = 12000;
const MIN_OUTPUT_TOKENS = 2000;

// OpenAI's reasoning models (o1/o3/o4…, gpt-5*) reject `max_tokens` outright
// and take `max_completion_tokens` instead. Pick the right field upfront for
// known ids; a one-shot swap retry (below) covers ids the prefix misses.
function outputTokensField(provider: AgentSlot['provider'], model: string): 'max_tokens' | 'max_completion_tokens' {
  return provider === 'openai' && /^(o\d|gpt-5)/i.test(model || '') ? 'max_completion_tokens' : 'max_tokens';
}
// Swap whichever output-cap field the payload carries for the other one.
// Returns true when a swap happened (so callers retry exactly once).
function swapOutputTokensField(payload: any): boolean {
  if (payload.max_tokens !== undefined) {
    payload.max_completion_tokens = payload.max_tokens;
    delete payload.max_tokens;
    return true;
  }
  if (payload.max_completion_tokens !== undefined) {
    payload.max_tokens = payload.max_completion_tokens;
    delete payload.max_completion_tokens;
    return true;
  }
  return false;
}

function getActiveAgent(): AgentSlot {
  const { agentSlots, activeAgentId } = useStore.getState();
  let activeAgent = agentSlots.find(a => a.id === activeAgentId) || agentSlots[0];
  if (!activeAgent) throw new Error('No active agent. Please create or select an agent in settings.');
  // If active slot doesn't have an API key, check if another slot with the same provider has one configured
  if (!activeAgent.apiKey && activeAgent.provider !== 'ollama') {
    const sibling = agentSlots.find(a => a.provider === activeAgent.provider && a.apiKey);
    if (sibling) {
      activeAgent = { ...activeAgent, apiKey: sibling.apiKey, baseUrl: activeAgent.baseUrl || sibling.baseUrl };
    }
  }
  return activeAgent;
}

function dataUrlToBase64(dataUrl: string): { mime: string; data: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return { mime: 'image/png', data: dataUrl };
  return { mime: m[1], data: m[2] };
}

// ---------- Provider model listing (Jul 22) ----------
// One button loads the models a provider actually offers, so ids never have to
// be typed by hand. Local (Ollama /api/tags) and cloud (OpenRouter, OpenAI,
// Gemini) all support browser-side listing; errors are surfaced to the UI.

export interface ProviderModelList {
  models: string[];
  note?: string;
}

export async function fetchOllama(baseUrl: string, path: string, init: RequestInit = {}): Promise<Response> {
  const cleanBase = (baseUrl || 'http://127.0.0.1:11434').trim().replace(/\/$/, '');
  const targetHost = cleanBase.replace('localhost', '127.0.0.1');
  const pathClean = path.startsWith('/') ? path : `/${path}`;
  const directUrl = `${targetHost}${pathClean}`;

  try {
    const res = await abortableFetch(directUrl, init);
    return res;
  } catch (err: any) {
    // A user Stop is not a network failure — retrying through the dev proxy
    // would ignore the abort and keep the run alive. Rethrow it.
    if (isAbortError(err)) throw err;
    const proxyUrl = `/api/ollama-proxy${pathClean}`;
    const headers = new Headers(init.headers || {});
    headers.set('x-ollama-target', targetHost);
    return abortableFetch(proxyUrl, { ...init, headers });
  }
}

export async function listProviderModels(
  provider: AgentSlot['provider'],
  apiKey: string,
): Promise<ProviderModelList> {
  if (provider === 'ollama') {
    const rawUrl = apiKey || 'http://127.0.0.1:11434';
    const r = await fetchOllama(rawUrl, '/api/tags');
    if (!r.ok) throw new Error(`Ollama ${r.status} ${r.statusText} — is Ollama running at ${rawUrl}?`);
    const d = await r.json();
    const models = (Array.isArray(d.models) ? d.models.map((m: any) => String(m.name)) : []).sort();
    return { models };
  }

  if (provider === 'anthropic') {
    const defaultAnthropicModels = [
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];
    if (!apiKey) return { models: defaultAnthropicModels };
    try {
      const r = await abortableFetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      if (r.ok) {
        const d = await r.json();
        const fetched = ((d.data || []) as any[]).map(m => String(m.id)).filter(Boolean).sort();
        if (fetched.length > 0) return { models: fetched };
      }
    } catch {
      // Return defaults if model listing endpoint is unavailable
    }
    return { models: defaultAnthropicModels };
  }

  if (provider === 'gemini') {
    const fallbackGemini = [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-pro-exp-02-05',
      'gemini-2.0-flash-thinking-exp',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b',
    ];
    if (!apiKey) return { models: fallbackGemini, note: 'Enter Gemini API key to load account-specific models' };
    // Key goes in the x-goog-api-key header, never the URL — query strings end
    // up in proxy/server logs and browser history.
    try {
      const r = await abortableFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
        headers: { 'x-goog-api-key': apiKey },
      });
      if (!r.ok) throw new Error(`Gemini ${r.status} ${r.statusText}`);
      const d = await r.json();
      const models = ((d.models || []) as any[])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean)
        .sort();
      return { models: models.length > 0 ? models : fallbackGemini };
    } catch (err: any) {
      return { models: fallbackGemini, note: `Listing fallback models (${err.message || 'API error'})` };
    }
  }

  if (provider === 'openai') {
    if (!apiKey) throw new Error('Enter your OpenAI API key first, then load models.');
    const r = await abortableFetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status} ${r.statusText}`);
    const d = await r.json();
    const all = ((d.data || []) as any[]).map(m => String(m.id));
    // Hide obvious non-chat endpoints (embeddings, audio, images, moderation);
    // "Type custom" still accepts anything.
    const EXCLUDE = /(embed|whisper|tts|audio|dall-e|image|moderation|realtime|transcribe|davinci|babbage)/i;
    const models = all.filter(id => !EXCLUDE.test(id)).sort();
    return {
      models,
      note: all.length > models.length ? `${all.length - models.length} non-chat models hidden` : undefined,
    };
  }

  if (provider === 'custom') {
    return {
      models: [
        'claude-3-7-sonnet-20250219',
        'claude-3-5-sonnet-20241022',
        'gemini-2.5-pro',
        'gemini-2.0-flash',
        'gpt-4o',
        'gpt-4o-mini',
        'o3-mini',
        'deepseek-chat',
        'llama3',
      ],
      note: 'Custom endpoint models can also be typed manually',
    };
  }

  // OpenRouter: the models endpoint is public (a key is optional).
  const r = await abortableFetch(
    'https://openrouter.ai/api/v1/models',
    apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined,
  );
  if (!r.ok) throw new Error(`OpenRouter ${r.status} ${r.statusText}`);
  const d = await r.json();
  const models = ((d.data || []) as any[]).map(m => String(m.id)).filter(Boolean).sort();
  return { models };
}

// ---------- Legacy single-shot JSON completion (fallback path) ----------

interface SimpleMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function chatCompletion(
  messages: SimpleMessage[],
  systemPrompt: string,
  opts?: {
    /**
     * Optional JSON Schema for schema-constrained decoding (e.g. the IR
     * grammar from src/ai/ir/schema.ts). Applied where the provider supports
     * it (OpenAI/OpenRouter json_schema, Ollama structured outputs); if the
     * provider rejects the schema payload, the request is retried once in
     * plain JSON mode so a schema problem can never take down the turn.
     */
    responseSchema?: any;
  },
) {
  const activeAgent = getActiveAgent();
  const { provider, apiKey, model, baseUrl } = activeAgent;

  // 1. Google Gemini
  if (provider === 'gemini') {
    const geminiModel = model || 'gemini-2.5-pro';
    const base = baseUrl?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com/v1beta';
    const endpoint = `${base}/models/${geminiModel}:generateContent`;

    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));

    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: MAX_OUTPUT_TOKENS }
    };

    const response = await abortableFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`Gemini API Error: ${response.status} ${response.statusText}. ${errData.error?.message || ''}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Truncation parity with the OpenAI path: a MAX_TOKENS cut must be treated
    // as truncation (continuation request), not misdiagnosed as malformed JSON.
    if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') return text + '\n/*__TRUNCATED__*/';
    return text;
  }

  // 2. Anthropic Claude
  if (provider === 'anthropic') {
    const claudeModel = model || 'claude-3-7-sonnet-20250219';

    // If no API key is set, harness the user's Claude Code / Claude Desktop subscription via local CLI bridge!
    if (!apiKey) {
      const userPrompt = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
      const response = await abortableFetch('/api/claude-cli-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt, systemPrompt }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Claude Code Bridge Error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return data.text || '';
    }

    const base = baseUrl?.replace(/\/$/, '') || 'https://api.anthropic.com/v1';
    const endpoint = base.endsWith('/messages') ? base : `${base}/messages`;

    const contents: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      const role = m.role === 'user' ? 'user' : 'assistant';
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].content += `\n\n${m.content}`;
      } else {
        contents.push({ role, content: m.content });
      }
    }
    if (contents.length === 0 || contents[0].role !== 'user') {
      contents.unshift({ role: 'user', content: 'Generate JSON graph output.' });
    }

    const payload = {
      model: claudeModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: contents,
    };

    const response = await abortableFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`Anthropic API Error: ${response.status} ${response.statusText}. ${errData.error?.message || ''}`);
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('') || '';

    if (data.stop_reason === 'max_tokens') return text + '\n/*__TRUNCATED__*/';
    return text;
  }

  // 3. Local Ollama
  if (provider === 'ollama') {
    const rawUrl = apiKey || 'http://127.0.0.1:11434';
    const ollamaModel = model || 'llama3';

    const payload: any = {
      model: ollamaModel,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: false,
      options: { num_predict: MAX_OUTPUT_TOKENS }
    };
    if (!ollamaModel.toLowerCase().includes('cloud')) {
      // Ollama structured outputs: `format` accepts a full JSON Schema object
      // (grammar-constrained sampling) — falls back to loose JSON mode below.
      payload.format = opts?.responseSchema ?? 'json';
    }

    let response = await fetchOllama(rawUrl, '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok && opts?.responseSchema && payload.format !== 'json') {
      payload.format = 'json';
      response = await fetchOllama(rawUrl, '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!response.ok) throw new Error(`Ollama Error: ${response.status} ${response.statusText}`);

    const data = await response.json();
    const content = data.message?.content || '';
    // Truncation parity with the OpenAI path (done_reason === 'length').
    if (data.done_reason === 'length') return content + '\n/*__TRUNCATED__*/';
    return content;
  }

  // 4. OpenRouter / OpenAI / Custom standard completions
  let endpoint = '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (provider === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'openai') {
    const base = baseUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1';
    endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'custom') {
    const base = (baseUrl || 'http://localhost:8080/v1').replace(/\/$/, '');
    endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const payload: any = {
    model: model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    response_format: opts?.responseSchema
      // strict:false — the IR schema has free-form `args` objects, which the
      // strict subset forbids; the op-name enum is the high-value constraint.
      ? { type: 'json_schema', json_schema: { name: 'ir_program', strict: false, schema: opts.responseSchema } }
      : { type: 'json_object' },
  };
  // OpenAI reasoning models (o-series, gpt-5*) reject `max_tokens` and require
  // `max_completion_tokens` — sending the wrong one 400s every retry.
  payload[outputTokensField(provider, model)] = MAX_OUTPUT_TOKENS;

  let response = await abortableFetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
  // One-shot retry swapping max_tokens ⇄ max_completion_tokens when a 400
  // names the field (catches ids the prefix heuristic misses, e.g. OpenRouter).
  if (response.status === 400) {
    const errPeek = await response.clone().text().catch(() => '');
    if (/max_tokens|max_completion_tokens/i.test(errPeek) && swapOutputTokensField(payload)) {
      response = await abortableFetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
    }
  }
  if (!response.ok) {
    if (payload.response_format?.type === 'json_schema') {
      payload.response_format = { type: 'json_object' };
      response = await abortableFetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
    }
    if (!response.ok) {
      delete payload.response_format;
      response = await abortableFetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
    }
  }
  if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);

  const data = await response.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content || '';
  // Signal truncation so the caller can request a continuation rather than
  // mis-reading a cut-off graph as a malformed one.
  if (choice?.finish_reason === 'length') return content + '\n/*__TRUNCATED__*/';
  return content;
}

// ---------- Native tool-calling completion ----------

export function providerSupportsTools(agent: AgentSlot): boolean {
  if (agent.disableToolCalling) return false;
  if (agent.provider === 'anthropic' && !agent.apiKey) return false; // Route headless Claude Code CLI through fast single-shot IR JSON compiler
  return agent.provider === 'openai' || agent.provider === 'openrouter' || agent.provider === 'gemini' || agent.provider === 'ollama' || agent.provider === 'anthropic' || agent.provider === 'custom';
}

export async function chatCompletionWithTools(
  messages: AgentMessage[],
  systemPrompt: string,
  tools: ToolDef[],
): Promise<ModelTurn> {
  const activeAgent = getActiveAgent();
  const { provider, apiKey, model, baseUrl } = activeAgent;

  if (provider === 'gemini') {
    return geminiToolCompletion(apiKey, model || 'gemini-2.5-pro', messages, systemPrompt, tools, baseUrl);
  }

  if (provider === 'anthropic') {
    return anthropicToolCompletion(apiKey, model || 'claude-3-7-sonnet-20250219', messages, systemPrompt, tools, baseUrl);
  }

  if (provider === 'ollama') {
    // For the ollama flavor, `endpoint` is the BASE URL — fetchOllama appends
    // /api/chat and handles the localhost/proxy fallback.
    return openAIStyleToolCompletion(apiKey || 'http://127.0.0.1:11434', {}, model || 'llama3', messages, systemPrompt, tools, 'ollama');
  }

  if (provider === 'custom') {
    const base = (baseUrl || 'http://localhost:8080/v1').replace(/\/$/, '');
    const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    return openAIStyleToolCompletion(endpoint, apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, model || 'gpt-4o', messages, systemPrompt, tools, 'openai');
  }

  if (provider === 'openai') {
    const base = baseUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1';
    const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    return openAIStyleToolCompletion(endpoint, apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, model || 'gpt-4o', messages, systemPrompt, tools, 'openai');
  }

  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  return openAIStyleToolCompletion(endpoint, apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, model || 'anthropic/claude-3.7-sonnet', messages, systemPrompt, tools, 'openai');
}

// Ollama's constrained tool-call grammar (used by cloud models like kimi-k2)
// chokes on free-form object schemas that have no declared `properties`,
// emitting malformed JSON ("Value looks like object, but can't find closing '}'").
// Convert those to a STRING param ("JSON encoded as string"); the executor's
// normalizeArgs already tolerantly re-parses stringified objects/arrays.
// SCOPE: this rewrite is applied ONLY for the 'ollama' flavor (plus Gemini's
// function declarations, whose OpenAPI subset rejects empty OBJECT schemas).
// OpenRouter/OpenAI accept `{type:'object',properties:{}}` fine — rewriting it
// to a string is what made the default OpenRouter slot 400 on clear_graph.
function sanitizeSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.type === 'object' && (!schema.properties || Object.keys(schema.properties).length === 0)) {
    return { type: 'string', description: `${schema.description || 'Object'} — encode as a JSON string.` };
  }
  const out = { ...schema };
  if (out.properties) {
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, sanitizeSchema(v)]));
  }
  if (out.items) out.items = sanitizeSchema(out.items);
  return out;
}

async function openAIStyleToolCompletion(
  endpoint: string,
  extraHeaders: Record<string, string>,
  model: string,
  messages: AgentMessage[],
  systemPrompt: string,
  tools: ToolDef[],
  flavor: 'openai' | 'ollama',
): Promise<ModelTurn> {
  const apiMessages: any[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'system') {
      if ('imageDataUrl' in m && m.imageDataUrl) {
        if (flavor === 'ollama') {
          apiMessages.push({ role: m.role, content: m.content, images: [dataUrlToBase64(m.imageDataUrl).data] });
        } else {
          apiMessages.push({
            role: m.role,
            content: [
              { type: 'text', text: m.content },
              { type: 'image_url', image_url: { url: m.imageDataUrl } },
            ],
          });
        }
      } else {
        apiMessages.push({ role: m.role, content: m.content });
      }
    } else if (m.role === 'assistant') {
      const msg: any = { role: 'assistant', content: m.content ?? '' };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      apiMessages.push(msg);
    } else if (m.role === 'tool') {
      if (flavor === 'ollama') {
        apiMessages.push({ role: 'tool', content: m.content });
      } else {
        apiMessages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
      }
    }
  }

  const payload: any = {
    model,
    messages: apiMessages,
    tools: tools.map(t => {
      // Empty-object rewrite is an Ollama grammar workaround ONLY — OpenRouter,
      // OpenAI (and Anthropic models behind OpenRouter) accept valid
      // `{type:'object',properties:{}}` schemas as-is.
      const params = flavor === 'ollama' ? sanitizeSchema(t.parameters) : t.parameters;
      return { type: 'function', function: { name: t.name, description: t.description, parameters: params } };
    }),
  };
  if (flavor === 'ollama') {
    payload.stream = false;
    payload.options = { num_predict: MAX_OUTPUT_TOKENS };
  } else {
    const activeAgent = getActiveAgent();
    payload[outputTokensField(activeAgent.provider, model)] = MAX_OUTPUT_TOKENS;
  }

  const send = (): Promise<Response> => flavor === 'ollama'
    ? fetchOllama(endpoint, '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify(payload),
      })
    : abortableFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify(payload),
      });

  let response = await send();
  // One-shot retry swapping max_tokens ⇄ max_completion_tokens when a 400
  // names the field (OpenAI reasoning models; ids the prefix heuristic misses).
  if (response.status === 400 && flavor !== 'ollama') {
    const errPeek = await response.clone().text().catch(() => '');
    if (/max_tokens|max_completion_tokens/i.test(errPeek) && swapOutputTokensField(payload)) {
      response = await send();
    }
  }
  if (response.status === 402 && flavor !== 'ollama') {
    // Low-credit account: OpenRouter tells us what it can afford — retry once
    // with that cap rather than failing the whole build.
    const errText = await response.text().catch(() => '');
    const afford = errText.match(/afford (\d+)/);
    const cap = afford ? Math.max(MIN_OUTPUT_TOKENS, parseInt(afford[1], 10) - 200) : MIN_OUTPUT_TOKENS;
    payload[payload.max_completion_tokens !== undefined ? 'max_completion_tokens' : 'max_tokens'] = cap;
    response = await send();
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`API Error: ${response.status} ${response.statusText}. ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const message = flavor === 'ollama' ? data.message : data.choices?.[0]?.message;
  if (!message) return { text: null, toolCalls: [] };

  const toolCalls: ToolCall[] = (message.tool_calls || []).map((tc: any, idx: number) => {
    let args = tc.function?.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch {
        // Do NOT silently run the tool with {} — mark it so the agent loop
        // returns a tool-result error and the model resends corrected JSON.
        args = { [MALFORMED_TOOL_ARGS_KEY]: String(tc.function?.arguments || '').slice(0, 200) };
      }
    }
    return { id: tc.id || `call_${idx}`, name: tc.function?.name || tc.name, arguments: args || {} };
  });

  const truncated = flavor === 'ollama'
    ? data.done_reason === 'length'
    : data.choices?.[0]?.finish_reason === 'length';
  return { text: message.content || null, toolCalls, truncated };
}

async function anthropicToolCompletion(
  apiKey: string,
  model: string,
  messages: AgentMessage[],
  systemPrompt: string,
  tools: ToolDef[],
  baseUrl?: string,
): Promise<ModelTurn> {
  // If no API key is provided, execute directly via the local Claude Code CLI subscription bridge!
  if (!apiKey) {
    const formattedPrompt = messages.map(m => {
      if (m.role === 'tool') return `[TOOL RESULT]: ${m.content}`;
      return `${m.role.toUpperCase()}: ${m.content || ''}`;
    }).join('\n\n');

    const bridgeRes = await abortableFetch('/api/claude-cli-bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: formattedPrompt, systemPrompt }),
    });

    if (!bridgeRes.ok) {
      const errData = await bridgeRes.json().catch(() => ({}));
      throw new Error(errData.error || `Claude Code Bridge Error: ${bridgeRes.status}`);
    }

    const bridgeData = await bridgeRes.json();
    return { text: bridgeData.text || '', toolCalls: [] };
  }

  const cleanBase = (baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '');
  const endpoint = cleanBase.endsWith('/messages') ? cleanBase : `${cleanBase}/messages`;

  const apiMessages: any[] = [];
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'system') {
      const parts: any[] = [];
      if ('imageDataUrl' in m && m.imageDataUrl) {
        const { mime, data } = dataUrlToBase64(m.imageDataUrl);
        parts.push({
          type: 'image',
          source: { type: 'base64', media_type: mime, data },
        });
      }
      if (m.content) {
        parts.push({ type: 'text', text: m.content });
      }
      if (parts.length === 0) parts.push({ type: 'text', text: '' });

      const last = apiMessages[apiMessages.length - 1];
      if (last && last.role === 'user') {
        last.content = [...(Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }]), ...parts];
      } else {
        apiMessages.push({ role: 'user', content: parts });
      }
    } else if (m.role === 'assistant') {
      const parts: any[] = [];
      if (m.content) {
        parts.push({ type: 'text', text: m.content });
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        m.toolCalls.forEach(tc => {
          parts.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments && typeof tc.arguments === 'object' ? tc.arguments : {},
          });
        });
      }
      if (parts.length === 0) parts.push({ type: 'text', text: '' });
      apiMessages.push({ role: 'assistant', content: parts });
    } else if (m.role === 'tool') {
      const toolPart = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      const last = apiMessages[apiMessages.length - 1];
      if (last && last.role === 'user') {
        if (Array.isArray(last.content)) {
          last.content.push(toolPart);
        } else {
          last.content = [{ type: 'text', text: String(last.content) }, toolPart];
        }
      } else {
        apiMessages.push({ role: 'user', content: [toolPart] });
      }
    }
  }

  if (apiMessages.length === 0 || apiMessages[0].role !== 'user') {
    apiMessages.unshift({ role: 'user', content: [{ type: 'text', text: 'Generate CAD model operations' }] });
  }

  const anthropicTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: sanitizeSchema(t.parameters) || { type: 'object', properties: {} },
  }));

  const payload = {
    model: model || 'claude-3-7-sonnet-20250219',
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemPrompt,
    messages: apiMessages,
    tools: anthropicTools,
  };

  const response = await abortableFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`Anthropic API Error: ${response.status} ${response.statusText}. ${errData.error?.message || ''}`);
  }

  const data = await response.json();
  const content = data.content || [];
  let text: string | null = null;
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    if (block.type === 'text') {
      text = (text || '') + block.text;
    } else if (block.type === 'tool_use') {
      let args = block.input;
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch {
          args = { [MALFORMED_TOOL_ARGS_KEY]: String(args).slice(0, 200) };
        }
      }
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: args || {},
      });
    }
  }

  return {
    text,
    toolCalls,
    truncated: data.stop_reason === 'max_tokens',
  };
}

async function geminiToolCompletion(
  apiKey: string,
  model: string,
  messages: AgentMessage[],
  systemPrompt: string,
  tools: ToolDef[],
  baseUrl?: string,
): Promise<ModelTurn> {
  const base = baseUrl?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com/v1beta';
  const endpoint = `${base}/models/${model}:generateContent`;

  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'system') {
      const parts: any[] = [{ text: m.content }];
      if ('imageDataUrl' in m && m.imageDataUrl) {
        const { mime, data } = dataUrlToBase64(m.imageDataUrl);
        parts.push({ inline_data: { mime_type: mime, data } });
      }
      contents.push({ role: 'user', parts });
    } else if (m.role === 'assistant') {
      const parts: any[] = [];
      if (m.content) parts.push({ text: m.content });
      (m.toolCalls || []).forEach(tc => {
        parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
      });
      if (parts.length > 0) contents.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      let responseObj: any;
      try { responseObj = JSON.parse(m.content); } catch { responseObj = { result: m.content }; }
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.name, response: typeof responseObj === 'object' && responseObj !== null ? responseObj : { result: responseObj } } }],
      });
    }
  }

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
    tools: [{
      functionDeclarations: tools.map(t => {
        const decl: any = { name: t.name, description: t.description };
        // Omit parameters entirely for no-arg tools (Gemini rejects empty OBJECT schemas)
        if (t.parameters?.properties && Object.keys(t.parameters.properties).length > 0) {
          decl.parameters = sanitizeSchema(t.parameters);
        }
        return decl;
      })
    }],
  };

  const response = await abortableFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`Gemini API Error: ${response.status} ${response.statusText}. ${errData.error?.message || ''}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  let text: string | null = null;
  const toolCalls: ToolCall[] = [];
  let idx = 0;
  for (const p of parts) {
    if (p.text) text = (text || '') + p.text;
    if (p.functionCall) {
      toolCalls.push({ id: `gemini_call_${idx++}`, name: p.functionCall.name, arguments: p.functionCall.args || {} });
    }
  }
  return { text, toolCalls, truncated: data.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
}

// ---------- Vision (single-shot, used by the verification pass) ----------

export function providerSupportsVision(agent: AgentSlot): boolean {
  return agent.provider === 'gemini' || agent.provider === 'openai' || agent.provider === 'openrouter' || agent.provider === 'ollama' || agent.provider === 'anthropic' || agent.provider === 'custom';
}

export async function chatCompletionVision(prompt: string, imageDataUrls: string[], systemPrompt: string): Promise<string> {
  const activeAgent = getActiveAgent();
  const { provider, apiKey, model, baseUrl } = activeAgent;

  if (provider === 'gemini') {
    const base = baseUrl?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com/v1beta';
    const endpoint = `${base}/models/${model || 'gemini-2.5-pro'}:generateContent`;
    const parts: any[] = [{ text: prompt }];
    imageDataUrls.forEach(u => {
      const { mime, data } = dataUrlToBase64(u);
      parts.push({ inline_data: { mime_type: mime, data } });
    });
    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json' },
    };
    const response = await abortableFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`Gemini Vision Error: ${response.status}`);
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (provider === 'anthropic') {
    const claudeModel = model || 'claude-3-7-sonnet-20250219';
    const cleanBase = (baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '');
    const endpoint = cleanBase.endsWith('/messages') ? cleanBase : `${cleanBase}/messages`;

    const parts: any[] = [];
    imageDataUrls.forEach(u => {
      const { mime, data } = dataUrlToBase64(u);
      parts.push({
        type: 'image',
        source: { type: 'base64', media_type: mime, data },
      });
    });
    parts.push({ type: 'text', text: prompt });

    const payload = {
      model: claudeModel,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: parts }],
    };

    const response = await abortableFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`Anthropic Vision Error: ${response.status}`);
    const data = await response.json();
    return (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('') || '';
  }

  if (provider === 'ollama') {
    const rawUrl = apiKey || 'http://127.0.0.1:11434';
    const payload: any = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt, images: imageDataUrls.map(u => dataUrlToBase64(u).data) },
      ],
      stream: false,
    };
    if (!model.toLowerCase().includes('cloud')) {
      payload.format = 'json';
    }
    const response = await fetchOllama(rawUrl, '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`Ollama Vision Error: ${response.status}`);
    const data = await response.json();
    return data.message?.content || '';
  }

  let endpoint = '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'custom') {
    const base = (baseUrl || 'http://localhost:8080/v1').replace(/\/$/, '');
    endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  } else {
    const base = baseUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1';
    endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const content: any[] = [{ type: 'text', text: prompt }];
  imageDataUrls.forEach(u => content.push({ type: 'image_url', image_url: { url: u } }));
  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
    response_format: { type: 'json_object' },
  };
  const response = await abortableFetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Vision API Error: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ---------- Embeddings (best-effort; retrieval falls back to lexical scoring) ----------

export async function tryEmbed(text: string): Promise<number[] | null> {
  try {
    const activeAgent = getActiveAgent();
    const { provider, apiKey, baseUrl } = activeAgent;

    if (provider === 'openai' || provider === 'custom') {
      const base = baseUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1';
      const endpoint = base.endsWith('/embeddings') ? base : `${base}/embeddings`;
      const response = await abortableFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.data?.[0]?.embedding || null;
    }

    if (provider === 'gemini') {
      const base = baseUrl?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com/v1beta';
      const endpoint = `${base}/models/text-embedding-004:embedContent`;
      const response = await abortableFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 8000) }] } }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.embedding?.values || null;
    }

    if (provider === 'ollama') {
      const rawUrl = apiKey || 'http://127.0.0.1:11434';
      const response = await fetchOllama(rawUrl, '/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: text.slice(0, 8000) }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.embedding || null;
    }

    return null; // openrouter / anthropic: no direct embeddings endpoint
  } catch {
    return null;
  }
}
