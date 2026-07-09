interface LogoProps {
  /** Rendered square size in px. */
  size?: number
  className?: string
}

/**
 * The SomedayWriter mark: a serif "SW" monogram. The S takes `currentColor`
 * (so it inherits the surrounding text color and theme) and the W takes the
 * live `--accent`, so the mark tracks the user's accent and both themes with no
 * per-instance styling. Set in the app's display serif so it matches the
 * reading face. Purely decorative — callers own the accessible label.
 */
export function Logo({ size = 24, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <text
        x="51"
        y="55"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-display)"
        fontWeight={600}
        fontSize={62}
        letterSpacing={-8}
      >
        <tspan fill="currentColor">S</tspan>
        <tspan fill="var(--accent)">W</tspan>
      </text>
    </svg>
  )
}
