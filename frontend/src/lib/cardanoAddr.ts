/**
 * Pure-JS Cardano shelley address hex → bech32 encoder.
 *
 * CIP-30 wallets return addresses in hex (raw bytes); Blockfrost +
 * the rest of the frontend speak bech32. We have a Lucid-CML-based
 * conversion in `useCardano.tsx`'s `connectWallet`, but it depends
 * on `@anastasia-labs/cardano-multiplatform-lib-browser` WASM init
 * which intermittently fails (the suppressed `__wbindgen_start`
 * error in `main.tsx` is a known symptom). When CML conversion
 * fails, the frontend used to fall back to the raw hex string,
 * which Blockfrost rejects → 404 / silent zero balance.
 *
 * This module is the **third fallback** — pure JS bech32 encode,
 * no WASM, no heavy deps. BIP-173 reference implementation
 * (https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki).
 *
 * Cardano address bytes:
 *   byte 0:        header — high 4 bits = address type, low 4 bits = network id
 *   bytes 1..28:   payment credential hash (28 bytes)
 *   bytes 29..56:  stake credential hash (28 bytes; base address only)
 *
 * Network id: 0 = testnet (preprod / preview / private), 1 = mainnet.
 * HRP: testnet → "addr_test", mainnet → "addr".
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

function polymodStep(pre: number): number {
  const b = pre >> 25
  return ((pre & 0x1ffffff) << 5)
    ^ (-((b >> 0) & 1) & 0x3b6a57b2)
    ^ (-((b >> 1) & 1) & 0x26508e6d)
    ^ (-((b >> 2) & 1) & 0x1ea119fa)
    ^ (-((b >> 3) & 1) & 0x3d4233dd)
    ^ (-((b >> 4) & 1) & 0x2a1462b3)
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = []
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5)
  out.push(0)
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31)
  return out
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0])
  let mod = 1
  for (const v of values) mod = polymodStep(mod) ^ v
  mod ^= 1
  const out: number[] = []
  for (let i = 0; i < 6; i++) {
    out.push((mod >> (5 * (5 - i))) & 31)
  }
  return out
}

/** Convert 8-bit byte array → 5-bit group array for bech32 encoding. */
function convertBits(data: Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0
  let bits = 0
  const out: number[] = []
  const maxv = (1 << toBits) - 1
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) throw new Error('byte out of range')
    acc = (acc << fromBits) | value
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      out.push((acc >> bits) & maxv)
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (toBits - bits)) & maxv)
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error('invalid padding')
  }
  return out
}

function bech32Encode(hrp: string, data: number[]): string {
  const combined = data.concat(createChecksum(hrp, data))
  let out = hrp + '1'
  for (const v of combined) out += CHARSET[v]
  return out
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex length must be even')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Convert a hex-encoded shelley address (the format CIP-30 wallets
 * return from `getUsedAddresses` / `getUnusedAddresses`) into bech32.
 * HRP is derived from the network id encoded in the header byte:
 *   network id 0 → "addr_test"
 *   network id 1 → "addr"
 *
 * Returns the bech32 string. Throws on malformed input.
 */
export function hexAddressToBech32(hexAddr: string): string {
  if (typeof hexAddr !== 'string' || hexAddr.length === 0) {
    throw new Error('hex address required')
  }
  const bytes = hexToBytes(hexAddr)
  if (bytes.length < 29) throw new Error(`address too short: ${bytes.length} bytes`)
  const networkId = bytes[0] & 0x0f
  const hrp = networkId === 1 ? 'addr' : 'addr_test'
  const fiveBit = convertBits(bytes, 8, 5, true)
  return bech32Encode(hrp, fiveBit)
}

/**
 * Best-effort conversion: returns the input unchanged if it already
 * starts with `addr` (already bech32), else attempts hex decode +
 * bech32 encode. Throws only on malformed input — callers can
 * `try/catch` and fall back to other strategies if needed.
 */
export function ensureBech32Address(maybeHexOrBech32: string): string {
  if (maybeHexOrBech32.startsWith('addr')) return maybeHexOrBech32
  return hexAddressToBech32(maybeHexOrBech32)
}
