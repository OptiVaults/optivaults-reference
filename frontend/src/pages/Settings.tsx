/**
 * Settings Page — user preferences + BYO Blockfrost key (Block 5)
 */
import { useState, useEffect } from 'react'
import { useI18n } from '../i18n'
import InfoRow from '../components/InfoRow'
import { hasUserApiKey, setUserApiKey, testApiKey } from '../lib/blockfrost'

type KeyTestStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; magic: number }
  | { state: 'error'; message: string }

export default function Settings() {
  const { t, lang, setLang } = useI18n()
  const [defaultMode, setDefaultMode] = useState(() => localStorage.getItem('optivaults-default-mode') || 'direct')

  // BYO Blockfrost key state (Block 5).
  const [keyInput, setKeyInput] = useState('')
  const [hasUserKey, setHasUserKey] = useState(() => hasUserApiKey())
  const [keyTest, setKeyTest] = useState<KeyTestStatus>({ state: 'idle' })

  useEffect(() => { window.scrollTo(0, 0) }, [])

  useEffect(() => {
    localStorage.setItem('optivaults-default-mode', defaultMode)
  }, [defaultMode])

  async function handleTestAndSave() {
    if (!keyInput.trim()) return
    setKeyTest({ state: 'testing' })
    const result = await testApiKey(keyInput.trim())
    if (!result.ok) {
      setKeyTest({ state: 'error', message: result.error })
      return
    }
    setUserApiKey(keyInput.trim())
    setHasUserKey(true)
    setKeyTest({ state: 'ok', magic: result.networkMagic })
    setKeyInput('')
  }

  function handleClearKey() {
    setUserApiKey('')
    setHasUserKey(false)
    setKeyInput('')
    setKeyTest({ state: 'idle' })
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('settings.title') || 'Settings'}</h1>
        <p className="text-slate-400 text-sm sm:text-base mt-1">{t('settings.desc') || 'Customize your experience'}</p>
      </div>

      {/* Preferences */}
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold text-white">{t('settings.preferences')}</h2>

        {/* Language */}
        <div className="flex justify-between items-center">
          <span className="text-slate-400 text-sm">{t('settings.language')}</span>
          <select
            value={lang}
            onChange={e => setLang(e.target.value as 'en' | 'zh')}
            className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-1.5"
          >
            <option value="en">English</option>
            <option value="zh">繁體中文</option>
          </select>
        </div>

        {/* Default Withdraw Mode */}
        <div className="flex justify-between items-center">
          <span className="text-slate-400 text-sm">{t('settings.defaultMode')}</span>
          <select
            value={defaultMode}
            onChange={e => setDefaultMode(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-1.5"
          >
            <option value="direct">{t('settings.directOption')}</option>
            <option value="queue">{t('settings.queueOption')}</option>
          </select>
        </div>

      </div>

      {/* BYO Blockfrost API key (Block 5) */}
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-white">{t('settings.networkKey') || 'Blockfrost API key'}</h2>
          <p className="text-slate-500 text-xs sm:text-sm mt-1">
            {t('settings.networkKeyDesc')
              || 'Use your own Blockfrost project_id for higher rate limits (50,000 req/day on the free tier). Sign up at blockfrost.io.'}
          </p>
        </div>

        {hasUserKey ? (
          <div className="flex items-center justify-between gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
            <span className="text-emerald-300 text-xs sm:text-sm flex-1">
              {t('settings.networkKeyActive') || 'Custom key active — using your Blockfrost project_id.'}
            </span>
            <button
              onClick={handleClearKey}
              className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs px-3 py-1.5 rounded-lg transition-colors"
            >
              {t('settings.networkKeyClear') || 'Clear'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => { setKeyInput(e.target.value); setKeyTest({ state: 'idle' }) }}
              placeholder="preprod... / mainnet..."
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 font-mono focus:border-cyan-500/50 focus:outline-none"
            />
            <button
              onClick={handleTestAndSave}
              disabled={keyInput.trim().length === 0 || keyTest.state === 'testing'}
              className="bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              {keyTest.state === 'testing'
                ? (t('settings.networkKeyTesting') || 'Testing...')
                : (t('settings.networkKeySave') || 'Test & Save')}
            </button>
          </div>
        )}

        {keyTest.state === 'error' && (
          <p className="text-red-400 text-xs">
            {t('settings.networkKeyError') || 'Test failed'}: {keyTest.message}
          </p>
        )}
        {keyTest.state === 'ok' && hasUserKey && (
          <p className="text-emerald-400 text-xs">
            {t('settings.networkKeyOk') || 'Key validated and saved.'} (magic: {keyTest.magic})
          </p>
        )}
        <p className="text-slate-500 text-[11px] sm:text-xs">
          {t('settings.networkKeyPrivacy')
            || 'Stored locally in your browser only. Never sent to any server outside Blockfrost.'}
        </p>
      </div>

      {/* Contract Info */}
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-3">
        <h2 className="text-base font-semibold text-white">{t('settings.contract')}</h2>
        <InfoRow label={t('settings.version')} value="V1 (Withdraw-Zero)" icon={<span className="text-violet-400 text-sm">V1</span>} />
        <InfoRow label={t('settings.pattern')} value="Proxy + 10 staking validators (Withdraw-Zero dispatch)" icon={<span className="text-cyan-400 text-sm">WZ</span>} />
        <InfoRow label={t('settings.audits')} value="Multi-round internal audit complete; third-party audit target Q2-Q3 2027" icon={<span className="text-emerald-400 text-sm">A</span>} />
        <InfoRow label={t('settings.tests')} value="235 unit + property tests / 730 randomized checks (Aiken)" icon={<span className="text-amber-400 text-sm">QA</span>} />
      </div>

      {/* Links */}
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-3">
        <h2 className="text-base font-semibold text-white">{t('settings.links')}</h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'GitHub', href: 'https://github.com/OptiVaults/optivaults-protocol' },
            { label: 'Whitepaper', href: 'https://github.com/OptiVaults/optivaults-protocol/blob/v1/whitepaper/whitepaper.md' },
            { label: 'Architecture', href: 'https://github.com/OptiVaults/optivaults-protocol/blob/v1/spec/architecture.md' },
            { label: 'Emergency Tool', href: 'https://github.com/OptiVaults/optivaults-reference/tree/v1/emergency-withdraw' },
          ].map(link => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-center py-2 rounded-xl bg-slate-800/50 border border-slate-700/50 text-slate-300 hover:text-cyan-400 hover:border-cyan-500/30 text-xs sm:text-sm transition-all"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
