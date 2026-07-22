// ---------------------------------------------------------------------------
// JSON Schema for the IR — single source of truth for SCHEMA-CONSTRAINED
// DECODING. Generated from the skill registry so the model's grammar can never
// drift from the compiler's vocabulary.
//
// Provider wiring (all in src/ai/api.ts):
//   OpenAI / OpenRouter:  response_format: { type: 'json_schema',
//                           json_schema: { name: 'ir_program', strict: true,
//                                          schema: buildIrJsonSchema() } }
//   Ollama (structured outputs): format: buildIrJsonSchema()
//                           (instead of the loose format: 'json')
//   Gemini:               generationConfig.responseSchema (OpenAPI subset —
//                           run the schema through the existing sanitizeSchema
//                           style massaging; drop unsupported keywords)
//
// Note: `args` stays permissive (per-op arg validation happens in compileIr,
// which produces far better repair messages than a decoder error). The schema's
// job is to make "invalid JSON" and "unknown op" structurally impossible.
// ---------------------------------------------------------------------------

import { SKILLS, SKILL_ALIASES } from './skills';

export function buildIrJsonSchema(): any {
  const opNames = [...Object.keys(SKILLS), ...Object.keys(SKILL_ALIASES)];
  const irValue = {
    anyOf: [
      { type: 'number' },
      { type: 'string' },
      { type: 'boolean' },
      { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] } },
      // Ergonomic object forms (Jul 22): inline {"op":...,"args":{...}}
      // constructors and bare {"x","y","z"} point/vector literals — the
      // compiler auto-lifts both (compile.ts). Kept permissive here: per-op
      // validation lives in compileIr, which produces better repair messages.
      { type: 'object' },
    ],
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['body', 'emit'],
    properties: {
      intent: { type: 'string' },
      // Escape hatch: a clarifying-question response (empty body + questions)
      // is still expressible under the constrained grammar.
      questions: { type: 'array', items: { type: 'string' } },
      params: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'value'],
          properties: {
            name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
            value: { type: 'number' },
            min: { type: 'number' },
            max: { type: 'number' },
            step: { type: 'number' },
          },
        },
      },
      body: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['let', 'op', 'args'],
          properties: {
            let: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
            op: { type: 'string', enum: opNames },
            args: { type: 'object', additionalProperties: irValue },
          },
        },
      },
      emit: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['ref'],
          properties: {
            ref: { type: 'string', pattern: '^\\$[A-Za-z_][A-Za-z0-9_]*$' },
            color: { type: 'string' },
          },
        },
      },
    },
  };
}
