#!/usr/bin/env node
/**
 * OptiVaults V1 Withdraw CLI — V1 Withdraw-Zero + Layer 3 CommunitySunset.
 *
 * Local, self-serve withdrawal + dead-man-switch trigger. No backend
 * dependency. Reads ceremony anchors from a JSON config file (defaults
 * to bundled config/preprod.json — operator may override via --config or
 * OPTIVAULTS_V1_CONFIG env var).
 *
 * Usage:
 *   optivaults-v1-withdraw balance --blockfrost-key KEY --network preprod
 *   optivaults-v1-withdraw quote --shares 1000000000000 --blockfrost-key KEY
 *   optivaults-v1-withdraw withdraw --shares max --seed-file ~/.optivaults/seed --blockfrost-key KEY
 *   optivaults-v1-withdraw sunset-status --blockfrost-key KEY
 *   optivaults-v1-withdraw sunset-trigger --seed-file ~/.optivaults/seed --blockfrost-key KEY
 *
 * SECURITY:
 *   • Seed phrase is read from --seed-file, --stdin, or OPTIVAULTS_SEED env var.
 *   • NEVER pass --seed "words..." in production (leaks to shell history).
 *   • Private key never leaves your wallet (CLI signs locally; Blockfrost
 *     only sees the signed CBOR).
 */
import { program } from 'commander'
import * as fs from 'node:fs'
import * as readline from 'node:readline'
import {
  initLucid,
  queryVaultState,
  computeWithdrawQuote,
  computeSunsetStatus,
  getUserShares,
  buildWithdrawTx,
  buildSunsetTx,
} from './vault.js'
import { loadV1Config, makeDepositUnit } from './config.js'

const DECIMALS = 6n // USDCx is 6 decimals; vUSDCx is 6 decimals visually but stored as 1e12 raw

function fmtMicro(n: bigint, dec: bigint = DECIMALS): string {
  const neg = n < 0n
  const abs = neg ? -n : n
  const s = abs.toString().padStart(Number(dec) + 1, '0')
  const head = s.slice(0, -Number(dec))
  const tail = s.slice(-Number(dec)).replace(/0+$/, '') || '0'
  return (neg ? '-' : '') + head + '.' + tail
}

function fmtTime(ms: bigint): string {
  if (ms <= 0n) return 'never'
  const d = new Date(Number(ms))
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

async function readSeed(opts: { seed?: string; seedFile?: string; stdin?: boolean }): Promise<string> {
  if (opts.seed) return opts.seed.trim()
  if (opts.seedFile) {
    if (!fs.existsSync(opts.seedFile)) throw new Error(`Seed file not found: ${opts.seedFile}`)
    return fs.readFileSync(opts.seedFile, 'utf8').trim()
  }
  if (opts.stdin || !process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: false })
    return new Promise((resolve) => rl.once('line', (line) => { rl.close(); resolve(line.trim()) }))
  }
  throw new Error('No seed provided. Use --seed-file, --stdin, or set OPTIVAULTS_SEED env var.')
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(prompt + ' [y/N] ', (ans) => {
      rl.close()
      resolve(ans.trim().toLowerCase() === 'y')
    })
  })
}

function explorerUrl(network: 'mainnet' | 'preprod', txHash: string): string {
  return network === 'preprod'
    ? `https://preprod.cardanoscan.io/transaction/${txHash}`
    : `https://cardanoscan.io/transaction/${txHash}`
}

// ─────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────

program
  .name('optivaults-v1-withdraw')
  .description(
    'V1 self-serve withdrawal CLI for OptiVaults. ' +
    'Supports partial Withdraw + Layer 3 CommunitySunset (90-day dead-man-switch).',
  )
  .version('0.1.0')

program
  .command('balance')
  .description('Show vault state + your vUSDCx balance (read-only)')
  .requiredOption('--blockfrost-key <key>', 'Blockfrost API key (env: BLOCKFROST_KEY)')
  .option('--network <net>', 'Network: mainnet or preprod', 'preprod')
  .option('--config <path>', 'Override bundled ceremony config (env: OPTIVAULTS_V1_CONFIG)')
  .option('--address <addr>', 'Query this address instead of using seed')
  .option('--seed <mnemonic>', 'BIP39 24-word mnemonic (risky — use --seed-file)')
  .option('--seed-file <path>', 'Read mnemonic from file')
  .option('--stdin', 'Read mnemonic from stdin')
  .action(async (opts: any) => {
    const key = (opts.blockfrostKey || process.env.BLOCKFROST_KEY || '').trim()
    if (!key) throw new Error('Blockfrost key required (--blockfrost-key or BLOCKFROST_KEY env)')
    const net = opts.network as 'mainnet' | 'preprod'
    const cfg = loadV1Config(net, opts.config)
    const lucid = await initLucid(key, net)

    let addr = opts.address
    if (!addr) {
      const seed = process.env.OPTIVAULTS_SEED || (await readSeed(opts))
      lucid.selectWallet.fromSeed(seed)
      addr = await lucid.wallet().address()
    }

    console.log(`Network:        ${net}`)
    console.log(`Release:        ${cfg.releaseTag}`)
    console.log(`Vault address:  ${cfg.proxyAddr}`)
    console.log(`Address:        ${addr}`)
    const [vault, shares] = await Promise.all([
      queryVaultState(lucid, cfg),
      getUserShares(lucid, addr, cfg),
    ])
    const sunset = computeSunsetStatus(vault)
    const depositUnit = makeDepositUnit(vault.depositTokenPolicy, vault.depositTokenName)

    console.log('\n── Vault State (V1) ──')
    console.log(`  Vault version:        V${vault.vaultVersion}`)
    console.log(`  Total deposited:      ${fmtMicro(vault.totalDeposited)} (deposit-token units)`)
    console.log(`  Total shares:         ${vault.totalShares.toString()} raw vUSDCx`)
    console.log(`  Idle buffer:          ${fmtMicro(vault.idleBuffer)} (deposit-token units)`)
    console.log(`  Non-deposit value:    ${fmtMicro(vault.nonDepositValue)} (other stables)`)
    console.log(`  Early-withdraw fee:   ${(Number(vault.earlyWithdrawFeeBps) / 100).toFixed(2)}%`)
    console.log(`  Frozen:               ${vault.frozen === 1n ? 'YES' : 'no'}`)
    console.log(`  Sunset triggered:     ${sunset.alreadyTriggered ? 'YES (Layer 3 active)' : 'no'}`)
    console.log(`  Last compound:        ${fmtTime(vault.lastCompoundTime)}`)
    console.log(`  Last realloc:         ${fmtTime(vault.lastReallocTime)}`)
    if (vault.liqwidPositions.length > 0) {
      console.log(`  Liqwid positions:`)
      for (const p of vault.liqwidPositions) {
        console.log(
          `    market_id=${p.marketId}  qtokens=${p.qtokensHeld}  supplied=${fmtMicro(p.suppliedValue)}`,
        )
      }
    } else {
      console.log(`  Liqwid positions:     (none)`)
    }
    console.log(`  Deposit token unit:   ${depositUnit.slice(0, 32)}…`)

    console.log('\n── Sunset Status (Layer 3) ──')
    if (sunset.alreadyTriggered) {
      console.log(`  Already triggered. Permissionless recovery paths are open.`)
    } else if (sunset.lastActivityMs <= 0n) {
      console.log(`  Vault never compounded — sunset clock not started.`)
    } else {
      console.log(`  Days since last activity:   ${sunset.daysSinceActivity}`)
      console.log(`  Days until 90d threshold:   ${sunset.daysUntilSunset}`)
      console.log(`  Available now:              ${sunset.available ? 'YES' : 'no'}`)
    }

    console.log('\n── Your Position ──')
    console.log(`  vUSDCx shares:        ${shares.toString()} raw`)
    if (vault.totalShares > 0n) {
      const value = (shares * vault.totalDeposited) / vault.totalShares
      console.log(`  Estimated value:      ${fmtMicro(value)} (deposit-token units, gross)`)
    } else {
      console.log(`  Estimated value:      n/a (vault has zero shares)`)
    }
  })

program
  .command('quote')
  .description('Estimate withdraw output for given shares (read-only)')
  .requiredOption('--blockfrost-key <key>', 'Blockfrost API key')
  .requiredOption('--shares <amount>', 'vUSDCx shares to burn (raw integer)')
  .option('--network <net>', 'Network: mainnet or preprod', 'preprod')
  .option('--config <path>', 'Override bundled ceremony config')
  .action(async (opts: any) => {
    const key = (opts.blockfrostKey || process.env.BLOCKFROST_KEY || '').trim()
    if (!key) throw new Error('Blockfrost key required')
    const net = opts.network as 'mainnet' | 'preprod'
    const cfg = loadV1Config(net, opts.config)
    const lucid = await initLucid(key, net)
    const vault = await queryVaultState(lucid, cfg)
    const shares = BigInt(opts.shares)
    const q = computeWithdrawQuote(vault, shares)

    console.log('── Withdraw Quote (V1, R49 M-4 deferred-yield) ──')
    console.log(`  Shares to burn:       ${q.shares.toString()}`)
    console.log(`  Gross withdraw:       ${fmtMicro(q.baseWithdraw)} (deposit-token units)`)
    console.log(`  Early fee:            ${fmtMicro(q.earlyFee)} (${q.keeperInactive ? 'WAIVED — keeper inactive 7d+' : 'active'})`)
    console.log(`  You receive:          ${fmtMicro(q.netWithdraw)} (deposit-token units)`)
    console.log(`  + 2 ADA min UTXO at receiver address.`)
  })

program
  .command('withdraw')
  .description('Build, sign, and submit a V1 Withdraw transaction')
  .requiredOption('--blockfrost-key <key>', 'Blockfrost API key (env: BLOCKFROST_KEY)')
  .requiredOption('--shares <amount>', "vUSDCx shares to burn (raw integer or 'max')")
  .option('--network <net>', 'Network: mainnet or preprod', 'preprod')
  .option('--config <path>', 'Override bundled ceremony config')
  .option('--seed <mnemonic>', 'BIP39 24-word mnemonic (env: OPTIVAULTS_SEED)')
  .option('--seed-file <path>', 'Read mnemonic from file')
  .option('--stdin', 'Read mnemonic from stdin')
  .option('--yes', 'Skip confirmation prompt')
  .option('--dry-run', 'Build TX but do not submit')
  .action(async (opts: any) => {
    const key = (opts.blockfrostKey || process.env.BLOCKFROST_KEY || '').trim()
    if (!key) throw new Error('Blockfrost key required')
    const net = opts.network as 'mainnet' | 'preprod'
    const cfg = loadV1Config(net, opts.config)

    const seed = process.env.OPTIVAULTS_SEED || (await readSeed(opts))
    const lucid = await initLucid(key, net)
    lucid.selectWallet.fromSeed(seed)
    const addr = await lucid.wallet().address()

    const vault = await queryVaultState(lucid, cfg)
    const userShares = await getUserShares(lucid, addr, cfg)
    if (userShares <= 0n) throw new Error('No vUSDCx shares found in wallet')

    let shares: bigint
    if (opts.shares === 'max') {
      // Cap to total_shares - 1 to avoid full-drain path (which the CLI
      // doesn't support — full drain needs the NFT-burn admin path).
      const cap = vault.totalShares - 1n
      shares = userShares > cap ? cap : userShares
    } else {
      shares = BigInt(opts.shares)
    }
    if (shares > userShares) throw new Error(`Only have ${userShares} shares (requested ${shares})`)

    const quote = computeWithdrawQuote(vault, shares)
    console.log('\n── Withdraw Plan (V1 Withdraw-Zero) ──')
    console.log(`  Network:              ${net}`)
    console.log(`  Release:              ${cfg.releaseTag}`)
    console.log(`  Wallet:               ${addr.slice(0, 12)}…${addr.slice(-6)}`)
    console.log(`  Shares to burn:       ${shares.toString()} / ${userShares.toString()}`)
    console.log(`  You receive:          ${fmtMicro(quote.netWithdraw)} (+2 ADA min UTXO)`)
    console.log(`  Early fee:            ${fmtMicro(quote.earlyFee)} ${quote.keeperInactive ? '(waived)' : ''}`)

    if (vault.frozen === 1n) {
      console.log(`  ⚠️  Vault is FROZEN — Withdraw still works (governance can't block exits).`)
    }
    if (vault.communitySunsetTriggered === 1n) {
      console.log(`  ℹ️  Layer 3 sunset is active — permissionless Recall + swap-out paths are open.`)
    }

    if (!opts.yes) {
      const ok = await confirm('Proceed?')
      if (!ok) { console.log('Aborted.'); return }
    }

    console.log('\nBuilding V1 Withdraw-Zero transaction (proxy + vault_user + vusdcx burn)…')
    const { cbor } = await buildWithdrawTx(lucid, cfg, vault, shares, addr)

    if (opts.dryRun) {
      console.log('\n── Dry-run (not submitted) ──')
      console.log(`CBOR (${cbor.length / 2} bytes): ${cbor.slice(0, 120)}…`)
      return
    }

    console.log('Signing…')
    const signed = await lucid.fromTx(cbor).sign.withWallet().complete()

    console.log('Submitting…')
    const txHash = await signed.submit()
    console.log('\n✅ Submitted')
    console.log(`  TX: ${txHash}`)
    console.log(`  ${explorerUrl(net, txHash)}`)
  })

program
  .command('sunset-status')
  .description('Show Layer 3 dead-man-switch availability (read-only)')
  .requiredOption('--blockfrost-key <key>', 'Blockfrost API key')
  .option('--network <net>', 'Network: mainnet or preprod', 'preprod')
  .option('--config <path>', 'Override bundled ceremony config')
  .action(async (opts: any) => {
    const key = (opts.blockfrostKey || process.env.BLOCKFROST_KEY || '').trim()
    if (!key) throw new Error('Blockfrost key required')
    const net = opts.network as 'mainnet' | 'preprod'
    const cfg = loadV1Config(net, opts.config)
    const lucid = await initLucid(key, net)
    const vault = await queryVaultState(lucid, cfg)
    const sunset = computeSunsetStatus(vault)

    console.log('── Layer 3 CommunitySunset Status ──')
    console.log(`  Network:              ${net}`)
    console.log(`  Release:              ${cfg.releaseTag}`)
    console.log(`  Last activity:        ${fmtTime(sunset.lastActivityMs)}`)
    console.log(`  Days since activity:  ${sunset.daysSinceActivity >= 0 ? sunset.daysSinceActivity : 'n/a (never compounded)'}`)
    console.log(`  Threshold:            90 days`)
    console.log(`  Days remaining:       ${sunset.daysUntilSunset}`)
    console.log(`  Already triggered:    ${sunset.alreadyTriggered ? 'YES' : 'no'}`)
    console.log(`  Available now:        ${sunset.available ? 'YES — any vUSDCx holder can trigger' : 'no'}`)
    if (sunset.available && !sunset.alreadyTriggered) {
      console.log('\n  Run `optivaults-v1-withdraw sunset-trigger ...` to flip frozen=1 + community_sunset_triggered=1.')
      console.log('  After triggering, ANY vUSDCx holder can call RecallFromLiqwid + DeployToProtocol Layer 2')
      console.log('  to swap NDV → USDCx without needing keeper or governance signatures.')
    }
  })

program
  .command('sunset-trigger')
  .description('Trigger Layer 3 dead-man-switch (one-way; requires ≥90d operational inactivity)')
  .requiredOption('--blockfrost-key <key>', 'Blockfrost API key')
  .option('--network <net>', 'Network: mainnet or preprod', 'preprod')
  .option('--config <path>', 'Override bundled ceremony config')
  .option('--seed <mnemonic>', 'BIP39 24-word mnemonic (env: OPTIVAULTS_SEED)')
  .option('--seed-file <path>', 'Read mnemonic from file')
  .option('--stdin', 'Read mnemonic from stdin')
  .option('--yes', 'Skip confirmation prompt')
  .option('--dry-run', 'Build TX but do not submit')
  .action(async (opts: any) => {
    const key = (opts.blockfrostKey || process.env.BLOCKFROST_KEY || '').trim()
    if (!key) throw new Error('Blockfrost key required')
    const net = opts.network as 'mainnet' | 'preprod'
    const cfg = loadV1Config(net, opts.config)

    const seed = process.env.OPTIVAULTS_SEED || (await readSeed(opts))
    const lucid = await initLucid(key, net)
    lucid.selectWallet.fromSeed(seed)
    const addr = await lucid.wallet().address()

    const vault = await queryVaultState(lucid, cfg)
    const userShares = await getUserShares(lucid, addr, cfg)
    if (userShares <= 0n) {
      throw new Error('Caller wallet must hold ≥1 vUSDCx (validator scans tx inputs).')
    }
    const sunset = computeSunsetStatus(vault)

    console.log('\n── Sunset Trigger Plan ──')
    console.log(`  Network:              ${net}`)
    console.log(`  Release:              ${cfg.releaseTag}`)
    console.log(`  Wallet:               ${addr.slice(0, 12)}…${addr.slice(-6)}`)
    console.log(`  Caller vUSDCx:        ${userShares.toString()} (≥1 required)`)
    console.log(`  Days since activity:  ${sunset.daysSinceActivity}`)
    console.log(`  Available:            ${sunset.available ? 'YES' : 'no'}`)
    console.log(`  Effect:               frozen 0→1, community_sunset_triggered 0→1`)
    console.log(`  Reversible:           NO (one-way flag, irreversible)`)
    console.log(`  Post-trigger:         ANY vUSDCx holder can call permissionless`)
    console.log(`                        RecallFromLiqwid + DeployToProtocol Layer 2.`)

    if (!opts.yes) {
      const ok = await confirm('Trigger Layer 3 sunset (irreversible)?')
      if (!ok) { console.log('Aborted.'); return }
    }

    console.log('\nBuilding CommunitySunset transaction…')
    const { cbor } = await buildSunsetTx(lucid, cfg, vault, addr)

    if (opts.dryRun) {
      console.log('\n── Dry-run (not submitted) ──')
      console.log(`CBOR (${cbor.length / 2} bytes): ${cbor.slice(0, 120)}…`)
      return
    }

    console.log('Signing…')
    const signed = await lucid.fromTx(cbor).sign.withWallet().complete()

    console.log('Submitting…')
    const txHash = await signed.submit()
    console.log('\n✅ Submitted — Layer 3 dead-man-switch triggered')
    console.log(`  TX: ${txHash}`)
    console.log(`  ${explorerUrl(net, txHash)}`)
  })

program.parseAsync().catch((e: unknown) => {
  console.error('Error:', (e as Error).message)
  process.exit(1)
})
