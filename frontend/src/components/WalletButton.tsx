import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { useCardano, currentNetwork } from '../hooks/useCardano'
import { useI18n } from '../i18n'
import { useClickOutside } from '../hooks/useClickOutside'

const WALLET_ICON: Record<string, string> = {
  vespr: '/wallets/vespr.png',
  nami: '/wallets/nami.png',
  eternl: '/wallets/eternl.png',
  lace: '/wallets/lace.png',
  flint: '/wallets/flint.svg',
  yoroi: '/wallets/yoroi.svg',
  gerowallet: '/wallets/gerowallet.svg',
  nufi: '/wallets/nufi.svg',
  begin: '/wallets/begin.png',
  typhoncip30: '/wallets/typhon.svg',
  typhon: '/wallets/typhon.svg',
  exodus: '/wallets/exodus.svg',
  tokeo: '/wallets/tokeo.svg',
}

function WalletIcon({ name, cip30Icon }: { name: string; cip30Icon?: string | null }) {
  const [failed, setFailed] = useState(false)
  const key = name.toLowerCase()
  const src = WALLET_ICON[key]
  const imgSrc = (!failed && src) ? src : (!failed && cip30Icon) ? cip30Icon : null

  if (imgSrc) {
    return <img src={imgSrc} alt="" className="w-7 h-7 rounded-lg shrink-0 object-contain" onError={() => setFailed(true)} />
  }
  return (
    <span className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white bg-slate-600 shrink-0">
      {name[0]?.toUpperCase()}
    </span>
  )
}

export default function WalletButton() {
  const { wallet, availableWallets, connectWallet, disconnectWallet, loading } = useCardano()
  const { t } = useI18n()
  const [showDropdown, setShowDropdown] = useState(false)
  const [copied, setCopied] = useState(false)
  const location = useLocation()
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setShowDropdown(false) }, [location.pathname])
  const close = useCallback(() => setShowDropdown(false), [])
  useClickOutside(dropdownRef, close, showDropdown)

  if (wallet.connected) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="bg-slate-800 hover:bg-slate-700 text-white text-[10px] sm:text-sm font-medium px-1.5 sm:px-4 py-1.5 sm:py-2.5 rounded-[10px] sm:rounded-xl transition-all border border-slate-600 flex items-center shrink-0 whitespace-nowrap"
        >
          <span className="text-emerald-400 mr-1 sm:mr-1.5">●</span>
          <span className="sm:hidden">{wallet.address.startsWith('addr') ? `${wallet.address.slice(0, 10)}..${wallet.address.slice(-4)}` : `${wallet.address.slice(0, 6)}..${wallet.address.slice(-3)}`}</span>
          <span className="hidden sm:inline">{wallet.address.startsWith('addr') ? `${wallet.address.slice(0, 12)}...${wallet.address.slice(-6)}` : `${wallet.address.slice(0, 8)}...${wallet.address.slice(-4)}`}</span>
        </button>
        {showDropdown && (
          <div className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-16px)] bg-slate-800/95 backdrop-blur-lg border border-slate-600/50 rounded-2xl shadow-2xl z-[70] overflow-hidden py-2">
            <div className="px-4 py-2 border-b border-slate-700/50">
              <p className="text-slate-500 text-[10px]">{wallet.walletName}</p>
              <div className="flex items-center gap-1.5">
                <p className="text-white text-xs font-mono truncate flex-1">{wallet.address.slice(0, 8)}...{wallet.address.slice(-4)}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(wallet.address); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                  className="text-slate-500 hover:text-cyan-400 transition-colors shrink-0"
                  title="Copy address"
                >
                  {copied
                    ? <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    : <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  }
                </button>
              </div>
            </div>
            <div className="px-4 py-2 space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 text-[10px]">USDCx</span>
                <span className="text-emerald-400 text-sm font-semibold">{(Number(wallet.usdcxBalance) / 1e6).toFixed(2)}</span>
              </div>
              {wallet.vusdcxBalance > 0n && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 text-[10px]">Vault Shares</span>
                  <span className="text-cyan-400 text-sm font-semibold">{Number(wallet.vusdcxBalance) >= 1e12 ? (Number(wallet.vusdcxBalance) / 1e12).toFixed(2) + 'T' : Number(wallet.vusdcxBalance) >= 1e9 ? (Number(wallet.vusdcxBalance) / 1e9).toFixed(2) + 'B' : Number(wallet.vusdcxBalance).toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700/50">
              <button
                onClick={() => { disconnectWallet(); setShowDropdown(false) }}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Disconnect
              </button>
              <span className={`text-[9px] px-1.5 py-[1px] rounded font-mono font-bold tracking-wide ${currentNetwork === 'mainnet' ? 'text-emerald-400 bg-emerald-500/20 border border-emerald-500/30' : 'text-amber-400 bg-amber-500/20 border border-amber-500/30'}`}>
                {currentNetwork === 'mainnet' ? 'MAINNET' : 'PREPROD'}
              </span>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={loading}
        className="btn-shine bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 disabled:from-slate-600 disabled:to-slate-600 text-white text-[10px] sm:text-[13px] md:text-sm font-semibold px-2.5 sm:px-4 md:px-5 py-1.5 sm:py-2 md:py-2.5 rounded-lg sm:rounded-xl transition-all duration-200 shadow-lg shadow-cyan-500/30 whitespace-nowrap shrink-0"
      >
        <span className="sm:hidden">{loading ? '...' : t('wallet.connect').replace('Wallet', '').trim()}</span>
        <span className="hidden sm:inline">{loading ? t('wallet.connecting') : t('wallet.connect')}</span>
      </button>
      {showDropdown && (
        <>
          {availableWallets.length > 0 ? (
            <div className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-16px)] bg-slate-800/95 backdrop-blur-lg border border-slate-600/50 rounded-2xl shadow-2xl z-[70] overflow-hidden max-h-96 overflow-y-auto py-1.5">
              <p className="text-slate-500 text-[10px] uppercase tracking-wider font-medium px-4 pt-1.5 pb-2">Select Wallet</p>
              {availableWallets.map(w => (
                <button
                  key={w.name}
                  onClick={() => { connectWallet(w.name); setShowDropdown(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-slate-700/70 transition-colors flex items-center gap-3"
                >
                  <WalletIcon name={w.name} cip30Icon={w.icon} />
                  <span className="font-medium">{w.displayName}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="absolute right-0 mt-2 w-60 bg-slate-800/95 backdrop-blur-lg border border-slate-600/50 rounded-2xl shadow-2xl z-[70] p-4">
              <p className="text-slate-400 text-xs">{t('wallet.noWallet')}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
