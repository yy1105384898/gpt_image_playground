// Self-contained store for the video tab. Kept separate from the main image
// store so the (complex) image task pipeline is untouched.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { VIDEO_MODELS, VIDEO_DURATIONS, VIDEO_ASPECTS, type VideoStatus } from './lib/videoApi'

export interface VideoTask {
  id: string
  localId: string
  prompt: string
  model: string
  seconds: number
  aspect: string
  status: VideoStatus
  videoUrl?: string
  error?: string
  createdAt: number
}

export interface VideoParams {
  model: string
  seconds: number
  aspect: string
}

interface VideoState {
  prompt: string
  params: VideoParams
  tasks: VideoTask[]
  setPrompt: (p: string) => void
  setParams: (patch: Partial<VideoParams>) => void
  addTask: (task: VideoTask) => void
  updateTask: (localId: string, patch: Partial<VideoTask>) => void
  removeTask: (localId: string) => void
  clearTasks: () => void
}

const DEFAULT_PARAMS: VideoParams = {
  model: VIDEO_MODELS[0],
  seconds: VIDEO_DURATIONS[2], // 10s
  aspect: VIDEO_ASPECTS[0].value, // 9:16
}

export const useVideoStore = create<VideoState>()(
  persist(
    (set) => ({
      prompt: '',
      params: DEFAULT_PARAMS,
      tasks: [],
      setPrompt: (prompt) => set({ prompt }),
      setParams: (patch) => set((s) => ({ params: { ...s.params, ...patch } })),
      addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),
      updateTask: (localId, patch) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.localId === localId ? { ...t, ...patch } : t)) })),
      removeTask: (localId) => set((s) => ({ tasks: s.tasks.filter((t) => t.localId !== localId) })),
      clearTasks: () => set({ tasks: [] }),
    }),
    {
      name: 'yy-video-store',
      // Object URLs from blobs don't survive reloads; drop in-flight/blob tasks on rehydrate.
      partialize: (s) => ({
        prompt: s.prompt,
        params: s.params,
        tasks: s.tasks.filter((t) => t.status === 'completed' && t.videoUrl?.startsWith('http')),
      }),
    },
  ),
)
