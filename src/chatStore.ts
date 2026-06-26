import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ChatRole = 'user' | 'assistant'
export type ChatStatus = 'idle' | 'streaming' | 'error'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  error?: string
}

export interface ChatConversation {
  id: string
  title: string
  messages: ChatMessage[]
  model: string
  channelTarget?: string
  createdAt: number
  updatedAt: number
}

interface ChatState {
  activeConversationId: string | null
  conversations: ChatConversation[]
  input: string
  model: string
  status: ChatStatus
  setInput: (input: string) => void
  setModel: (model: string, channelTarget?: string) => void
  createConversation: () => string
  setActiveConversationId: (id: string) => void
  deleteConversation: (id: string) => void
  deleteConversationAndReturnNext: (id: string) => string | null
  clearActiveConversation: () => void
  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void
  setStatus: (status: ChatStatus) => void
}

export const DEFAULT_CHAT_MODEL = 'gpt-5.5'

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function createEmptyConversation(model = DEFAULT_CHAT_MODEL): ChatConversation {
  const now = Date.now()
  return {
    id: newId('chat'),
    title: '新对话',
    messages: [],
    model,
    createdAt: now,
    updatedAt: now,
  }
}

function deriveTitle(content: string) {
  const compact = content.trim().replace(/\s+/g, ' ')
  if (!compact) return '新对话'
  const chars = Array.from(compact)
  return chars.length > 18 ? `${chars.slice(0, 18).join('')}...` : compact
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      activeConversationId: null,
      conversations: [],
      input: '',
      model: DEFAULT_CHAT_MODEL,
      status: 'idle',
      setInput: (input) => set({ input }),
      setModel: (model, channelTarget) => set((state) => {
        const activeId = state.activeConversationId
        return {
          model,
          conversations: state.conversations.map((conversation) =>
            conversation.id === activeId
              ? { ...conversation, model, channelTarget, updatedAt: Date.now() }
              : conversation,
          ),
        }
      }),
      createConversation: () => {
        const conversation = createEmptyConversation(get().model)
        set((state) => ({
          activeConversationId: conversation.id,
          conversations: [conversation, ...state.conversations],
          input: '',
          status: 'idle',
        }))
        return conversation.id
      },
      setActiveConversationId: (id) => set((state) => ({
        activeConversationId: state.conversations.some((conversation) => conversation.id === id) ? id : state.activeConversationId,
        status: 'idle',
      })),
      deleteConversation: (id) => set((state) => {
        const conversations = state.conversations.filter((conversation) => conversation.id !== id)
        const activeConversationId = state.activeConversationId === id
          ? conversations[0]?.id ?? null
          : state.activeConversationId
        return { conversations, activeConversationId, status: 'idle' }
      }),
      deleteConversationAndReturnNext: (id) => {
        let nextActiveId: string | null = null
        set((state) => {
          const conversations = state.conversations.filter((conversation) => conversation.id !== id)
          nextActiveId = state.activeConversationId === id
            ? conversations[0]?.id ?? null
            : state.activeConversationId
          return { conversations, activeConversationId: nextActiveId, status: 'idle' }
        })
        return nextActiveId
      },
      clearActiveConversation: () => {
        const activeId = get().activeConversationId
        if (!activeId) return
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            conversation.id === activeId
              ? { ...conversation, messages: [], title: '新对话', updatedAt: Date.now() }
              : conversation,
          ),
          status: 'idle',
        }))
      },
      addMessage: (message) => set((state) => {
        const activeId = state.activeConversationId ?? createEmptyConversation(state.model).id
        const existing = state.conversations.find((conversation) => conversation.id === activeId)
        const base = existing ?? createEmptyConversation(state.model)
        const nextMessageCount = base.messages.length + 1
        const title = nextMessageCount === 1 && message.role === 'user'
          ? deriveTitle(message.content)
          : base.title
        const updated = { ...base, title, messages: [...base.messages, message], updatedAt: Date.now() }
        return {
          activeConversationId: updated.id,
          conversations: existing
            ? state.conversations.map((conversation) => conversation.id === updated.id ? updated : conversation)
            : [updated, ...state.conversations],
        }
      }),
      updateMessage: (id, patch) => set((state) => ({
        conversations: state.conversations.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => message.id === id ? { ...message, ...patch } : message),
          updatedAt: conversation.messages.some((message) => message.id === id) ? Date.now() : conversation.updatedAt,
        })),
      })),
      setStatus: (status) => set({ status }),
    }),
    {
      name: 'yy-text-chat-store',
      partialize: (state) => ({
        activeConversationId: state.activeConversationId,
        conversations: state.conversations.slice(0, 40).map((conversation) => ({
          ...conversation,
          messages: conversation.messages.slice(-80),
        })),
        model: state.model,
      }),
    },
  ),
)

export function createChatMessage(role: ChatRole, content: string): ChatMessage {
  return {
    id: newId(role),
    role,
    content,
    createdAt: Date.now(),
  }
}
