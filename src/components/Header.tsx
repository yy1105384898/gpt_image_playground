import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useVersionCheck } from '../hooks/useVersionCheck'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { useFavoriteCollectionTitle } from './FavoriteCollections'
import { BrandLogo, HelpCircleIcon, InstallIcon, SettingsIcon } from './icons'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isInstalledPwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const favoriteCollectionTitle = useFavoriteCollectionTitle()
  const showFavoriteCollectionTitle = appMode === 'gallery' && Boolean(activeFavoriteCollectionId)
  const { hasUpdate, latestRelease, dismiss } = useVersionCheck()
  const [showHelp, setShowHelp] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPwaInstalled, setIsPwaInstalled] = useState(isInstalledPwa)
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up')

  useEffect(() => {
    if (appMode === 'agent') {
      setScrollDirection('up')
      return
    }

    let lastScrollY = window.scrollY
    let ticking = false

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY
          if (currentScrollY < 20) {
            setScrollDirection('up')
          } else if (currentScrollY > lastScrollY + 10) {
            setScrollDirection('down')
          } else if (currentScrollY < lastScrollY - 10) {
            setScrollDirection('up')
          }
          lastScrollY = currentScrollY
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [appMode])

  const installTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setIsPwaInstalled(false)
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setIsPwaInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstallClick = async () => {
    if (installPrompt) {
      const promptEvent = installPrompt
      setInstallPrompt(null)

      try {
        await promptEvent.prompt()
        const choice = await promptEvent.userChoice
        setIsPwaInstalled(choice.outcome === 'accepted')
      } catch {
        setIsPwaInstalled(isInstalledPwa())
      }
    } else {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      if (isIos) {
        setConfirmDialog({
          title: '安装为应用',
          message: '在 Safari 浏览器中，点击底部「分享」按钮，选择「添加到主屏幕」即可安装此应用。',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      } else {
        setConfirmDialog({
          title: '安装为应用',
          message: '请在浏览器的菜单中选择「添加到主屏幕」或「安装应用」。\n\n（如果在微信等内置浏览器中，请先在外部浏览器打开）',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      }
    }
  }

  return (
    <>
      <header data-no-drag-select className="safe-area-top fixed top-0 left-0 right-0 z-40 translate-y-0 bg-[#050506]/88 backdrop-blur-xl border-b border-white/[0.07] transition-transform duration-300 ease-in-out">
        <div className="safe-area-x safe-header-inner max-w-7xl mx-auto grid grid-cols-[1fr_auto_1fr] items-center relative">
          <div className="flex-1 min-w-0 pr-2 flex items-center gap-2">
            <h1 className="inline-flex min-w-0 items-start relative mr-2">
              {showFavoriteCollectionTitle ? (
                <>
                  <span className="min-w-0 truncate text-[17px] font-bold tracking-tight text-white sm:hidden" title={favoriteCollectionTitle}>{favoriteCollectionTitle}</span>
                  <span className="hidden items-center gap-2 text-lg font-black text-white sm:inline-flex">
                    <BrandLogo className="h-8 w-8 rounded-xl shadow-[0_0_22px_rgba(14,165,233,0.30)]" />
                    <span>Y² 绘影</span>
                  </span>
                </>
              ) : (
                <span className="inline-flex min-w-0 items-center gap-2 text-[17px] sm:text-lg font-black text-white">
                  <BrandLogo className="h-8 w-8 shrink-0 rounded-xl shadow-[0_0_22px_rgba(14,165,233,0.30)]" />
                  <span className="truncate">Y² 绘影</span>
                </span>
              )}
              {hasUpdate && latestRelease && (
                <a
                  href={latestRelease.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={dismiss}
                  className="absolute -right-1 -top-1 translate-x-full -translate-y-1/4 px-1 py-0.5 rounded-[4px] border border-red-500/30 text-[9px] font-black bg-red-500 text-white hover:bg-red-600 transition-all animate-fade-in leading-none shadow-sm"
                  title={`新版本 ${latestRelease.tag}`}
                >
                  NEW
                </a>
              )}
            </h1>
          </div>
          {showFavoriteCollectionTitle && (
            <div className="absolute left-1/2 top-1/2 hidden max-w-[30%] -translate-x-1/2 -translate-y-1/2 sm:flex">
              <div className="truncate rounded px-2 py-1 text-sm font-semibold text-gray-700 dark:text-gray-300" title={favoriteCollectionTitle}>
                {favoriteCollectionTitle}
              </div>
            </div>
          )}
          <div className="hidden sm:flex items-center gap-1 justify-self-center rounded-full border border-white/[0.08] bg-white/[0.045] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <button
              type="button"
              onClick={() => setAppMode('agent')}
              className={`px-5 py-2 rounded-full text-sm transition-colors ${appMode === 'agent' ? 'bg-white text-black shadow-sm font-semibold' : 'text-gray-400 hover:text-white'}`}
            >
              对话
            </button>
            <button
              type="button"
              onClick={() => setAppMode('gallery')}
              className={`px-5 py-2 rounded-full text-sm transition-colors ${appMode === 'gallery' ? 'bg-white text-black shadow-sm font-semibold' : 'text-gray-400 hover:text-white'}`}
            >
              图片
            </button>
            <button
              type="button"
              onClick={() => setAppMode('video')}
              className={`px-5 py-2 rounded-full text-sm transition-colors ${appMode === 'video' ? 'bg-white text-black shadow-sm font-semibold' : 'text-gray-400 hover:text-white'}`}
            >
              视频
            </button>
          </div>
          <div className="flex items-center gap-1 shrink-0 justify-self-end">
            {!isPwaInstalled && (
              <div
                className="relative"
                {...installTooltip.handlers}
              >
                <button
                  onClick={() => {
                    dismissAllTooltips()
                    handleInstallClick()
                  }}
                  className="p-2 rounded-xl text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white"
                  aria-label="安装为应用"
                >
                  <InstallIcon className="w-5 h-5" />
                </button>
                <ViewportTooltip visible={installTooltip.visible} className="whitespace-nowrap">
                  安装为应用
                </ViewportTooltip>
              </div>
            )}
            <div
              className="relative"
              {...helpTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="p-2 rounded-xl text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="w-5 h-5" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <div
              className="relative"
              {...settingsTooltip.handlers}
            >
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-xl text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white"
                aria-label="设置"
              >
                <SettingsIcon className="w-5 h-5" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
          </div>
        </div>
        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 opacity-0 pb-0' : 'max-h-20 opacity-100 pb-2'}`}>
          <div className="grid grid-cols-3 gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] p-1 mx-2">
            <button
              type="button"
              onClick={() => setAppMode('agent')}
              className={`px-4 py-1.5 rounded-full text-sm transition-colors ${appMode === 'agent' ? 'bg-white text-black shadow-sm font-semibold' : 'text-gray-400 hover:text-white'}`}
            >
              对话
            </button>
            <button
              type="button"
              onClick={() => setAppMode('gallery')}
              className={`px-4 py-1.5 rounded-full text-sm transition-colors ${appMode === 'gallery' ? 'bg-white text-black shadow-sm font-semibold' : 'text-gray-400 hover:text-white'}`}
            >
              图片
            </button>
            <button
              type="button"
              onClick={() => setAppMode('video')}
              className={`px-4 py-1.5 rounded-full text-sm transition-colors ${appMode === 'video' ? 'bg-white text-black shadow-sm font-semibold' : 'text-gray-400 hover:text-white'}`}
            >
              视频
            </button>
          </div>
        </div>
      </header>
      
      <div className="safe-area-top invisible pointer-events-none max-h-[500px] opacity-100 transition-all duration-300 ease-in-out" aria-hidden="true">
        <div className="safe-header-inner" />
        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 pb-0' : 'max-h-20 pb-2'}`}>
          <div className="p-1">
            <div className="py-1.5 text-sm">占位</div>
          </div>
        </div>
      </div>
      {showHelp && <HelpModal appMode={appMode} isFavoriteCollectionOverview={appMode === 'gallery' && filterFavorite && !activeFavoriteCollectionId} onClose={() => setShowHelp(false)} />}
    </>
  )
}
