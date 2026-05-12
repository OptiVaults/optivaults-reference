import { useState, useRef, useCallback } from 'react'
import { useI18n } from '../i18n'
import { useClickOutside } from '../hooks/useClickOutside'

export default function LangToggle() {
  const { lang, setLang } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useClickOutside(ref, close, open)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-slate-400 hover:text-white active:text-cyan-400 p-2 sm:p-2 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 active:bg-slate-700/70 transition-colors flex items-center justify-center shrink-0 min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0"
        title="Language"
      >
        <svg className="w-[18px] h-[18px] sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          <path d="M2 12h20" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-32 bg-slate-800/95 backdrop-blur-lg border border-slate-600/50 rounded-xl shadow-xl z-[80] overflow-hidden py-1">
          {(['en', 'zh', 'ja'] as const).map(l => (
            <button
              key={l}
              onClick={() => { setLang(l); setOpen(false) }}
              className={`w-full text-left px-4 py-2.5 text-xs sm:text-sm transition-colors ${lang === l ? 'bg-cyan-500/20 text-cyan-400 font-medium' : 'text-slate-300 hover:bg-slate-700/50'}`}
            >
              {l === 'en' ? 'English' : l === 'zh' ? '繁體中文' : '日本語'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
