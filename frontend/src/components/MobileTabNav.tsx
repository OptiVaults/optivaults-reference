import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useI18n } from '../i18n'

const TABS: { key: string; path: string; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', path: '/', label: 'nav.dashboard', icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> },
  { key: 'deposit', path: '/deposit', label: 'nav.deposit', icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 13 12 18 7 13"/><line x1="12" y1="18" x2="12" y2="6"/></svg> },
  { key: 'withdraw', path: '/withdraw', label: 'nav.withdraw', icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 11 12 6 17 11"/><line x1="12" y1="6" x2="12" y2="18"/></svg> },
  { key: 'history', path: '/history', label: 'nav.history', icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
  { key: 'keeper', path: '/keeper', label: 'nav.keeper', icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg> },
]

/** Fixed bottom tab bar — mobile only (md:hidden). Renders globally from App.tsx. */
export default function MobileTabNav() {
  const { t } = useI18n()
  const location = useLocation()

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass-card border-t border-slate-700/50 safe-area-bottom">
      <div className="grid grid-cols-5 h-14">
        {TABS.map(tab => {
          const isActive = tab.path === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.path)
          return (
            <NavLink
              key={tab.key}
              to={tab.path}
              className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? 'text-cyan-400' : 'text-slate-500 active:text-white'
              }`}
            >
              {tab.icon}
              <span className="text-[9px] font-medium">{t(tab.label)}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
