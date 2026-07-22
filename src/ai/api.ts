import { useStore } from '../store/useStore';
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
const MAX_OUTPUT_TOKENS = 12000;
const MIN_OUTPUT_TOKENS = 2000;

function getActiveAgent(): AgentSlot {
  const { agentSlots, activeAgentId } = useStore.getState();
  const activeAgent = agentSlots.find(a => a.id === activeAgentId);
  if (!activeAgent) throw new Error('No active agent. Please create or select an agent in settings.');
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

export async function listProviderModels(
  provider: AgentSlot['provider'],
  apiKey: string,
): Promise<ProviderModelList> {
  if (provider === 'ollama') {
    const url = (apiKey || 'http://localhost:11434').trim().replace(/\/$/, '');
    const r = await fetch(`${url}/api/tags`);
    if (!r.ok) throw new Error(`Ollama ${r.status} ${r.statusText} — is Ollama running at ${url}?`);
    const d = await r.json();
    const models = (Array.isArray(d.models) ? d.models.map((m: any) => String(m.name)) : []).sort();
    return { models };
  }

  if (provider === 'gemini') {
    if (!apiKey) throw new Error('Enter your Gemini API key first, then load models.');
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`);
    if (!r.ok) throw new Error(`Gemini ${r.status} ${r.statusText}`);
    const d = await r.json();
    const models = ((d.models || []) as any[])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean)
      .sort();
    return { models };
  }

  if (provider === 'openai') {
    if (!apiKey) throw new Error('Enter your OpenAI API key first, then load models.');
    const r = await fetch('https://api.openai.com/v1/models', {
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

  // OpenRouter: the models endpoint is public (a key is optional).
  const r = await fetch(
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
  const { provider, apiKey, model } = activeAgent;

  // 1. Google Gemini
  if (provider === 'gemini') {
    const geminiModel = model || 'gemini-1.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`Gemini API Error: ${response.status} ${response.statusText}. ${errData.error?.message || ''}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  // 2. Local Ollama
  if (provider === 'ollama') {
    const url = apiKey || 'http://localhost:11434';
    const endpoint = `${url.replace(/\/$/, '')}/api/chat`;
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

    let response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok && opts?.responseSchema && payload.format !== 'json') {
      payload.format = 'json';
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!response.ok) throw new Error(`Ollama Error: ${response.status} ${response.statusText}`);

    const data = await response.json();
    return data.message?.content || '';
  }

  // 3. OpenRouter / OpenAI standard completions
  let endpoint = '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (provider === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'openai') {
    endpoint = 'https://api.openai.com/v1/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
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
    max_tokens: MAX_OUTPUT_TOKENS
  };

  let response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!response.ok) {
    if (payload.response_format?.type === 'json_schema') {
      payload.response_format = { type: 'json_object' };
      response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
    }
    if (!response.ok) {
      delete payload.response_format;
      response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
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
  return agent.provider === 'openai' || agent.provider === 'openrouter' || agent.provider === 'gemini' || agent.provider === 'ollama';
}

export async function chatCompletionWithTools(
  messages: AgentMessage[],
  systemPrompt: string,
  tools: ToolDef[],
): Promise<ModelTurn> {
  const activeAgent = getActiveAgent();
  const { provider, apiKey, model } = activeAgent;

  if (provider === 'gemini') {
    return geminiToolCompletion(apiKey, model || 'gemini-1.5-flash', messages, systemPrompt, tools);
  }

  if (provider === 'ollama') {
    const url = (apiKey || 'http://localhost:11434').replace(/\/$/, '');
    return openAIStyleToolCompletion(`${url}/api/chat`, {}, model || 'llama3', messages, systemPrompt, tools, 'ollama');
  }

  const endpoint = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  return openAIStyleToolCompletion(endpoint, { Authorization: `Bearer ${apiKey}` }, model, messages, systemPrompt, tools, 'openai');
}

// Ollama's constrained tool-call grammar (used by cloud models like kimi-k2)
// chokes on free-form object schemas that have no declared `properties`,
// emitting malformed JSON ("Value looks like object, but can't find closing '}'").
// Convert those to a STRING param ("JSON encoded as string"); the executor's
// normalizeArgs already tolerantly re-parses stringified objects/arrays.
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
      const isOllamaOrAnthropic = flavor === 'ollama' || 
                                  endpoint.includes('openrouter.ai') || 
                                  model.toLowerCase().includes('claude') || 
                                  model.toLowerCase().includes('anthropic');
      const params = isOllamaOrAnthropic ? sanitizeSchema(t.parameters) : t.parameters;
      return { type: 'function', function: { name: t.name, description: t.description, parameters: params } };
    }),
  };
  if (flavor === 'ollama') {
    payload.stream = false;
    payload.options = { num_predict: MAX_OUTPUT_TOKENS };
  } else {
    payload.max_tokens = MAX_OUTPUT_TOKENS;
  }

  let response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(payload),
  });
  if (response.status === 402 && flavor !== 'ollama') {
    // Low-credit account: OpenRouter tells us what it can afford — retry once
    // with that cap rather than failing the whole build.
    const errText = await response.text().catch(() => '');
    const afford = errText.match(/afford (\d+)/);
    const cap = afford ? Math.max(MIN_OUTPUT_TOKENS, parseInt(afford[1], 10) - 200) : MIN_OUTPUT_TOKENS;
    payload.max_tokens = cap;
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(payload),
    });
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
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    return { id: tc.id || `call_${idx}`, name: tc.function?.name || tc.name, arguments: args || {} };
  });

  const truncated = flavor === 'ollama'
    ? data.done_reason === 'length'
    : data.choices?.[0]?.finish_reason === 'length';
  return { text: message.content || null, toolCalls, truncated };
}

// Schema sanitization logic shared by Ollama and Gemini (removes empty properties and converts empty objects to JSON strings)

async function geminiToolCompletion(
  apiKey: string,
  model: string,
  messages: AgentMessage[],
  systemPrompt: string,
  tools: ToolDef[],
): Promise<ModelTurn> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  return agent.provider === 'gemini' || agent.provider === 'openai' || agent.provider === 'openrouter' || agent.provider === 'ollama';
}

export async function chatCompletionVision(prompt: string, imageDataUrls: string[], systemPrompt: string): Promise<string> {
  const activeAgent = getActiveAgent();
  const { provider, apiKey, model } = activeAgent;

  if (provider === 'gemini') {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent?key=${apiKey}`;
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
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`Gemini Vision Error: ${response.status}`);
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (provider === 'ollama') {
    const url = (apiKey || 'http://localhost:11434').replace(/\/$/, '');
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
    const response = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`Ollama Vision Error: ${response.status}`);
    const data = await response.json();
    return data.message?.content || '';
  }

  const endpoint = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
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
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
    const { provider, apiKey } = activeAgent;

    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.data?.[0]?.embedding || null;
    }

    if (provider === 'gemini') {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 8000) }] } }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.embedding?.values || null;
    }

    if (provider === 'ollama') {
      const url = (apiKey || 'http://localhost:11434').replace(/\/$/, '');
      const response = await fetch(`${url}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: text.slice(0, 8000) }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.embedding || null;
    }

    return null; // openrouter: no stable embeddings endpoint
  } catch {
    return null;
  }
}
