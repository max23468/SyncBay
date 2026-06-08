/**
 * Componenti del design layer SyncBay (ADR 0010).
 *
 * Lista chiusa: tile metrica, hero di stato, scheda connessione. Sono wrapper in
 * light DOM con CSS minimo (`app/styles/syncbay-embedded.css`) attorno a
 * componenti Polaris Web Components nativi. Non aggiungere altri wrapper custom
 * senza aggiornare l'ADR.
 */

export type SyncBayTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "critical";

// Sottoinsieme dell'icon set Polaris effettivamente usato nelle sei superfici.
export type SyncBayIcon =
  | "alert-triangle"
  | "alert-circle"
  | "check-circle"
  | "clock"
  | "connect"
  | "import"
  | "inventory"
  | "link"
  | "package"
  | "product"
  | "refresh"
  | "store"
  | "store-online";

type MetricTileProps = {
  detail?: string;
  icon: SyncBayIcon;
  label: string;
  tone?: SyncBayTone;
  value: string;
};

export function MetricTile({
  detail,
  icon,
  label,
  tone = "neutral",
  value,
}: MetricTileProps) {
  return (
    <div className={`syncbay-tile syncbay-tile--${tone}`}>
      <span className="syncbay-tile__icon">
        <s-icon type={icon} tone={tone} size="base" />
      </span>
      <span className="syncbay-tile__body">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {detail ? <s-text color="subdued">{detail}</s-text> : null}
      </span>
    </div>
  );
}

type StatusHeroProps = {
  actionHref?: string;
  actionLabel?: string;
  body: string;
  eyebrow?: string;
  icon: SyncBayIcon;
  title: string;
  tone: Exclude<SyncBayTone, "neutral">;
};

export function StatusHero({
  actionHref,
  actionLabel,
  body,
  eyebrow,
  icon,
  title,
  tone,
}: StatusHeroProps) {
  return (
    <div className={`syncbay-hero syncbay-hero--${tone}`}>
      <span className="syncbay-hero__icon">
        <s-icon type={icon} tone={tone} size="base" />
      </span>
      <span className="syncbay-hero__body">
        {eyebrow ? <s-text color="subdued">{eyebrow}</s-text> : null}
        <s-heading>{title}</s-heading>
        <s-text>{body}</s-text>
      </span>
      {actionHref && actionLabel ? (
        <span className="syncbay-hero__actions">
          <s-button href={actionHref} variant="primary">
            {actionLabel}
          </s-button>
        </span>
      ) : null}
    </div>
  );
}

type ConnectionCardProps = {
  detail: string;
  fallbackIcon: SyncBayIcon;
  logoSrc?: string;
  name: string;
  statusLabel: string;
  statusTone: SyncBayTone;
};

export function ConnectionCard({
  detail,
  fallbackIcon,
  logoSrc,
  name,
  statusLabel,
  statusTone,
}: ConnectionCardProps) {
  return (
    <div className="syncbay-connection">
      <span className="syncbay-connection__mark">
        {logoSrc ? (
          <img alt={name} src={logoSrc} />
        ) : (
          <s-icon type={fallbackIcon} tone="neutral" size="base" />
        )}
      </span>
      <span className="syncbay-connection__body">
        <s-heading>{name}</s-heading>
        <s-text color="subdued">{detail}</s-text>
      </span>
      <span className="syncbay-connection__status">
        <s-badge tone={statusTone}>{statusLabel}</s-badge>
      </span>
    </div>
  );
}
