import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { clearFailedTasks, useStore, taskMatchesFilterStatus, taskMatchesSearchQuery } from '../store'
import { ALL_FAVORITES_COLLECTION_ID, getTaskFavoriteCollectionIds } from '../lib/favoriteState'
import { removeMultipleTasks } from '../store'
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
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const tasks = useStore((s) => s.tasks)
  const defaultFavoriteCollectionId = useStore((s) => s.defaultFavoriteCollectionId)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const failedCount = useStore((s) => {
    const q = s.searchQuery.trim().toLowerCase()
    return s.tasks.filter((task) => {
      if (!taskMatchesFilterStatus(task, 'error')) return false
      if (s.filterFavorite) {
        if (!task.isFavorite) return false
        if (s.activeFavoriteCollectionId && s.activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task, s.defaultFavoriteCollectionId).includes(s.activeFavoriteCollectionId)) return false
      }
      return taskMatchesSearchQuery(task, q)
    }).length
  })
  const inCollectionOverview = filterFavorite && !activeFavoriteCollectionId
  const isFailedFilter = filterStatus === 'error'
  const favoriteTooltip = activeFavoriteCollectionId ? '返回收藏夹' : filterFavorite ? '退出收藏夹' : '收藏夹'
  const visibleTaskIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return tasks.filter((task) => {
      if (filterFavorite) {
        if (!task.isFavorite) return false
        if (activeFavoriteCollectionId && activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task, defaultFavoriteCollectionId).includes(activeFavoriteCollectionId)) return false
      }
      if (!taskMatchesFilterStatus(task, filterStatus)) return false
      return taskMatchesSearchQuery(task, q)
    }).map((task) => task.id)
  }, [activeFavoriteCollectionId, defaultFavoriteCollectionId, filterFavorite, filterStatus, searchQuery, tasks])
  const allVisibleSelected = visibleTaskIds.length > 0 && visibleTaskIds.every((id) => selectedTaskIds.includes(id))

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
          if (state.activeFavoriteCollectionId && state.activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task, state.defaultFavoriteCollectionId).includes(state.activeFavoriteCollectionId)) return false
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

  const handleStatusChange = (val: string | number) => {
    if (val === filterStatus) return
    if (val === 'all' || val === 'done' || val === 'running' || val === 'error') {
      setFilterStatus(val)
      clearSelection()
    }
  }

  const handleSelectAll = () => {
    const visibleIdSet = new Set(visibleTaskIds)
    if (allVisibleSelected) {
      setSelectedTaskIds((current) => current.filter((id) => !visibleIdSet.has(id)))
      return
    }
    setSelectedTaskIds((current) => Array.from(new Set([...current, ...visibleTaskIds])))
  }

  const handleDeleteSelected = () => {
    if (!selectedTaskIds.length) return
    const taskIds = [...selectedTaskIds]
    setConfirmDialog({
      title: '批量删除',
      message: `确定要删除选中的 ${taskIds.length} 个任务吗？`,
      confirmText: '删除',
      tone: 'danger',
      action: () => removeMultipleTasks(taskIds),
    })
  }

  return (
    <div ref={rootRef} data-no-drag-select className="mb-5 mt-4 border-b border-white/[0.08] pb-4">
      <div className="grid gap-2 lg:grid-cols-[auto_auto_auto_minmax(220px,1fr)] lg:items-center">
        <button
          type="button"
          onClick={() => setShowPromptLibrary(true)}
          className="inline-flex h-[42px] shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-black transition hover:bg-gray-200"
        >
          <PlusIcon className="h-4 w-4" />
          提示词库
        </button>

        <div className="flex min-w-0 gap-2">
          <SearchActionButton
            tooltip={favoriteTooltip}
            onClick={handleFavoriteClick}
            className={`h-[42px] px-3 rounded-xl border transition-all inline-flex items-center gap-2 text-sm font-semibold ${
              filterFavorite
                ? 'border-yellow-400 bg-yellow-400/12 text-yellow-300'
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
        </div>

        {!inCollectionOverview ? (
          <div className="flex min-w-0 gap-2">
            <div className="w-full min-w-[116px] sm:w-[132px]">
              <Select
                value={filterStatus}
                onChange={handleStatusChange}
                options={[
                  { label: '全部状态', value: 'all' },
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
            <SearchActionButton
              tooltip={allVisibleSelected ? '取消全选' : `全选当前任务（${visibleTaskIds.length}）`}
              onClick={handleSelectAll}
              disabled={visibleTaskIds.length === 0}
              className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-40 ${
                allVisibleSelected
                  ? 'border-blue-400 bg-blue-400/12 text-blue-300'
                  : 'border-white/[0.08] bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-200'
              }`}
            >
              <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M8 12l2.5 2.5L16 9" />
              </svg>
            </SearchActionButton>
            <SearchActionButton
              tooltip={selectedTaskIds.length ? `删除选中（${selectedTaskIds.length}）` : '请先选择任务'}
              onClick={handleDeleteSelected}
              disabled={selectedTaskIds.length === 0}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-gray-400 transition-all hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <TrashIcon className="h-[18px] w-[18px]" />
            </SearchActionButton>
          </div>
        ) : (
          <div />
        )}

        <div className="relative z-10 min-w-0">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
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
