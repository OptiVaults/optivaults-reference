/**
 * Cardano Wallet Hook — CIP-30 + direct Blockfrost (read + write paths)
 *
 * Block 2: read paths (wallet balance, TX-status polling, vault state,
 * market APY) talk to Blockfrost directly via `lib/blockfrost`,
 * `lib/vaultQuery`, `lib/marketQuery`.
 *
 * Block 3: write paths (deposit / withdraw / queue order / cancel)
 * build TXs in-browser via `lib/txBuilder`, sign with CIP-30, and
 * submit via the Lucid Blockfrost provider. JWT auth + the legacy
 * `/api/build-*-tx` + `/api/submit-tx` endpoints are no longer used.
 */
import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { fetchAddressBalance, fetchTxStatus } from '../lib/blockfrost'
import { queryVaultState } from '../lib/vaultQuery'
import { V1_CONFIG, isV1Configured } from '../lib/v1Config'
import { selectWalletFromCip30, submitTolerant, _resetLucidCache } from '../lib/lucidClient'
import { buildDirectDepositTx, buildDirectWithdrawTx } from '../lib/txBuilder'
import { hexAddressToBech32 } from '../lib/cardanoAddr'

// Dynamic import to avoid WASM crash at page load
// Lucid modules loaded lazily on first wallet connect
let _mod: any = null
async function loadLucid() {
  if (!_mod) {
    // Suppress UPLC WASM __wbindgen_start error (we use Ogmios for TX eval, not browser UPLC)
    const origError = console.error
    console.error = (...args: any[]) => {
      const msg = String(args[0] || '')
      if (msg.includes('wbindgen') || msg.includes('void 0')) return
      origError.apply(console, args)
    }
    try {
      _mod = await import('@lucid-evolution/lucid')
    } catch (e) {
      // WASM init may throw but the core Lucid functions still work
      if (!_mod) _mod = await import('@lucid-evolution/lucid').catch(() => null)
      if (!_mod) throw new Error('Failed to load Lucid library')
    } finally {
      console.error = origError
    }
  }
  return _mod as {
    Lucid: any; Blockfrost: any; Data: any; Constr: any;
    paymentCredentialOf: any; CML: any;
  }
}
type LucidEvolution = any
type WalletApi = any

// ═══════════════════════════════════
// Config
// ═══════════════════════════════════

const NETWORK_ENV = (import.meta.env.VITE_NETWORK || 'preprod') as 'preprod' | 'mainnet'
const VAULT_POLL_INTERVAL = 30_000 // 30s vault state polling
// Deposit-token policy resolution:
//   1. live VaultDatum.deposit_token_policy (truth — vault decides)
//   2. V1_CONFIG.depositTokenPolicy (build-time env override)
//   3. mainnet USDCx hardcoded fallback (last resort)
// Wallet-balance scans use `vault.depositTokenPolicy` directly when it
// has been populated (after first refreshVault); FALLBACK_USDCX_POLICY
// only applies in the narrow window between mount and first vault
// fetch.
const FALLBACK_USDCX_POLICY = V1_CONFIG.depositTokenPolicy
  || '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34'
const EXPLORER_BASE = NETWORK_ENV === 'mainnet'
  ? 'https://cardanoscan.io'
  : 'https://preprod.cardanoscan.io'

// ═══════════════════════════════════
// Types
// ═══════════════════════════════════

export interface VaultState {
  loaded: boolean
  exists: boolean
  totalDeposited: number
  totalShares: number
  idleBuffer: number
  sharePrice: number
  apyBps: number
  performanceFeeBps: number
  earlyWithdrawFeeBps: number
  bufferTargetBps: number
  unrealizedYieldTotal: number
  vaultAddr: string
  vusdcxPolicyId: string
  vusdcxUnit: string
  depositorCount: number
  nonDepositValue: number
  frozen: boolean
  /** Sum of `liqwid_positions[].supplied_value` (USDCx microunits).
   *  Used to weight blended APY in `marketQuery`. */
  liqwidPrincipal: number
  /** Hex28 — deposit-token policy from the live VaultDatum. Drives the
   *  wallet's USDCx-balance scan; falls back to V1_CONFIG presets when
   *  the vault hasn't loaded yet. */
  depositTokenPolicy: string
  /** Hex — deposit-token asset name. */
  depositTokenName: string
  /** Hex unit (`policy + name`) — convenience for asset lookup. */
  depositTokenUnit: string
}

export interface WalletState {
  connected: boolean
  walletName: string
  address: string
  adaBalance: bigint
  vusdcxBalance: bigint
  usdcxBalance: bigint
}

export type TxStatus = 'idle' | 'building' | 'signing' | 'processing' | 'submitted' | 'confirmed' | 'failed'

export const txExplorerUrl = (hash: string) => `${EXPLORER_BASE}/transaction/${hash}`
export const addrExplorerUrl = (addr: string) => `${EXPLORER_BASE}/address/${addr}`
export const currentNetwork = NETWORK_ENV

interface CardanoContextType {
  wallet: WalletState
  availableWallets: { name: string; icon: string | null; displayName: string }[]
  connectWallet: (name: string) => Promise<void>
  disconnectWallet: () => void
  vault: VaultState
  refreshVault: () => Promise<void>
  deposit: (amount: bigint, minReceive?: bigint, assetType?: string) => Promise<string>
  withdraw: (shares: bigint, minReceive?: bigint) => Promise<string>
  emergencyWithdraw: () => Promise<string>
  loading: boolean
  error: string | null
  txHash: string | null
  txStatus: TxStatus
  networkMismatch: boolean
  debugMsg: string
}

const CardanoContext = createContext<CardanoContextType | null>(null)

export function useCardano() {
  const ctx = useContext(CardanoContext)
  if (!ctx) throw new Error('useCardano must be inside CardanoProvider')
  return ctx
}

// ═══════════════════════════════════
// API Helpers
// ═══════════════════════════════════

// 通用 timeout wrapper — 防止 CIP-30 呼叫在錢包擴充套件 dom.js 橋接未就緒時無限卡住
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms)),
  ])
}

// ═══════════════════════════════════
// CIP-30 wallet API ref (module-level)
// ═══════════════════════════════════
//
// Block 3 fully migrated write paths to client-side Lucid + CIP-30. JWT
// auth (challenge / verify / Bearer header) was removed in the same
// pass — every TX is now built in-browser, signed by the user's
// wallet, and submitted via the Lucid Blockfrost provider. No bearer
// token needs to round-trip the operator API server.
//
// `_cip30Api` is kept for the rare case where a CIP-30 instance needs
// to be re-used across hooks (Eternl session continuity); active TX
// flow rebinds Lucid via `selectWalletFromCip30` on every wallet
// connect.

let _cip30Api: any = null

/**
 * Compatibility shim — the legacy `ensureAuthenticated` returned the
 * Authorization headers for protected API endpoints. Block 3 removed
 * those endpoints entirely; the shim now resolves to a plain
 * Content-Type header so any lingering caller doesn't break, but the
 * intent is for callers to stop calling this entirely.
 */
export async function ensureAuthenticated(_address: string): Promise<Record<string, string>> {
  return { 'Content-Type': 'application/json' }
}

// ═══════════════════════════════════
// Provider Component
// ═══════════════════════════════════

export function CardanoProvider({ children }: { children: ReactNode }) {
  const [lucid, setLucid] = useState<LucidEvolution | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [txStatus, setTxStatus] = useState<TxStatus>('idle')

  // TX confirmation polling via direct Blockfrost
  const pollTxConfirmation = useCallback(async (hash: string) => {
    setTxStatus('submitted')
    const maxAttempts = 60 // 5 minutes (5s intervals)
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000))
      try {
        const status = await fetchTxStatus(hash)
        if (status.confirmed) {
          setTxStatus('confirmed')
          // Refresh wallet balance after confirmation
          const w = walletRef.current
          if (w.address && w.address.startsWith('addr')) {
            const balData = await fetchAddressBalance(w.address).catch(() => null)
            if (balData) {
              const v = vaultRef.current
              const USDCX_P = (v?.depositTokenPolicy) || FALLBACK_USDCX_POLICY
              const vP = (v?.vusdcxPolicyId) || ''
              let vusdcx = 0n, usdcxBal = 0n
              for (const t of balData.tokens) {
                if (t.unit.startsWith(USDCX_P)) usdcxBal += t.quantity
                else if (vP && t.unit.startsWith(vP)) vusdcx += t.quantity
              }
              setWallet(prev => ({ ...prev, adaBalance: balData.lovelace, vusdcxBalance: vusdcx, usdcxBalance: usdcxBal }))
            }
          }
          return
        }
      } catch { /* Blockfrost unavailable / not yet indexed, retry */ }
    }
    setTxStatus('failed')
  }, [])

  const [wallet, setWallet] = useState<WalletState>({
    connected: false, walletName: '', address: '', adaBalance: 0n, vusdcxBalance: 0n, usdcxBalance: 0n,
  })
  const walletRef = useRef(wallet)
  walletRef.current = wallet
  const cip30ApiRef = useRef<any>(null)

  // Vault state ref so closures (pollTxConfirmation etc.) always see
  // the latest deposit_token / vusdcx policies after first fetch.
  // React-state alone wouldn't help here because pollTxConfirmation
  // is a useCallback with empty deps that captures the initial vault.
  const vaultRef = useRef<VaultState | null>(null)

  const [vault, setVault] = useState<VaultState>({
    loaded: false, exists: false, totalDeposited: 0, totalShares: 0, idleBuffer: 0,
    sharePrice: 1.0, apyBps: 21, performanceFeeBps: 450, earlyWithdrawFeeBps: 10,
    bufferTargetBps: 3500,
    unrealizedYieldTotal: 0,
    // Pre-populate identity fields from V1_CONFIG so the UI can render
    // wallet balance scans + signing-time vault-address verification
    // even before the first on-chain query lands.
    vaultAddr: V1_CONFIG.proxyAddr,
    vusdcxPolicyId: V1_CONFIG.vusdcxPolicy,
    vusdcxUnit: V1_CONFIG.vusdcxPolicy + V1_CONFIG.vusdcxName,
    depositorCount: 0,
    nonDepositValue: 0, frozen: false,
    liqwidPrincipal: 0,
    depositTokenPolicy: V1_CONFIG.depositTokenPolicy,
    depositTokenName: V1_CONFIG.depositTokenName,
    depositTokenUnit: V1_CONFIG.depositTokenPolicy + V1_CONFIG.depositTokenName,
  })

  // Mirror vault state into vaultRef so callbacks captured at mount
  // (pollTxConfirmation etc.) always read the latest deposit_token /
  // vusdcx policies, not the V1_CONFIG-default snapshot.
  vaultRef.current = vault

  // Detect wallets
  const [availableWallets, setAvailableWallets] = useState<{ name: string; icon: string | null; displayName: string }[]>([])
  useEffect(() => {
    const detect = () => {
      const w = window as any
      if (!w.cardano) { setAvailableWallets([]); return }
      const wallets: { name: string; icon: string | null; displayName: string }[] = []
      // Scan all CIP-30 wallets dynamically
      for (const key of Object.keys(w.cardano)) {
        try {
          const entry = w.cardano[key]
          if (entry && typeof entry === 'object' && typeof entry.enable === 'function') {
            const icon = typeof entry.icon === 'string' ? entry.icon : null
            const displayName = typeof entry.name === 'string' ? entry.name : key
            wallets.push({ name: key, icon, displayName })
          }
        } catch { /* skip non-wallet entries */ }
      }
      setAvailableWallets(wallets)
    }
    detect()
    // 2500ms 延遲：給 Eternl 等錢包擴充套件的 dom.js inter-frame 訊息橋接足夠握手時間
    // 冷啟動時，isEnabled() 可能已 true 但 getUsedAddresses() 訊息通道尚未就緒，導致卡死
    const t = setTimeout(() => {
      detect()
      // Auto-reconnect: only if wallet was previously connected AND is already authorized
      const saved = localStorage.getItem('optivaults-wallet')
      const hasConnectedBefore = localStorage.getItem('optivaults-connected') === 'true'
      if (saved && hasConnectedBefore && !wallet.connected) {
        const w = (window as any).cardano?.[saved]
        // Only auto-reconnect if wallet reports already enabled (no popup)
        if (w?.isEnabled) {
          withTimeout(w.isEnabled(), 5000, 'isEnabled').then((enabled: unknown) => {
            if (enabled) {
              connectWallet(saved).then(() => {
                // 成功連線後清除失敗計數
                localStorage.removeItem('optivaults-reconnect-fails')
              }).catch(() => {
                // 累積 2 次失敗才清除 saved wallet — 避免擴充套件暫時未就緒導致永久登出
                const failCount = Number(localStorage.getItem('optivaults-reconnect-fails') || '0') + 1
                if (failCount >= 2) {
                  localStorage.removeItem('optivaults-wallet')
                  localStorage.removeItem('optivaults-connected')
                  localStorage.removeItem('optivaults-reconnect-fails')
                } else {
                  localStorage.setItem('optivaults-reconnect-fails', String(failCount))
                }
              })
            }
          }).catch(() => {})
        }
      }
    }, 2500)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ═══════════════════════════════════
  // Balance Fetch via API Server (runs after wallet connect)
  // ═══════════════════════════════════

  const [debugMsg, setDebugMsg] = useState('')

  useEffect(() => {
    if (!wallet.connected || !wallet.address) return
    if (!wallet.address.startsWith('addr')) {
      setDebugMsg('address not bech32 — skipping balance fetch')
      return
    }
    setDebugMsg(`Fetching balance: ${wallet.address.slice(0, 20)}...`)
    let cancelled = false
    fetchAddressBalance(wallet.address)
      .then(data => {
        if (cancelled) return
        if (!data) { setDebugMsg(prev => prev + ' | no data'); return }
        setDebugMsg(prev => prev + ` | lovelace=${data.lovelace}`)
        let vusdcx = 0n
        let usdcx = 0n
        const vusdcxPolicy = vault.vusdcxPolicyId || ''
        const usdcxPolicy = vault.depositTokenPolicy || FALLBACK_USDCX_POLICY
        for (const t of data.tokens) {
          if (t.unit.startsWith(usdcxPolicy)) {
            usdcx += t.quantity
          } else if (vusdcxPolicy && t.unit.startsWith(vusdcxPolicy)) {
            vusdcx += t.quantity
          }
          // Other tokens are ignored
        }
        setWallet(w => ({
          ...w,
          adaBalance: data.lovelace,
          vusdcxBalance: vusdcx,
          usdcxBalance: usdcx,
        }))
        setDebugMsg(prev => prev + ` | set ada=${Number(data.lovelace)/1e6}`)
      })
      .catch((e) => {
        if (!cancelled) setDebugMsg(prev => prev + ` | ERROR: ${(e as Error).message}`)
      })
    return () => { cancelled = true }
  }, [wallet.connected, wallet.address, vault.depositTokenPolicy, vault.vusdcxPolicyId])

  // ═══════════════════════════════════
  // Network alignment check + vault fetch
  // ═══════════════════════════════════

  const [networkMismatch, setNetworkMismatch] = useState(false)

  // Network alignment is derived at build time — VITE_NETWORK
  // controls the Blockfrost endpoint URL (preprod vs mainnet subdomain)
  // and the wallet network check below, so they cannot diverge.
  // Mismatch surfaces via the wallet-side network probe in
  // `connectWallet` (CIP-30 `getNetworkId`).
  useEffect(() => {
    if (!isV1Configured()) {
      console.warn('[useCardano] V1 deployment not configured — vault state will show "not deployed" until VITE_PROXY_ADDR + VITE_VAULT_NFT_POLICY + VITE_VUSDCX_POLICY are set (or src/lib/v1Config.ts presets are populated).')
      setVault(v => ({ ...v, loaded: true }))
      return
    }
    setVault(v => ({ ...v, vaultAddr: V1_CONFIG.proxyAddr }))
  }, [])

  const refreshVault = useCallback(async () => {
    try {
      // Direct on-chain query — no API server dependency. Returns null
      // if the vault hasn't been deployed yet (or is between TXs and
      // not yet re-indexed by Blockfrost).
      const state = await queryVaultState()
      if (state && state.exists) {
        setVault(v => ({
          ...v,
          loaded: true,
          exists: true,
          totalDeposited: state.totalDeposited,
          totalShares: state.totalShares,
          idleBuffer: state.idleBuffer,
          sharePrice: state.sharePrice,
          performanceFeeBps: state.performanceFeeBps,
          earlyWithdrawFeeBps: state.earlyWithdrawFeeBps,
          bufferTargetBps: state.bufferTargetBps,
          unrealizedYieldTotal: state.unrealizedYieldTotal,
          vaultAddr: state.vaultAddr,
          vusdcxPolicyId: state.vusdcxPolicyId,
          vusdcxUnit: state.vusdcxPolicyId + V1_CONFIG.vusdcxName,
          depositorCount: state.depositorCount,
          nonDepositValue: state.nonDepositValue,
          frozen: state.frozen,
          liqwidPrincipal: state.liqwidPrincipal,
          depositTokenPolicy: state.depositTokenPolicy,
          depositTokenName: state.depositTokenName,
          depositTokenUnit: state.depositTokenUnit,
        }))
      } else if (state === null) {
        // Vault not found at proxy address — either not deployed yet
        // or in transient between-TX state. Mark loaded so the UI can
        // render the "vault not deployed" branch instead of staying
        // in the skeleton state forever.
        setVault(v => ({ ...v, loaded: true }))
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[useCardano] refreshVault failed:', (err as Error).message)
      }
      // Mark loaded so banners can surface the misconfig hint instead
      // of leaving the user in an indefinite skeleton state.
      setVault(v => ({ ...v, loaded: true }))
    }

    // Refresh wallet balances directly from chain via Blockfrost
    const w = walletRef.current
    if (w.connected && w.address && w.address.startsWith('addr')) {
      const balData = await fetchAddressBalance(w.address).catch(() => null)
      if (balData) {
        let vusdcx = 0n, usdcxBal = 0n
        const v = vaultRef.current
        const vP = (v?.vusdcxPolicyId) || ''
        const USDCX_P = (v?.depositTokenPolicy) || FALLBACK_USDCX_POLICY
        for (const t of balData.tokens) {
          if (t.unit.startsWith(USDCX_P)) usdcxBal += t.quantity
          else if (vP && t.unit.startsWith(vP)) vusdcx += t.quantity
        }
        setWallet(prev => ({ ...prev, adaBalance: balData.lovelace, vusdcxBalance: vusdcx, usdcxBalance: usdcxBal }))
      }
    }
  }, [lucid, wallet.connected, vault.vusdcxUnit, vault.depositTokenUnit])

  useEffect(() => { refreshVault() }, [refreshVault])

  // ═══════════════════════════════════
  // Vault state polling (30s interval)
  // ═══════════════════════════════════

  useEffect(() => {
    const timer = setInterval(() => { refreshVault() }, VAULT_POLL_INTERVAL)

    // Pause polling when tab is hidden, resume when visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshVault()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', handleVisibility) }
  }, [refreshVault])

  // ═══════════════════════════════════
  // Connect Wallet
  // ═══════════════════════════════════

  const connectWallet = useCallback(async (name: string) => {
    setLoading(true)
    setError(null)
    try {
      const w = (window as any).cardano?.[name]
      if (!w) throw new Error(`Wallet ${name} not found`)

      // 加 timeout：錢包擴充套件（特別是 Eternl）冷啟動時 dom.js 橋接可能未就緒，enable() 會掛住
      const api: WalletApi = await withTimeout(w.enable(), 10000, 'wallet.enable')
      cip30ApiRef.current = api // Save for later signTx calls
      void _cip30Api; _cip30Api = api // Module-level ref for auth

      // CIP-30 network probe — replaces the legacy /api/health-based
      // mismatch detection. `getNetworkId()` returns 0 for any testnet
      // (preprod/preview) and 1 for mainnet.
      try {
        const netId = (await withTimeout(api.getNetworkId(), 5000, 'getNetworkId')) as number
        const expected = NETWORK_ENV === 'mainnet' ? 1 : 0
        const mismatch = netId !== expected
        setNetworkMismatch(mismatch)
        if (mismatch) {
          console.error(`[NETWORK MISMATCH] Frontend: ${NETWORK_ENV} (id=${expected}), Wallet: id=${netId}`)
        }
      } catch (netErr) {
        if (import.meta.env.DEV) console.warn('[OptiVaults] getNetworkId failed:', netErr)
      }

      // Get address directly from CIP-30 API (no Lucid needed)
      let l: any = null
      let addr = ''
      let ada = 0n, vusdcx = 0n, usdcxBal = 0n

      try {
        // CIP-30: get address directly — timeout 保護防止擴充套件訊息橋卡死
        const addrs = await withTimeout(api.getUsedAddresses(), 8000, 'getUsedAddresses') as string[]
        let rawAddr = addrs.length > 0 ? addrs[0] : ''
        if (!rawAddr) {
          const unused = await withTimeout(api.getUnusedAddresses(), 8000, 'getUnusedAddresses') as string[]
          rawAddr = unused.length > 0 ? unused[0] : ''
        }
        if (rawAddr && !rawAddr.startsWith('addr')) {
          // Hex → bech32 conversion. CIP-30 wallets return raw bytes
          // as hex; Blockfrost speaks bech32 only.
          //
          // Strategy ladder (each successive fallback handles the
          // previous one's failure mode):
          //   1. Pure-JS BIP-173 bech32 encode in `lib/cardanoAddr` —
          //      no WASM, no Lucid dep, fastest path. This is the
          //      primary because the CML-based paths intermittently
          //      fail when Lucid Evolution's `__wbindgen_start` WASM
          //      init hits the suppressed-error branch.
          //   2. Cached Lucid module's CML.Address.from_hex if pure
          //      JS rejected the input (e.g., malformed header).
          //   3. Fresh dynamic import of CML as last resort.
          let converted = false
          try {
            addr = hexAddressToBech32(rawAddr)
            converted = true
          } catch (jsErr) {
            if (import.meta.env.DEV) console.warn('[OptiVaults] pure-JS bech32 encode failed:', jsErr)
          }
          if (!converted) {
            try {
              const mod = await loadLucid()
              if (mod?.CML) {
                addr = mod.CML.Address.from_hex(rawAddr).to_bech32()
                converted = true
              }
            } catch { /* CML load failed */ }
          }
          if (!converted) {
            try {
              const { CML } = await import('@lucid-evolution/lucid')
              addr = CML.Address.from_hex(rawAddr).to_bech32()
              converted = true
            } catch { /* also failed */ }
          }
          if (!converted) {
            // All conversion paths failed — keep raw hex; downstream
            // balance scan will skip with a clear console warning.
            addr = rawAddr
          }
        } else {
          addr = rawAddr
        }
        // Address logged only in dev
        if (import.meta.env.DEV) console.log('[OptiVaults] Address:', addr?.slice(0, 20))
      } catch (initErr) {
        if (import.meta.env.DEV) console.warn('[OptiVaults] CIP-30 address fetch failed:', initErr)
        if (!addr) throw new Error('Could not get wallet address')
      }

      // Get balance via direct Blockfrost (requires bech32 address; if CML
      // conversion failed earlier we skip — UI will retry on next render).
      console.info('[OptiVaults] connectWallet addr:', addr?.slice(0, 30), 'isBech32:', addr?.startsWith('addr'))
      if (addr && addr.startsWith('addr')) {
        const balData = await fetchAddressBalance(addr).catch((e) => {
          console.warn('[OptiVaults] Balance fetch failed:', e)
          return null
        })
        if (balData) {
          ada = balData.lovelace
          const vP = vault.vusdcxPolicyId || ''
          const usdcxPolicy = vault.depositTokenPolicy || FALLBACK_USDCX_POLICY
          console.info('[OptiVaults] balance scan policies:', { vP: vP.slice(0, 20), usdcxPolicy: usdcxPolicy.slice(0, 20), tokens: balData.tokens.length })
          for (const t of balData.tokens) {
            if (t.unit.startsWith(usdcxPolicy)) {
              usdcxBal += t.quantity
              console.info('[OptiVaults] matched USDCx:', t.unit.slice(0, 30), 'qty', t.quantity.toString())
            }
            else if (vP && t.unit.startsWith(vP)) vusdcx += t.quantity
          }
          console.info('[OptiVaults] final balances:', { ada: Number(ada) / 1e6, usdcxBal: Number(usdcxBal) / 1e6, vusdcx: Number(vusdcx) / 1e12 })
        }
      } else {
        console.warn('[OptiVaults] addr not bech32, skipping balance fetch — addr=', addr)
      }

      // JWT auth is lazy — only triggered when an endpoint needs it (deposit/withdraw)
      // Stored JWT from localStorage is used if still valid

      setLucid(l)
      localStorage.setItem('optivaults-wallet', name)
      localStorage.setItem('optivaults-connected', 'true')
      setWallet({ connected: true, walletName: name, address: addr, adaBalance: ada, vusdcxBalance: vusdcx, usdcxBalance: usdcxBal })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [vault.vusdcxUnit])

  const disconnectWallet = useCallback(() => {
    setLucid(null)
    cip30ApiRef.current = null
    _resetLucidCache()
    localStorage.removeItem('optivaults-wallet')
    localStorage.removeItem('optivaults-connected')
    setWallet({ connected: false, walletName: '', address: '', adaBalance: 0n, vusdcxBalance: 0n, usdcxBalance: 0n })
  }, [])

  // ═══════════════════════════════════
  // Deposit — direct path (vault_user.Deposit) via client-side Lucid
  // ═══════════════════════════════════
  //
  // The legacy `assetType` parameter is preserved on the signature for
  // backwards compatibility but ignored — V1 deposit currency is the
  // datum's `deposit_token` (USDCx); ADA-denominated deposits never
  // reached the production code path.

  const deposit = useCallback(async (amount: bigint, _minReceive?: bigint, _assetType?: string): Promise<string> => {
    const w = walletRef.current
    if (!w.connected || !w.address) throw new Error('Not connected')
    setLoading(true); setError(null); setTxHash(null); setTxStatus('building')

    try {
      // Bind Lucid to the active CIP-30 wallet (cheap if already bound).
      const cip30 = (window as any).cardano?.[w.walletName || '']
      if (!cip30) throw new Error('Wallet not found')
      const api = cip30ApiRef.current ?? await cip30.enable()
      cip30ApiRef.current = api
      void _cip30Api; _cip30Api = api
      await selectWalletFromCip30(api)

      const { tx } = await buildDirectDepositTx({
        userAddr: w.address,
        amount,
      })

      setTxStatus('signing')
      let signed
      try {
        signed = await tx.sign.withWallet().complete()
      } catch (signErr: any) {
        const cancelMsg = signErr?.message || signErr?.info || ''
        if (cancelMsg.includes('cancel') || cancelMsg.includes('decline')
            || cancelMsg.includes('reject') || cancelMsg.includes('refused')
            || signErr?.code === 2) {
          throw new Error('Transaction cancelled by user')
        }
        // Eternl disposed-session retry: rebind + sign once more
        const fresh = await cip30.enable()
        cip30ApiRef.current = fresh
        await selectWalletFromCip30(fresh)
        signed = await tx.sign.withWallet().complete()
      }

      setTxStatus('processing')
      const hash = await submitTolerant(signed)
      setTxHash(hash)
      pollTxConfirmation(hash)
      return hash
    } catch (e: any) {
      const errMsg = e?.message || e?.info || (typeof e === 'string' ? e : JSON.stringify(e))
      setError(errMsg || 'Unknown error')
      setTxStatus('failed')
      throw e
    } finally {
      setLoading(false)
    }
  }, [pollTxConfirmation])

  // ═══════════════════════════════════
  // Withdraw — direct partial path (vault_user.Withdraw) via client-side Lucid
  // ═══════════════════════════════════

  const withdraw = useCallback(async (shares: bigint, _minReceive?: bigint): Promise<string> => {
    const w = walletRef.current
    if (!w.connected || !w.address) throw new Error('Not connected')
    setLoading(true); setError(null); setTxHash(null); setTxStatus('building')

    try {
      const cip30 = (window as any).cardano?.[w.walletName || '']
      if (!cip30) throw new Error('Wallet not found')
      const api = cip30ApiRef.current ?? await cip30.enable()
      cip30ApiRef.current = api
      void _cip30Api; _cip30Api = api
      await selectWalletFromCip30(api)

      const { tx } = await buildDirectWithdrawTx({
        userAddr: w.address,
        sharesToBurn: shares,
      })

      setTxStatus('signing')
      let signed
      try {
        signed = await tx.sign.withWallet().complete()
      } catch (signErr: any) {
        const cancelMsg = signErr?.message || signErr?.info || ''
        if (cancelMsg.includes('cancel') || cancelMsg.includes('decline')
            || cancelMsg.includes('reject') || cancelMsg.includes('refused')
            || signErr?.code === 2) {
          throw new Error('Transaction cancelled by user')
        }
        const fresh = await cip30.enable()
        cip30ApiRef.current = fresh
        await selectWalletFromCip30(fresh)
        signed = await tx.sign.withWallet().complete()
      }

      setTxStatus('processing')
      const hash = await submitTolerant(signed)
      setTxHash(hash)
      pollTxConfirmation(hash)
      return hash
    } catch (e: any) {
      const errMsg = e?.message || e?.info || (typeof e === 'string' ? e : JSON.stringify(e))
      setError(errMsg || 'Unknown error')
      setTxStatus('failed')
      throw e
    } finally {
      setLoading(false)
    }
  }, [pollTxConfirmation])

  // ═══════════════════════════════════
  // Emergency Withdraw
  // ═══════════════════════════════════

  // Emergency Withdraw: uses Direct Withdraw (Withdraw redeemer) to bypass batcher
  // User pays early withdrawal fee but can exit without keeper/batcher
  const emergencyWithdraw = useCallback(async (): Promise<string> => {
    if (!wallet.vusdcxBalance || wallet.vusdcxBalance === 0n) throw new Error('No shares to withdraw')
    // Use the standard withdraw flow with all shares — this is the real emergency exit
    const allShares = wallet.vusdcxBalance
    const minReceive = 0n // Emergency: accept any amount to guarantee exit
    return withdraw(allShares, minReceive)
  }, [wallet.vusdcxBalance, withdraw])

  return (
    <CardanoContext.Provider value={{
      wallet, availableWallets, connectWallet, disconnectWallet,
      vault, refreshVault,
      deposit, withdraw, emergencyWithdraw,
      loading, error, txHash, txStatus, networkMismatch, debugMsg,
    }}>
      {children}
    </CardanoContext.Provider>
  )
}
