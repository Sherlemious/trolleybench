/**
 * The mark: a lever mid-throw, the one choice every dilemma here comes down to. The tile
 * takes the brand colour, so it follows the reader's accent; the lever takes the ink
 * that is legible on it.
 */
export default function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path d="M9 25h14" stroke="var(--on-brand)" strokeWidth="3" strokeLinecap="round" />
      <path d="M16 24 22 9" stroke="var(--on-brand)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="22.5" cy="8.5" r="3.6" fill="var(--on-brand)" />
    </svg>
  );
}
