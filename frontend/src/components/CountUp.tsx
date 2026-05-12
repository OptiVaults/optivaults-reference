import { useState, useEffect } from 'react'

export default function CountUp({
  end,
  prefix = '',
  suffix = '',
  decimals = 0,
  duration = 1500, // Default 1.5 seconds
}: {
  end: number
  prefix?: string
  suffix?: string
  decimals?: number
  duration?: number
}) {
  const [count, setCount] = useState(0)
  const [hasRun, setHasRun] = useState(false)

  useEffect(() => {
    // Only run the animation once when 'end' goes from 0 to a positive number,
    // or run immediately if 'end' is immediately positive.
    if (end <= 0) return
    if (hasRun) {
      // If already ran, just snap to the new end value immediately
      setCount(end)
      return
    }

    setHasRun(true)
    let startTimestamp: number | null = null
    let animationFrame: number

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp
      const progress = Math.min((timestamp - startTimestamp) / duration, 1)
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)
      
      setCount(easeProgress * end)

      if (progress < 1) {
        animationFrame = requestAnimationFrame(step)
      } else {
        setCount(end)
      }
    }

    animationFrame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(animationFrame)
  }, [end, duration, hasRun])

  // Simple formatter for thousands separator
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  // Show "0.00" style if it hasn't started yet
  const displayValue = count > 0 ? formatter.format(count) : formatter.format(end > 0 && hasRun ? end : 0)

  return (
    <>{prefix}{displayValue}{suffix}</>
  )
}
