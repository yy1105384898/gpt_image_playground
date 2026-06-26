const FACE_PRIVACY_RE =
  /(?:他的|她的|人物的|主体的|男子的|男人的|女人的|人的)?(?:脸部|面部|人脸|脸|五官|头像)(?:被|已被|受到|进行了|有)?[^。！？.!?\n，,；;]{0,28}(?:模糊|马赛克|打码|遮挡|遮住|遮盖|遮蔽|糊住|糊化|blur|blurred|mosaic|pixelated|censored|obscured)[^。！？.!?\n]{0,40}[。！？.!?，,；;]?/gi

const PRIVACY_BLOCK_RE =
  /(?:矩形|方形|隐私|保护|遮挡|模糊|马赛克|打码)[^。！？.!?\n]{0,24}(?:块|区域|处理|效果|遮罩)[^。！？.!?\n]{0,36}[。！？.!?，,；;]?/gi

function normalizePromptWhitespace(prompt: string): string {
  return prompt
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([。！？.!?，,；;])/g, '$1')
    .replace(/([。！？.!?]){2,}/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function sanitizeImagePromptForApi(prompt: string): string {
  const sanitized = normalizePromptWhitespace(
    prompt
      .replace(FACE_PRIVACY_RE, '')
      .replace(PRIVACY_BLOCK_RE, ''),
  )
  return sanitized || prompt.trim()
}
