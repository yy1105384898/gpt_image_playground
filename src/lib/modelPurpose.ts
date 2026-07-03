import type { PlaygroundApiPurpose } from './devProxy'

const VIDEO_RE = /video|sora|kling|可灵|veo[-_ ]?\d*|seedance|seedvideo|runway|(?:^|[\s/_:-])gen[-_ ]?\d|pika|hailuo|海螺|vidu|wan(?:\d|x)|t2v|i2v|img[-_ ]?to[-_ ]?video|image[-_ ]?to[-_ ]?video|minimax(?:[-_ ].*)?video|minimax.*hailuo|hunyuan.*video|cogvideo|pixverse|luma|ray[-_ ]?\d?|dream[-_ ]?machine|jimeng.*(?:video|t2v|i2v|vgfm)|即梦.*(?:视频|t2v|i2v)|doubao.*(?:seedance|video|t2v|i2v)/i
const IMAGE_RE = /image|img|images|flux|dall[-_ ]?e|imagen|nano[-_ ]?banana|banana|qwen.*image|qwen.*edit|stable|\bsd(?:\d|xl)|midjourney|\bmj\b|recraft|ideogram|seedream|kolors|hunyuan.*image|grok.*image|gpt[-_ ]?image|jimeng|即梦|dreamina|doubao.*seedream|cogview|hidream|wan(?:\d|x).*t2i|i2i|text[-_ ]?to[-_ ]?image/i
const AUDIO_RE = /audio|tts|speech|voice|music|sound/i

export function isModelForPurpose(id: string, purpose: PlaygroundApiPurpose): boolean {
  const lower = id.toLowerCase()
  if (purpose === 'video') return VIDEO_RE.test(lower)
  if (purpose === 'image') return !VIDEO_RE.test(lower) && !AUDIO_RE.test(lower) && IMAGE_RE.test(lower)
  return !VIDEO_RE.test(lower) && !IMAGE_RE.test(lower) && !AUDIO_RE.test(lower)
}

export function firstModelForPurpose(models: string[] | undefined, purpose: PlaygroundApiPurpose): string {
  return models?.find((model) => isModelForPurpose(model, purpose)) ?? ''
}
