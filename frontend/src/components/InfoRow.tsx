export default function InfoRow({ label, value, icon, highlight, green, warn }: {
  label: string
  value: string
  icon?: React.ReactNode
  highlight?: boolean
  green?: boolean
  warn?: boolean
}) {
  return (
    <div className="flex justify-between text-xs sm:text-sm">
      <span className="text-slate-400">{icon ? <>{icon} {label}</> : label}</span>
      <span className={highlight ? 'text-cyan-400 font-medium' : green ? 'text-green-400 font-medium' : warn ? 'text-amber-400' : 'text-white'}>{value}</span>
    </div>
  )
}
