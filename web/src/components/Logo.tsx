// The brand mark: a small tree.
export default function Logo({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true"><path d="M13.5 28C14 22 13 19 14 16h2c1 3 0 6 .5 12z" fill="#7a5236" /><circle cx="15" cy="12" r="10" fill="#456d42" /><circle cx="15" cy="10.5" r="9.5" fill="#55804f" /><circle cx="11.5" cy="7.5" r="3.5" fill="#6f9866" /></svg>
}
