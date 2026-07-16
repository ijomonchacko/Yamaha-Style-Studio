interface Props {
  className?: string;
  size?: number;
  onClick?: () => void;
  label?: string;
  /** white = light mark (dark hero); dark = dark mark (light bars) */
  variant?: "dark" | "white";
}

/** Transparent logo (bg removed). No plate / black box. */
export function BrandLogo({
  className = "",
  size = 72,
  onClick,
  label = "Yamaha Style Studio",
  variant = "dark"
}: Props) {
  // Monogram only (text cropped out) — transparent PNG
  const src = variant === "white" ? "/logo-mark-white.png" : "/logo-mark-dark.png";

  const img = (
    <img
      src={src}
      alt={label}
      width={size}
      height={size}
      className="brand-logo-img"
      style={{ width: size, height: "auto", maxHeight: size }}
      draggable={false}
    />
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`brand-logo brand-logo-${variant} ${className}`}
        onClick={onClick}
        aria-label={label}
        title={label}
      >
        {img}
      </button>
    );
  }

  return (
    <div className={`brand-logo brand-logo-${variant} ${className}`} title={label}>
      {img}
    </div>
  );
}
