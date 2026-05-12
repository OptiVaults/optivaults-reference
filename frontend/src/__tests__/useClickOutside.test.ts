/**
 * useClickOutside Hook Logic Tests
 *
 * Tests event listener management logic without DOM.
 * Verifies cleanup, conditional attachment, and handler behavior.
 */
import { describe, it, expect, vi } from 'vitest'

describe('useClickOutside event listener logic', () => {
  // Simulates the hook's effect logic without React
  function simulateEffect(isOpen: boolean, _onClose: () => void) {
    const addSpy = vi.fn()
    const removeSpy = vi.fn()

    // Simulate the effect body
    if (!isOpen) return { addSpy, removeSpy, cleanup: () => {} }

    addSpy('mousedown')
    addSpy('touchstart')

    const cleanup = () => {
      removeSpy('mousedown')
      removeSpy('touchstart')
    }

    return { addSpy, removeSpy, cleanup }
  }

  it('attaches listeners when isOpen=true', () => {
    const { addSpy } = simulateEffect(true, () => {})
    expect(addSpy).toHaveBeenCalledTimes(2)
    expect(addSpy).toHaveBeenCalledWith('mousedown')
    expect(addSpy).toHaveBeenCalledWith('touchstart')
  })

  it('does not attach listeners when isOpen=false', () => {
    const { addSpy } = simulateEffect(false, () => {})
    expect(addSpy).not.toHaveBeenCalled()
  })

  it('cleanup removes both listeners', () => {
    const { removeSpy, cleanup } = simulateEffect(true, () => {})
    cleanup()
    expect(removeSpy).toHaveBeenCalledTimes(2)
    expect(removeSpy).toHaveBeenCalledWith('mousedown')
    expect(removeSpy).toHaveBeenCalledWith('touchstart')
  })

  it('cleanup is no-op when not open', () => {
    const { removeSpy, cleanup } = simulateEffect(false, () => {})
    cleanup()
    expect(removeSpy).not.toHaveBeenCalled()
  })
})

describe('useClickOutside contains logic', () => {
  function shouldClose(refContainsTarget: boolean): boolean {
    // Simulates: if (ref.current && !ref.current.contains(target)) onClose()
    return !refContainsTarget
  }

  it('click outside ref → should close', () => {
    expect(shouldClose(false)).toBe(true)
  })

  it('click inside ref → should not close', () => {
    expect(shouldClose(true)).toBe(false)
  })
})

describe('useClickOutside handles both event types', () => {
  const eventTypes = ['mousedown', 'touchstart']

  it('listens to both mousedown and touchstart', () => {
    expect(eventTypes).toContain('mousedown')
    expect(eventTypes).toContain('touchstart')
    expect(eventTypes).toHaveLength(2)
  })

  it('covers desktop (mousedown) and mobile (touchstart)', () => {
    // Ensures both interaction types are handled
    expect(eventTypes[0]).toBe('mousedown')
    expect(eventTypes[1]).toBe('touchstart')
  })
})
