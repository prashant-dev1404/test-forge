// src/generator/llm.ts
// Provider-agnostic LLM completion. Switches between Anthropic (production) and
// Groq + Llama (development) based on NODE_ENV.
//
//   NODE_ENV=production  → Anthropic Claude    (requires ANTHROPIC_API_KEY)
//   NODE_ENV=anything else (or unset) → Groq Llama 70B (requires GROQ_API_KEY)

import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';

export type Provider = 'anthropic' | 'groq';

export interface ProviderInfo {
  provider: Provider;
  model: string;
}

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

export function getProviderInfo(): ProviderInfo {
  const provider: Provider = process.env.NODE_ENV === 'production' ? 'anthropic' : 'groq';
  return {
    provider,
    model: provider === 'anthropic' ? ANTHROPIC_MODEL : GROQ_MODEL,
  };
}

let anthropicClient: Anthropic | null = null;
let groqClient: Groq | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set (required when NODE_ENV=production)');
    }
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

function getGroq(): Groq {
  if (!groqClient) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is not set (required when NODE_ENV is not "production")');
    }
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

/**
 * Single-turn text completion. Returns the model's text output as a plain string.
 * Caller is responsible for parsing JSON / extracting code blocks.
 */
export async function complete(prompt: string, maxTokens: number): Promise<string> {
  const { provider, model } = getProviderInfo();

  if (provider === 'anthropic') {
    const message = await getAnthropic().messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return message.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('');
  }

  // Groq (OpenAI-compatible chat completions API)
  const completion = await getGroq().chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0]?.message?.content ?? '';
}
