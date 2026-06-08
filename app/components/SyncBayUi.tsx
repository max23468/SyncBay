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
  logo: "ebay" | "shopify";
  name: string;
  statusLabel: string;
  statusTone: SyncBayTone;
};

export function ConnectionCard({
  detail,
  logo,
  name,
  statusLabel,
  statusTone,
}: ConnectionCardProps) {
  return (
    <div className="syncbay-connection">
      <span className="syncbay-connection__mark">
        {logo === "ebay" ? <EbayMark /> : <ShopifyMark />}
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

/**
 * Marchi ufficiali eBay e Shopify come indicatori sobri di collegamento
 * (ADR 0010). Glifi di marca da simple-icons, resi nel colore ufficiale del
 * marchio, non come co-branding dominante.
 */
export function EbayMark() {
  return (
    <svg
      aria-label="eBay"
      height="24"
      role="img"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.056 12.132v-4.92h1.2v3.026c.59-.703 1.402-.906 2.202-.906 1.34 0 2.828.904 2.828 2.855 0 .233-.015.457-.06.668.24-.953 1.274-1.305 2.896-1.344.51-.018 1.095-.018 1.56-.018v-.135c0-.885-.556-1.244-1.53-1.244-.72 0-1.245.3-1.305.81h-1.275c.136-1.29 1.5-1.62 2.686-1.62 1.064 0 1.995.27 2.415 1.02l-.436-.84h1.41l2.055 4.125 2.055-4.126H24l-3.72 7.305h-1.346l1.07-2.04-2.33-4.38c.13.255.2.555.2.93v2.46c0 .346.01.69.04 1.005H16.8a6.543 6.543 0 01-.046-.765c-.603.734-1.32.96-2.32.96-1.48 0-2.272-.78-2.272-1.695 0-.15.015-.284.037-.405-.3 1.246-1.36 2.086-2.767 2.086-.87 0-1.694-.315-2.2-.93 0 .24-.015.494-.04.734h-1.18c.02-.39.04-.855.04-1.245v-1.05h-4.83c.065 1.095.818 1.74 1.853 1.74.718 0 1.355-.3 1.568-.93h1.24c-.24 1.29-1.61 1.725-2.79 1.725C.95 15.009 0 13.822 0 12.232c0-1.754.982-2.91 3.116-2.91 1.688 0 2.93.886 2.94 2.806v.005zm9.137.183c-1.095.034-1.77.233-1.77.95 0 .465.36.97 1.305.97 1.26 0 1.935-.69 1.935-1.814v-.13c-.45 0-.99.006-1.484.022h.012zm-6.06 1.875c1.11 0 1.876-.806 1.876-2.02s-.768-2.02-1.893-2.02c-1.11 0-1.89.806-1.89 2.02s.765 2.02 1.875 2.02h.03zm-4.35-2.514c-.044-1.125-.854-1.546-1.725-1.546-.944 0-1.694.474-1.815 1.546z"
        fill="#E53238"
      />
    </svg>
  );
}

export function ShopifyMark() {
  return (
    <svg
      aria-label="Shopify"
      height="24"
      role="img"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zM11.71 11.305s-.81-.424-1.774-.424c-1.447 0-1.504.906-1.504 1.141 0 1.232 3.24 1.715 3.24 4.629 0 2.295-1.44 3.76-3.406 3.76-2.354 0-3.54-1.465-3.54-1.465l.646-2.086s1.245 1.066 2.28 1.066c.675 0 .975-.545.975-.932 0-1.619-2.654-1.694-2.654-4.359-.034-2.237 1.571-4.416 4.827-4.416 1.257 0 1.875.361 1.875.361l-.945 2.715-.02.01zM11.17.83c.136 0 .271.038.405.135-.984.465-2.064 1.639-2.508 3.992-.656.213-1.293.405-1.889.578C7.697 3.75 8.951.84 11.17.84V.83zm1.235 2.949v.135c-.754.232-1.583.484-2.394.736.466-1.777 1.333-2.645 2.085-2.971.193.501.309 1.176.309 2.1zm.539-2.234c.694.074 1.141.867 1.429 1.755-.349.114-.735.231-1.158.366v-.252c0-.752-.096-1.371-.271-1.871v.002zm2.992 1.289c-.02 0-.06.021-.078.021s-.289.075-.714.21c-.423-1.233-1.176-2.37-2.508-2.37h-.115C12.135.209 11.669 0 11.265 0 8.159 0 6.675 3.877 6.21 5.846c-1.194.365-2.063.636-2.16.674-.675.213-.694.232-.772.87-.075.462-1.83 14.063-1.83 14.063L15.009 24l.927-21.166z"
        fill="#95BF47"
      />
    </svg>
  );
}
