import { useState, useEffect, useRef, useCallback } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import LangToggle from './components/LangToggle'
import WalletButton from './components/WalletButton'
import Dashboard from './pages/Dashboard'
import Deposit from './pages/Deposit'
import Withdraw from './pages/Withdraw'
import History from './pages/History'
import KeeperHistory from './pages/KeeperHistory'
import Emergency from './pages/Emergency'
import Settings from './pages/Settings'
import MobileTabNav from './components/MobileTabNav'
import { CardanoProvider, useCardano, currentNetwork } from './hooks/useCardano'
import { I18nProvider, useI18n } from './i18n'
import { useClickOutside } from './hooks/useClickOutside'

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { t } = useI18n()
  const location = useLocation()
  const menuRef = useRef<HTMLElement>(null)

  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  const close = useCallback(() => setMenuOpen(false), [])
  useClickOutside(menuRef, close, menuOpen)

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `block px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${isActive
      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
      : 'text-slate-400 hover:text-white hover:bg-slate-800'
    }`

  return (
    <nav ref={menuRef} className="sticky top-0 z-50 glass-card border-b border-slate-700/50 px-2.5 sm:px-6 py-2 md:py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-1 sm:gap-2 md:gap-4 relative">
        <div className="flex shrink min-w-[70px] items-center">
          <NavLink to="/" className="flex items-center gap-1 sm:gap-2 md:gap-3 shrink transition-transform hover:scale-[1.02] min-w-0">
            <img src="/icon.png" alt="OptiVaults" className="w-[22px] h-[22px] sm:w-[34px] sm:h-[34px] md:w-10 md:h-10 rounded-md sm:rounded-lg shrink-0" />
            <span className="text-[15px] sm:text-xl md:text-2xl font-bold gradient-text truncate">OptiVaults</span>
          </NavLink>
        </div>

        <div className="hidden md:flex items-center justify-center gap-1 lg:gap-2 shrink-0">
          <NavLink to="/" end className={linkClass}>{t('nav.dashboard')}</NavLink>
          <NavLink to="/deposit" className={linkClass}>{t('nav.deposit')}</NavLink>
          <NavLink to="/withdraw" className={linkClass}>{t('nav.withdraw')}</NavLink>
          <NavLink to="/history" className={linkClass}>{t('nav.history')}</NavLink>
          <NavLink to="/keeper" className={linkClass}>{t('nav.keeper')}</NavLink>
          <NavLink
            to="/emergency"
            className={({ isActive }) =>
              `block px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-1.5 ${
                isActive
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/10'
              }`
            }
            title={t('nav.emergency')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            <span className="hidden lg:inline">{t('nav.emergency')}</span>
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </NavLink>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1 sm:gap-1.5 md:gap-2">
          <LangToggle />
          <WalletButton />
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden text-slate-400 active:text-white p-2 sm:p-2 shrink-0 ml-0.5 sm:ml-0 min-w-[40px] min-h-[40px] flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              }
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="md:hidden mt-3 pt-3 border-t border-slate-700/50 space-y-1">
          <NavLink to="/" end className={linkClass} onClick={() => setMenuOpen(false)}>
            <span className="flex items-center gap-2"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>{t('nav.dashboard')}</span>
          </NavLink>
          <NavLink to="/deposit" className={linkClass} onClick={() => setMenuOpen(false)}>
            <span className="flex items-center gap-2"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 13 12 18 7 13" /><line x1="12" y1="18" x2="12" y2="6" /></svg>{t('nav.deposit')}</span>
          </NavLink>
          <NavLink to="/withdraw" className={linkClass} onClick={() => setMenuOpen(false)}>
            <span className="flex items-center gap-2"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 11 12 6 17 11" /><line x1="12" y1="6" x2="12" y2="18" /></svg>{t('nav.withdraw')}</span>
          </NavLink>
          <NavLink to="/history" className={linkClass} onClick={() => setMenuOpen(false)}>
            <span className="flex items-center gap-2"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>{t('nav.history')}</span>
          </NavLink>
          <NavLink to="/keeper" className={linkClass} onClick={() => setMenuOpen(false)}>
            <span className="flex items-center gap-2"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>{t('nav.keeper')}</span>
          </NavLink>
          <NavLink to="/emergency" className={linkClass} onClick={() => setMenuOpen(false)}>
            <span className="flex items-center gap-2"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>{t('nav.emergency')}</span>
          </NavLink>
          <NavLink to="/settings" className={linkClass} onClick={() => setMenuOpen(false)}>
            <span className="flex items-center gap-2"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>{t('settings.title')}</span>
          </NavLink>
        </div>
      )}
    </nav>
  )
}

function AppFooter() {
  const { t } = useI18n()
  return (
    <footer className="relative border-t border-slate-800/80 px-4 mt-12 bg-slate-900/50 backdrop-blur-sm pb-tabnav">
      <div className="max-w-5xl mx-auto py-12 sm:py-16">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2.5 mb-2 hover:opacity-80 transition-opacity">
            <img src="/icon.png" alt="OptiVaults" className="w-6 h-6 sm:w-8 sm:h-8 rounded-md shadow-lg shadow-cyan-500/10" />
            <span className="text-white text-base sm:text-lg font-bold tracking-tight">OptiVaults</span>
          </div>
          <p className="text-slate-300 text-xs sm:text-sm text-center mb-6 font-medium max-w-xs">{t('footer.tagline')}</p>
          <div className="flex items-center justify-center gap-4 sm:gap-8 mb-6 flex-wrap">
            <a href="https://github.com/OptiVaults/optivaults-protocol" target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2 text-slate-400 hover:text-white text-xs sm:text-sm transition-all">
              <svg className="w-4 h-4 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
              GitHub
            </a>
            <div className="h-3 w-px fallback-slate-700 bg-slate-700 hidden sm:block"></div>
            <a href="https://optivaults.app" className="text-slate-400 hover:text-cyan-400 text-xs sm:text-sm transition-colors font-medium">optivaults.app</a>
            <div className="h-3 w-px fallback-slate-700 bg-slate-700 hidden sm:block"></div>
            <a href="https://github.com/OptiVaults/optivaults-protocol/blob/v1/spec/architecture.md" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-cyan-400 text-xs sm:text-sm transition-colors font-medium">Docs</a>
            <div className="h-3 w-px fallback-slate-700 bg-slate-700 hidden sm:block"></div>
            <a href="https://github.com/OptiVaults/optivaults-protocol/blob/v1/whitepaper/whitepaper.md" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-cyan-400 text-xs sm:text-sm transition-colors font-medium">Whitepaper</a>
            <div className="h-3 w-px fallback-slate-700 bg-slate-700 hidden sm:block"></div>
            <span className="text-slate-400 text-xs sm:text-sm font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span>
              Aiken PlutusV3
            </span>
          </div>
          <div className="flex flex-col items-center gap-2 mb-4">
            <div className="px-3 py-1 bg-slate-800/50 rounded-full border border-slate-700/50 flex items-center gap-3">
              <p className="text-slate-300 text-[11px] sm:text-xs tracking-tight">{t('footer.builtOn')}</p>
              <div className="w-px h-2.5 bg-slate-700"></div>
              <p className="text-slate-300 text-[11px] sm:text-xs tracking-tight">{t('footer.yieldSource')}</p>
            </div>
          </div>
          <p className="text-slate-500 text-[10px] sm:text-xs text-center max-w-xl mx-auto leading-relaxed border-t border-slate-800/50 pt-4 opacity-70">
            {t('footer.disclaimer')}
          </p>
        </div>
      </div>
    </footer>
  )
}

function NetworkMismatchBanner() {
  const { networkMismatch } = useCardano()
  if (!networkMismatch) return null
  return (
    <div className="bg-red-600 text-white text-center text-sm py-2 px-4 font-medium">
      Network mismatch: Frontend is configured for {currentNetwork} but your wallet is on a different network. Switch your wallet to {currentNetwork} or transactions will fail.
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <BrowserRouter>
          <CardanoProvider>
          <ToastProvider>
            <div className="min-h-screen bg-slate-900">
              <Navbar />
              <NetworkMismatchBanner />
              <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-20 md:pb-10">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/deposit" element={<Deposit />} />
                  <Route path="/withdraw" element={<Withdraw />} />
                  <Route path="/history" element={<History />} />
                  <Route path="/keeper" element={<KeeperHistory />} />
                  <Route path="/emergency" element={<Emergency />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </main>
              <AppFooter />
              <MobileTabNav />
            </div>
          </ToastProvider>
          </CardanoProvider>
        </BrowserRouter>
      </I18nProvider>
    </ErrorBoundary>
  )
}
