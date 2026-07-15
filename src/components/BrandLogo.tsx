interface Props {
  className?: string;
  size?: number;
  onClick?: () => void;
  label?: string;
}

/** White logo mark (logo-only). Uses dark plate so it reads on light navbars. */
export function BrandLogo({
  className = "",
  size = 56,
  onClick,
  label = "Yamaha Style Studio"
}: Props) {
  const img = (
    <img
      src="/white-logo.jpg"
      alt={label}
      width={size}
      height={size}
      className="brand-logo-img"
      style={{ width: size, height: size }}
      draggable={false}
    />
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`brand-logo ${className}`}
        onClick={onClick}
        aria-label={label}
        title={label}
      >
        {img}
      </button>
    );
  }

  return (
    <div className={`brand-logo ${className}`} title={label}>
      {img}
    </div>
  );
}
