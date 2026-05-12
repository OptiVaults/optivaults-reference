/**
 * Formatter Utility Tests
 *
 * Tests formatCompactNumber for all magnitude ranges,
 * edge cases, and negative numbers.
 */
import { describe, it, expect } from 'vitest'
import { formatCompactNumber } from '../utils/formatters'

describe('formatCompactNumber', () => {
  it('zero returns "0"', () => {
    expect(formatCompactNumber(0)).toBe('0')
  })

  it('small numbers use locale string', () => {
    expect(formatCompactNumber(42)).toBe('42')
    expect(formatCompactNumber(999)).toBe('999')
  })

  it('thousands use K suffix with 1 decimal', () => {
    expect(formatCompactNumber(1000)).toBe('1.0K')
    expect(formatCompactNumber(1500)).toBe('1.5K')
    expect(formatCompactNumber(9999)).toBe('10.0K')
    expect(formatCompactNumber(45600)).toBe('45.6K')
  })

  it('millions use M suffix with 2 decimals', () => {
    expect(formatCompactNumber(1_000_000)).toBe('1.00M')
    expect(formatCompactNumber(2_500_000)).toBe('2.50M')
    expect(formatCompactNumber(999_999_999)).toBe('1000.00M')
  })

  it('billions use B suffix with 2 decimals', () => {
    expect(formatCompactNumber(1_000_000_000)).toBe('1.00B')
    expect(formatCompactNumber(7_890_000_000)).toBe('7.89B')
  })

  it('trillions use T suffix with 2 decimals', () => {
    expect(formatCompactNumber(1_000_000_000_000)).toBe('1.00T')
    expect(formatCompactNumber(3_456_000_000_000)).toBe('3.46T')
  })

  it('quadrillions use Q suffix with 1 decimal', () => {
    expect(formatCompactNumber(1_000_000_000_000_000)).toBe('1.0Q')
  })

  it('negative numbers scale correctly', () => {
    expect(formatCompactNumber(-1500)).toBe('-1.5K')
    expect(formatCompactNumber(-2_500_000)).toBe('-2.50M')
  })

  it('exact boundary values', () => {
    expect(formatCompactNumber(999)).toBe('999')
    expect(formatCompactNumber(1000)).toBe('1.0K')
    expect(formatCompactNumber(999_999)).toBe('1000.0K')
    expect(formatCompactNumber(1_000_000)).toBe('1.00M')
  })
})
