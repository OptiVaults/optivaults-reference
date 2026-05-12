export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/icon.png"
      alt="OptiVaults"
      width={size}
      height={size}
      style={{ borderRadius: size > 24 ? 6 : 4 }}
    />
  )
}
