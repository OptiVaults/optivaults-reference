/**
 * Skeleton shimmer component for loading states
 */

export function Skeleton({ className = '', width, height }: { className?: string; width?: string; height?: string }) {
  return (
    <div
      className={`animate-pulse bg-slate-700/50 rounded ${className}`}
      style={{ width, height }}
    />
  )
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-3">
      <Skeleton className="h-5 w-32 rounded" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex justify-between items-center">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonStats() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="glass-card rounded-xl p-3 sm:p-4 space-y-2">
          <Skeleton className="h-3 w-12 rounded" />
          <Skeleton className="h-6 w-20 rounded" />
        </div>
      ))}
    </div>
  )
}
