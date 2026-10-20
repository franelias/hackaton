// The brand mark: Mamo, a koala hugging a tree.
export default function Logo({ size = 28 }: { size?: number }) {
  return <img src="/mamo.png" width={size} height={size} alt="" aria-hidden="true" className="shrink-0" />
}
