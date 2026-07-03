import type { PlaygroundApiPurpose } from './devProxy'

const VIDEO_RE = /video|sora|kling|可灵|veo[-_ ]?\d*|seedance|seedvideo|runway|(?:^|[\s/_:-])gen[-_ ]?\d|pika|hailuo|海螺|vidu|wan(?:\d|x)|t2v|i2v|img[-_ ]?to[-_ ]?video|image[-_ ]?to[-_ ]?video|minimax(?:[-_ ].*)?video|minimax.*hailuo|hunyuan.*video|cogvideo|pixverse|luma|ray[-_ ]?\d?|dream[-_ ]?machine|jimeng.*(?:video|t2v|i2v|vgfm)|即梦.*(?:视频|t2v|i2v)|doubao.*(?:seedance|video|t2v|i2v)/i
const IMAGE_RE = /image|img|images|flux|dall[-_ ]?e|imagen|nano[-_ ]?banana|banana|qwen.*image|qwen.*edit|stable|\bsd(?:\d|xl)|midjourney|\bmj\b|recraft|ideogram|seedream|kolors|hunyuan.*image|grok.*image|gpt[-_ ]?image|jimeng|即梦|dreamina|doubao.*seedream|cogview|hidream|wan(?:\d|x).*t2i|i2i|text[-_ ]?to[-_ ]?image/i
const AUDIO_RE = /audio|tts|speech|voice|music|sound/i
const VIDEO_LABEL_RE = /视频|video|sora|veo|kling|可灵|hailuo|海螺|runway|vidu|pika|seedance|i2v|t2v/i
const IMAGE_LABEL_RE = /生图|图片|图像|绘图|image|img|draw|paint|flux|dall|midjourney|mj|seedream/i
const TEXT_LABEL_RE = /文本|对话|聊天|chat|text|llm|语言|gpt|claude|gemini|deepseek|qwen/i

export function inferPurposeFromLabel(label: string): PlaygroundApiPurpose | null {
  const value = label.trim()
  if (!value) return null
  if (VIDEO_LABEL_RE.test(value)) return 'video'
  if (IMAGE_LABEL_RE.test(value)) return 'image'
  if (TEXT_LABEL_RE.test(value)) return 'text'
  return null
}

export function isModelForPurposeWithHint(id: string, purpose: PlaygroundApiPurpose, hint?: PlaygroundApiPurpose | null): boolean {
  const lower = id.toLowerCase()
  const isVideo = VIDEO_RE.test(lower)
  const isImage = !isVideo && !AUDIO_RE.test(lower) && IMAGE_RE.test(lower)
  if (isVideo) return purpose === 'video'
  if (isImage) return purpose === 'image'
  if (AUDIO_RE.test(lower)) return false
  if (hint) return purpose === hint
  return purpose === 'text'
}

export function isModelForPurpose(id: string, purpose: PlaygroundApiPurpose): boolean {
  return isModelForPurposeWithHint(id, purpose)
}

export function firstModelForPurpose(models: string[] | undefined, purpose: PlaygroundApiPurpose): string {
  return models?.find((model) => isModelForPurpose(model, purpose)) ?? ''
}
