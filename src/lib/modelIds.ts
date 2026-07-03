const NON_MODEL_ID_KEYS = new Set([
  'openai',
  'openai_chat',
  'openai_edit',
  'openai_edits',
  'openai_generation',
  'openai_generations',
  'openai_image',
  'openai_images',
  'gemini',
  'google',
  'anthropic',
  'azure',
  'fal',
  'replicate',
  'chat',
  'chats',
  'text',
  'texts',
  'image',
  'images',
  'video',
  'videos',
  'edit',
  'edits',
  'generation',
  'generations',
  'completion',
  'completions',
  'response',
  'responses',
])

export function normalizeModelIdCandidate(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const key = trimmed.toLowerCase().replace(/[\s-]+/g, '_')
  if (NON_MODEL_ID_KEYS.has(key)) return ''
  return trimmed
}

export function uniqueModelIds(models: unknown): string[] {
  if (!Array.isArray(models)) return []
  return Array.from(new Set(
    models
      .map((model) => (typeof model === 'string' ? normalizeModelIdCandidate(model) : ''))
      .filter(Boolean),
  ))
}
