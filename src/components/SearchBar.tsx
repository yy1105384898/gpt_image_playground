import { useEffect, useRef, type ReactNode } from 'react'
import { ALL_FAVORITES_COLLECTION_ID, clearFailedTasks, getTaskFavoriteCollectionIds, useStore, taskMatchesFilterStatus, taskMatchesSearchQuery } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import Select from './Select'
import { ChevronLeftIcon, CollectionManageIcon, FavoriteIcon, PlusIcon, TrashIcon } from './icons'
import ViewportTooltip from './ViewportTooltip'

function SearchActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const tooltipState = useTooltip()

  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button
        type="button"
        onClick={() => {
          tooltipState.dismiss()
          if (disabled) return
          onClick()
        }}
        disabled={disabled}
        className={className}
        aria-label={tooltip}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export default function SearchBar() {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const clearSelection = useStore((s) => s.clearSelection)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const setActiveFavoriteCollectionId = useStore((s) => s.setActiveFavoriteCollectionId)
  const openManageCollectionsModal = useStore((s) => s.openManageCollectionsModal)
  const setShowPromptLibrary = useStore((s) => s.setShowPromptLibrary)
  const failedCount = useStore((s) => {
    const q = s.searchQuery.trim().toLowerCase()
    return s.tasks.filter((task) => {
      if (!taskMatchesFilterStatus(task, 'error')) return false
      if (s.filterFavorite) {
        if (!task.isFavorite) return false
        if (s.activeFavoriteCollectionId && s.activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task).includes(s.activeFavoriteCollectionId)) return false
      }
      return taskMatchesSearchQuery(task, q)
    }).length
  })
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const inCollectionOverview = filterFavorite && !activeFavoriteCollectionId
  const isFailedFilter = filterStatus === 'error'
  const favoriteTooltip = activeFavoriteCollectionId ? '返回收藏夹' : filterFavorite ? '退出收藏夹' : '收藏夹'

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (document.activeElement !== inputRef.current) return

      const target = event.target instanceof Element ? event.target : document.elementFromPoint(event.clientX, event.clientY)
      if (!target) return
      if (rootRef.current?.contains(target)) return
      if (!target.closest('[data-drag-select-surface]')) return
      if (target.closest('.task-card-wrapper, .favorite-collection-card-wrapper')) return

      inputRef.current?.blur()
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown, true)
  }, [])

  const handleFavoriteClick = () => {
    if (activeFavoriteCollectionId) {
      setActiveFavoriteCollectionId(null)
      return
    }
    setFilterFavorite(!filterFavorite)
  }

  const handleClearFailed = () => {
    const state = useStore.getState()
    const q = state.searchQuery.trim().toLowerCase()
    const failedTaskIds = state.tasks
      .filter((task) => {
        if (!taskMatchesFilterStatus(task, 'error')) return false
        if (state.filterFavorite) {
          if (!task.isFavorite) return false
          if (state.activeFavoriteCollectionId && state.activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task).includes(state.activeFavoriteCollectionId)) return false
        }
        return taskMatchesSearchQuery(task, q)
      })
      .map((task) => task.id)
    const failedTaskCount = failedTaskIds.length
    if (failedTaskCount === 0) return

    setConfirmDialog({
      title: '清除失败记录',
      message: `确定清除筛选范围内的失败记录吗？\n纯失败任务会被删除；部分失败任务只会清除失败标记，保留已成功图片。共 ${failedTaskCount} 条记录。`,
      confirmText: '清除',
      cancelText: '取消',
      tone: 'danger',
      action: () => clearFailedTasks(failedTaskIds),
    })
  }

  const handleStatusChange = (val: any) => {
    if (val === filterStatus) return
    setFilterStatus(val)
    clearSelection()
  }

  return (
    <div ref={rootRef} data-no-drag-select className="mb-4 mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2 shadow-[0_16px_50px_rgba(0,0,0,0.18)] backdrop-blur-xl">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <button
          type="button"
          onClick={() => setShowPromptLibrary(true)}
          className="inline-flex h-[42px] shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-gray-200"
        >
          <PlusIcon className="h-4 w-4" />
          提示词库
        </button>
        <SearchActionButton
          tooltip={favoriteTooltip}
          onClick={handleFavoriteClick}
          className={`h-[42px] px-3 rounded-xl border transition-all inline-flex items-center gap-2 text-sm font-semibold ${
            filterFavorite
              ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-500/10 text-yellow-500'
              : 'border-white/[0.08] bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] hover:text-white'
          }`}
        >
          {activeFavoriteCollectionId ? <ChevronLeftIcon className="w-5 h-5" /> : <FavoriteIcon filled={filterFavorite} className="w-5 h-5" />}
          <span>{activeFavoriteCollectionId ? '返回' : '收藏'}</span>
        </SearchActionButton>
        {inCollectionOverview && (
          <SearchActionButton
            tooltip="管理收藏夹"
            onClick={openManageCollectionsModal}
            className="inline-flex h-[42px] items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-gray-300 transition-all hover:bg-white/[0.08] hover:text-white"
          >
            <CollectionManageIcon className="w-5 h-5" />
          </SearchActionButton>
        )}
        {!inCollectionOverview && (
          <>
            <div className="relative w-full sm:w-[112px]">
              <Select
                value={filterStatus}
                onChange={handleStatusChange}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '已完成', value: 'done' },
                  { label: '生成中', value: 'running' },
                  { label: '失败', value: 'error' },
                ]}
                className="h-[42px] rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-gray-200 transition hover:bg-white/[0.08] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            {isFailedFilter && (
              <button
                type="button"
                onClick={handleClearFailed}
                disabled={failedCount === 0}
                title={failedCount > 0 ? `清除 ${failedCount} 条失败记录` : '没有失败记录'}
                aria-label={failedCount > 0 ? `清除 ${failedCount} 条失败记录` : '没有失败记录'}
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-gray-400 transition-all hover:bg-white/[0.08] hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <TrashIcon className="h-[18px] w-[18px]" />
              </button>
            )}
          </>
        )}
        <div className="relative z-10 min-w-[180px] flex-1">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          type="text"
          placeholder={inCollectionOverview ? '搜索收藏夹名称...' : '搜索提示词、参数...'}
          className="h-[42px] w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-2.5 pl-10 pr-4 text-sm text-gray-100 transition placeholder:text-gray-500 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        </div>
      </div>
    </div>
  )
}
