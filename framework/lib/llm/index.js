/**
 * Optional LLM access behind one tiny interface: `complete({ system, prompt, maxTokens }) -> string`.
 * Nothing in the framework needs it: `createLlm` returns null unless LLM_PROVIDER is set, and every caller
 * must treat null as "skip this feature". Providers: `anthropic` and `openai-compatible` (any server that speaks
 * the chat-completions format, with LLM_BASE_URL). Keys are read from the environment and never logged.
 */
export function createLlm(env = process.env, fetchImpl = fetch) {
  const provider = (env.LLM_PROVIDER ?? '').trim().toLowerCase();
  if (!provider || provider === 'none') return null;
  const key = env.LLM_API_KEY;
  const model = env.LLM_MODEL;
  if (!key || !model) throw new Error(`LLM_PROVIDER=${provider} needs LLM_MODEL and LLM_API_KEY`);
  const timeout = Number(env.LLM_TIMEOUT_MS ?? 60_000);

  const post = async (url, headers, body) => {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${(await res.text()).slice(0, 200).replace(key, '[key]')}`);
    return res.json();
  };

  if (provider === 'anthropic') {
    const base = env.LLM_BASE_URL ?? 'https://api.anthropic.com';
    return {
      provider,
      model,
      async complete({ system = '', prompt, maxTokens = 1024 }) {
        const data = await post(`${base}/v1/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] });
        return (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      },
    };
  }
  if (provider === 'openai-compatible') {
    const base = env.LLM_BASE_URL;
    if (!base) throw new Error('LLM_PROVIDER=openai-compatible needs LLM_BASE_URL');
    return {
      provider,
      model,
      async complete({ system = '', prompt, maxTokens = 1024 }) {
        const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
        const data = await post(`${base.replace(/\/$/, '')}/chat/completions`, { authorization: `Bearer ${key}` }, { model, max_tokens: maxTokens, messages });
        return data.choices?.[0]?.message?.content ?? '';
      },
    };
  }
  throw new Error(`Unknown LLM_PROVIDER "${provider}" (use anthropic or openai-compatible)`);
}

export const PROVIDERS = ['anthropic', 'openai-compatible'];
