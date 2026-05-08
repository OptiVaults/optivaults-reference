/**
 * Standalone verification: builds an UNSIGNED Withdraw TX (no signature, no
 * submit) using a known user address that holds vUSDCx — proves the full
 * TX-builder code path works end-to-end on Preprod.
 *
 * Usage:
 *   npx tsx src/verify-build.ts \
 *     --blockfrost-key preprodXXX \
 *     --address addr_test1qz... \
 *     --shares 1000000000000
 *
 * Output:
 *   - Vault state summary
 *   - Withdraw quote
 *   - Built CBOR length + first 120 chars
 *   - Decoded redeemer / output structure summary
 */
import { initLucid, queryVaultState, computeWithdrawQuote, getUserShares, buildWithdrawTx } from './vault.js'
import { loadV1Config } from './config.js'

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).flatMap((arg, i, arr) => arg.startsWith('--') ? [[arg.slice(2), arr[i + 1]]] : []),
  ) as Record<string, string>

  const key = args['blockfrost-key']
  const addr = args['address']
  const sharesStr = args['shares']
  if (!key || !addr || !sharesStr) {
    console.error('Required: --blockfrost-key <key> --address <addr> --shares <int>')
    process.exit(1)
  }

  const cfg = loadV1Config('preprod')
  const lucid = await initLucid(key, 'preprod')

  // Pre-fetch user UTxOs and select wallet from address (no signing capability,
  // but Lucid will use the provided UTxOs as wallet inputs for TX build).
  const userUtxos = await lucid.utxosAt(addr)
  lucid.selectWallet.fromAddress(addr, userUtxos)

  const vault = await queryVaultState(lucid, cfg)
  const userShares = await getUserShares(lucid, addr, cfg)
  console.log(`Vault td=${vault.totalDeposited} ts=${vault.totalShares} idle=${vault.idleBuffer}`)
  console.log(`User shares=${userShares}`)

  const shares = BigInt(sharesStr)
  const quote = computeWithdrawQuote(vault, shares)
  console.log(`Quote: shares=${quote.shares} base=${quote.baseWithdraw} fee=${quote.earlyFee} net=${quote.netWithdraw}`)

  console.log(`Building TX (no signing, no submit)...`)
  const { cbor } = await buildWithdrawTx(lucid, cfg, vault, shares, addr)
  console.log(`✅ TX built — ${cbor.length / 2} bytes`)
  console.log(`CBOR head: ${cbor.slice(0, 120)}…`)
}

main().catch((e) => {
  console.error('Error:', (e as Error).message)
  process.exit(1)
})
