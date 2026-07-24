import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InputImage } from '../types'
import { createChatMessage, DEFAULT_CHAT_MODEL, useChatStore, type ChatConversation } from '../chatStore'
import { createInputImageFromFile, deleteImageIfUnreferenced, useStore } from '../store'
import { ensureImageCached } from '../lib/imageCache'
import { callTextChatApi } from '../lib/chatApi'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { getPlaygroundApiChannelTarget, getPlaygroundApiResolvedTarget, setPlaygroundApiChannelTarget } from '../lib/devProxy'
import { getModelGroups } from '../lib/modelCatalog'
import { getStoredPlaygroundPurposeConfig, savePlaygroundPurposeConfig } from '../lib/playgroundPurposeConfig'
import { normalizeSettings } from '../lib/apiProfiles'
import { getPlaygroundModelChannelApiKey, resolvePlaygroundModelChannelTarget } from '../lib/playgroundChannels'
import { isModelForPurpose } from '../lib/modelPurpose'
import ModelSelect from './ModelSelect'
import MarkdownRenderer from './MarkdownRenderer'
import Select from './Select'
import { BrandLogo, CloseIcon, CopyIcon, PlusIcon, RefreshIcon, TrashIcon } from './icons'

const QUICK_PROMPTS = [
  '帮我写一段商品介绍',
  '把这段话改得更专业',
  '生成一份 API 对接说明',
  '整理成小红书风格文案',
  '帮我写一份排查清单',
]

const TEXT_PROFILE_ID = 'yy-text-profile'
const MAX_CHAT_REFERENCE_IMAGES = 8

function ChatImageThumb({ imageId, onClick }: { imageId: string; onClick: () => void }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    void ensureImageCached(imageId).then((value) => {
      if (!cancelled && value) setSrc(value)
    })
    return () => {
      cancelled = true
    }
  }, [imageId])

  if (!src) return <div className="h-24 w-24 animate-pulse rounded-lg bg-white/[0.06]" />
  return <img src={src} alt="对话参考图" className="h-24 w-24 cursor-zoom-in rounded-lg object-cover" onClick={onClick} />
}

function getTextProfile() {
  const settings = normalizeSettings(useStore.getState().settings)
  return settings.profiles.find((profile) => profile.id === TEXT_PROFILE_ID)
    ?? settings.profiles.find((profile) => profile.provider === 'openai' && profile.apiMode === 'responses')
}

function getActiveConversation(conversations: ChatConversation[], activeId: string | null, model: string) {
  return conversations.find((conversation) => conversation.id === activeId)
    ?? conversations[0]
    ?? null
}

export default function ChatWorkspace() {
  const settings = useStore((s) => s.settings)
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const input = useChatStore((s) => s.input)
  const model = useChatStore((s) => s.model)
  const status = useChatStore((s) => s.status)
  const setInput = useChatStore((s) => s.setInput)
  const setModel = useChatStore((s) => s.setModel)
  const createConversation = useChatStore((s) => s.createConversation)
  const setActiveConversationId = useChatStore((s) => s.setActiveConversationId)
  const deleteConversationAndReturnNext = useChatStore((s) => s.deleteConversationAndReturnNext)
  const clearActiveConversation = useChatStore((s) => s.clearActiveConversation)
  const addMessage = useChatStore((s) => s.addMessage)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const setStatus = useChatStore((s) => s.setStatus)
  const showToast = useStore((s) => s.showToast)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const activeConversation = getActiveConversation(conversations, activeConversationId, model)
  const messages = activeConversation?.messages ?? []
  const activeTarget = activeConversation?.channelTarget || getPlaygroundApiChannelTarget('text')
  const settingsTextProfile = useMemo(() => (
    settings.profiles.find((profile) => profile.id === TEXT_PROFILE_ID)
      ?? settings.profiles.find((profile) => profile.provider === 'openai' && profile.apiMode === 'responses')
  ), [settings])
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [referenceImages, setReferenceImages] = useState<InputImage[]>([])

  useEffect(() => {
    if (!activeConversation && conversations.length === 0) createConversation()
  }, [activeConversation, conversations.length, createConversation])

  useEffect(() => {
    const nextModel = settingsTextProfile?.model?.trim()
    const safeModel = nextModel && isModelForPurpose(nextModel, 'text')
      ? nextModel
      : isModelForPurpose(model, 'text') ? model : DEFAULT_CHAT_MODEL
    if (safeModel === model && activeConversation?.model === safeModel) return
    setModel(safeModel, getPlaygroundApiChannelTarget('text'))
  }, [activeConversation?.model, model, settingsTextProfile?.model, setModel])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, messages[messages.length - 1]?.content, status])

  const copyMessage = useCallback(async (content: string, successMessage = '内容已复制') => {
    if (!content.trim()) return
    try {
      await copyTextToClipboard(content)
      showToast(successMessage, 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制失败', err), 'error')
    }
  }, [showToast])

  const copyLastAssistant = useCallback(async () => {
    const last = [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim())
    if (!last) {
      showToast('还没有可复制的回复', 'info')
      return
    }
    await copyMessage(last.content, '已复制最后回复')
  }, [copyMessage, messages, showToast])

  const handleReferenceUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return
    const available = MAX_CHAT_REFERENCE_IMAGES - referenceImages.length
    if (available <= 0) {
      showToast(`参考图最多 ${MAX_CHAT_REFERENCE_IMAGES} 张`, 'error')
      return
    }

    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (!imageFiles.length) {
      showToast('请选择图片文件', 'error')
      return
    }

    try {
      const added: InputImage[] = []
      for (const file of imageFiles.slice(0, available)) {
        const image = await createInputImageFromFile(file)
        if (image) added.push(image)
      }
      if (!added.length) return
      setReferenceImages((current) => [...current, ...added].slice(0, MAX_CHAT_REFERENCE_IMAGES))
      showToast(`已添加 ${added.length} 张参考图`, 'success')
    } catch (err) {
      showToast(`参考图上传失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [referenceImages.length, showToast])

  const removeReferenceImage = useCallback((index: number) => {
    const image = referenceImages[index]
    if (!image) return
    setReferenceImages((current) => current.filter((_, currentIndex) => currentIndex !== index))
    void deleteImageIfUnreferenced(image.id)
  }, [referenceImages])

  const cleanupChatImages = useCallback((imageIds: string[]) => {
    for (const imageId of new Set(imageIds)) void deleteImageIfUnreferenced(imageId)
  }, [])

  const handleCreateConversation = useCallback(() => {
    const draftImageIds = referenceImages.map((image) => image.id)
    setReferenceImages([])
    createConversation()
    cleanupChatImages(draftImageIds)
  }, [cleanupChatImages, createConversation, referenceImages])

  const handleClearConversation = useCallback(() => {
    const imageIds = messages.flatMap((message) => message.imageIds ?? [])
    clearActiveConversation()
    cleanupChatImages(imageIds)
  }, [cleanupChatImages, clearActiveConversation, messages])

  const refreshModels = useCallback(() => {
    void getModelGroups('text', true).then(() => showToast('文本模型已刷新', 'success')).catch(() => showToast('模型刷新失败', 'error'))
  }, [showToast])

  const submit = useCallback(async () => {
    const text = input.trim() || (referenceImages.length ? '请分析这些参考图。' : '')
    if (!text || status === 'streaming') return
    const profile = getTextProfile()
    if (!profile?.apiKey?.trim()) {
      showToast('请先在设置里填写文本模型访问令牌', 'error')
      return
    }

    const userMessage = createChatMessage('user', text, referenceImages.map((image) => image.id))
    const assistantMessage = createChatMessage('assistant', '')
    setInput('')
    setReferenceImages([])
    addMessage(userMessage)
    addMessage(assistantMessage)
    setStatus('streaming')
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const nextMessages = await Promise.all([...messages, userMessage].map(async (message) => ({
        ...message,
        imageDataUrls: (await Promise.all((message.imageIds ?? []).map((imageId) => ensureImageCached(imageId))))
          .filter((value): value is string => Boolean(value)),
      })))
      const finalText = await callTextChatApi({
        profile: {
          ...profile,
          baseUrl: getPlaygroundApiResolvedTarget('text'),
        },
        model: activeConversation?.model || model || profile.model || DEFAULT_CHAT_MODEL,
        messages: nextMessages,
        signal: controller.signal,
        onDelta: (delta) => {
          const current = useChatStore.getState().conversations
            .flatMap((conversation) => conversation.messages)
            .find((message) => message.id === assistantMessage.id)
          updateMessage(assistantMessage.id, { content: `${current?.content ?? ''}${delta}` })
        },
      })
      updateMessage(assistantMessage.id, { content: finalText })
      setStatus('idle')
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        updateMessage(assistantMessage.id, { content: '已停止生成' })
        setStatus('idle')
        return
      }
      const message = err instanceof Error ? err.message : '对话请求失败'
      updateMessage(assistantMessage.id, { content: message, error: message })
      setStatus('error')
      showToast(message, 'error')
    } finally {
      abortRef.current = null
    }
  }, [activeConversation?.model, addMessage, input, messages, model, referenceImages, setInput, setStatus, showToast, status, updateMessage])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const activeTitle = useMemo(() => activeConversation?.title || '新对话', [activeConversation?.title])
  const conversationOptions = useMemo(() => [
    { label: '新对话', value: '__new__', variant: 'action' as const },
    ...conversations.map((conversation) => ({
      label: conversation.title || '新对话',
      value: conversation.id,
      actions: [{
        label: '删除',
        variant: 'danger' as const,
        onClick: () => {
          const imageIds = conversation.messages.flatMap((message) => message.imageIds ?? [])
          const nextId = deleteConversationAndReturnNext(conversation.id)
          if (!nextId) createConversation()
          cleanupChatImages(imageIds)
        },
      }],
    })),
  ], [cleanupChatImages, conversations, createConversation, deleteConversationAndReturnNext])

  return (
    <main data-home-main className="pb-48">
      <div className="safe-area-x mx-auto max-w-7xl px-3 pt-4 sm:px-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2 shadow-[0_16px_50px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleCreateConversation}
            className="inline-flex h-[42px] shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-gray-200"
          >
            <PlusIcon className="h-4 w-4" />
            新对话
          </button>
          <div className="min-w-0 flex-1">
            <Select
              value={activeConversation?.id ?? ''}
              options={conversationOptions}
              onChange={(value) => {
                if (value === '__new__') {
                  handleCreateConversation()
                  return
                }
                setActiveConversationId(String(value))
              }}
              className="h-[42px] rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-sm font-semibold text-gray-100 transition hover:bg-white/[0.08]"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ModelSelect
              purpose="text"
              value={activeConversation?.model || model || DEFAULT_CHAT_MODEL}
              target={activeTarget}
              fallbackModels={[DEFAULT_CHAT_MODEL, 'gpt-4.1-mini', 'gpt-4o-mini']}
              onSelect={(target, nextModel) => {
                const channelApiKey = getPlaygroundModelChannelApiKey(target)
                const storedApiKey = getStoredPlaygroundPurposeConfig(target, 'text').apiKey
                const apiKey = channelApiKey || storedApiKey?.trim() || getTextProfile()?.apiKey || ''
                if (target) setPlaygroundApiChannelTarget(target, 'text')
                if (target) savePlaygroundPurposeConfig(target, 'text', { apiKey, model: nextModel })
                if (target) {
                  const state = useStore.getState()
                  const existingTextProfile = getTextProfile()
                  const fallbackProfile = state.settings.profiles.find((profile) => profile.provider === 'openai') ?? state.settings.profiles[0]
                  const textProfile = existingTextProfile ?? (fallbackProfile ? {
                    ...fallbackProfile,
                    id: TEXT_PROFILE_ID,
                    name: '对话',
                    provider: 'openai' as const,
                    apiMode: 'responses' as const,
                    codexCli: false,
                    streamImages: false,
                  } : null)
                  if (textProfile) {
                    const updatedTextProfile = { ...textProfile, model: nextModel, baseUrl: resolvePlaygroundModelChannelTarget(target), apiKey }
                    const profiles = existingTextProfile
                      ? state.settings.profiles.map((profile) => profile.id === textProfile.id ? updatedTextProfile : profile)
                      : [...state.settings.profiles, updatedTextProfile]
                    state.setSettings({ profiles })
                  }
                }
                setModel(nextModel, target)
              }}
              className="yy-model-select h-[42px] min-w-[150px] w-[150px] rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-gray-100 outline-none transition hover:bg-white/[0.08] sm:w-[180px]"
            />
            <button type="button" onClick={refreshModels} className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-gray-400 transition hover:bg-white/[0.08] hover:text-white" aria-label="刷新模型">
              <RefreshIcon className="h-4 w-4" />
            </button>
            <button type="button" onClick={copyLastAssistant} className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-gray-400 transition hover:bg-white/[0.08] hover:text-white" aria-label="复制最后回复">
              <CopyIcon className="h-4 w-4" />
            </button>
            <button type="button" onClick={handleClearConversation} className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-gray-400 transition hover:bg-white/[0.08] hover:text-white" aria-label="清空对话">
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <section className="mx-auto w-full max-w-3xl">
          {messages.length === 0 ? (
            <div className="flex min-h-[calc(100vh-330px)] flex-col items-center justify-center py-20 text-center">
                <BrandLogo className="mb-4 h-12 w-12 rounded-2xl shadow-[0_0_30px_rgba(14,165,233,0.30)]" />
                <h2 className="text-xl font-bold text-white">你好，我是 Y² 绘影 文本助手</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-500">写文案、改表达、做说明、整理方案都可以直接问。选择文本模型后，使用 Ctrl + Enter 发送。</p>
                <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-gray-300 transition hover:bg-white/[0.08] hover:text-white"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
          ) : (
            <div className="space-y-5 py-8">
                {messages.map((message) => (
                  <div key={message.id} className={`group flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-[min(760px,92%)] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === 'user' ? 'bg-white text-black' : message.error ? 'border border-red-500/25 bg-red-500/10 text-red-200' : 'bg-white/[0.06] text-gray-100'}`}>
                      {message.imageIds?.length ? (
                        <div className="mb-3 flex max-w-full flex-wrap gap-2">
                          {message.imageIds.map((imageId) => (
                            <ChatImageThumb key={imageId} imageId={imageId} onClick={() => setLightboxImageId(imageId, message.imageIds)} />
                          ))}
                        </div>
                      ) : null}
                      {message.role === 'assistant'
                        ? <MarkdownRenderer content={message.content || (status === 'streaming' ? '正在思考…' : '')} streaming={status === 'streaming'} />
                        : <div className="whitespace-pre-wrap">{message.content}</div>}
                    </div>
                    {message.content.trim() && (
                      <button
                        type="button"
                        onClick={() => void copyMessage(message.content, message.role === 'assistant' ? '回复已复制' : '问题已复制')}
                        className="mt-1 flex h-7 w-7 items-center justify-center rounded-md text-gray-500 opacity-70 transition hover:bg-white/[0.06] hover:text-gray-300 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        aria-label={message.role === 'assistant' ? '复制回复' : '复制问题'}
                        title={message.role === 'assistant' ? '复制回复' : '复制问题'}
                      >
                        <CopyIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <div ref={endRef} />
              </div>
          )}
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-4 sm:px-4">
        <div className="safe-area-x mx-auto max-w-3xl rounded-[1.75rem] border border-white/[0.08] bg-[#0d0d0d]/95 p-3 shadow-2xl backdrop-blur">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleReferenceUpload(event.target.files)
              event.target.value = ''
            }}
          />
          {referenceImages.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
              {referenceImages.map((image, index) => (
                <div key={image.id} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/[0.1] bg-white/[0.04]">
                  <img
                    src={image.dataUrl}
                    alt={`参考图 ${index + 1}`}
                    className="h-full w-full cursor-zoom-in object-cover"
                    onClick={() => setLightboxImageId(image.id, referenceImages.map((item) => item.id))}
                  />
                  <button
                    type="button"
                    onClick={() => removeReferenceImage(index)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-red-500"
                    aria-label={`移除参考图 ${index + 1}`}
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
            rows={3}
            placeholder={referenceImages.length ? '描述你想针对参考图询问的问题…' : '输入问题，Ctrl + Enter 发送…'}
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-gray-100 outline-none placeholder:text-gray-500"
          />
          <div className="mt-2 flex items-center justify-between gap-2 px-1">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={referenceImages.length >= MAX_CHAT_REFERENCE_IMAGES || status === 'streaming'}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs text-gray-300 transition hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                title="上传参考图"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                参考图
              </button>
              {QUICK_PROMPTS.slice(0, 3).map((prompt) => (
                <button key={prompt} type="button" onClick={() => setInput(prompt)} className="hidden rounded-full bg-white/[0.05] px-3 py-1.5 text-xs text-gray-400 transition hover:bg-white/[0.08] hover:text-white sm:inline-flex">
                  {prompt}
                </button>
              ))}
            </div>
            {status === 'streaming' ? (
              <button type="button" onClick={stop} className="rounded-full bg-white/[0.08] px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.14]">
                停止
              </button>
            ) : (
              <button type="button" onClick={() => void submit()} disabled={!input.trim() && referenceImages.length === 0} className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40">
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
