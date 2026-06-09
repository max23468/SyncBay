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
  | "chevron-right"
  | "clock"
  | "connect"
  | "import"
  | "inventory"
  | "link"
  | "package"
  | "product"
  | "refresh"
  | "settings"
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

type ActionRowProps = {
  description: string;
  href: string;
  icon: SyncBayIcon;
  label: string;
  tone?: SyncBayTone;
};

export function ActionRow({
  description,
  href,
  icon,
  label,
  tone = "neutral",
}: ActionRowProps) {
  return (
    <s-clickable href={href}>
      <span className="syncbay-action">
        <span className="syncbay-action__icon">
          <s-icon type={icon} tone={tone} size="base" />
        </span>
        <span className="syncbay-action__body">
          <s-text>{label}</s-text>
          <s-text color="subdued">{description}</s-text>
        </span>
        <span className="syncbay-action__chevron">
          <s-icon type="chevron-right" tone="neutral" size="base" />
        </span>
      </span>
    </s-clickable>
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
      height="15"
      role="img"
      viewBox="0 0 1000 400.75"
      width="37"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m 633.07803,212.53323 c -45.43873,1.48929 -73.6715,9.689 -73.6715,39.61897 0,19.37591 15.44713,40.38162 54.66334,40.38162 52.57698,0 80.64259,-28.65902 80.64259,-75.66331 l 0.003,-5.16994 c -18.43302,0 -41.16414,0.16089 -61.63704,0.83266 z m 111.75103,62.10248 c 0,14.58313 0.42155,28.9782 1.69406,41.94092 h -46.61408 c -1.24325,-10.67368 -1.6972,-21.27945 -1.6972,-31.56656 -25.20195,30.97941 -55.17735,39.88537 -96.76149,39.88537 -61.67674,0 -94.70072,-32.59982 -94.70072,-70.30689 0,-54.61215 44.91583,-73.86739 122.89013,-75.65391 21.32332,-0.48686 45.27419,-0.55894 65.07531,-0.55894 l -0.003,-5.33606 c 0,-36.56098 -23.44364,-51.59335 -64.06765,-51.59335 -30.15876,0 -52.38579,12.48057 -54.6764,34.0468 h -52.65168 c 5.57217,-53.77165 62.06643,-67.37115 111.74005,-67.37115 59.50837,0 109.77228,21.17288 109.77228,84.11481 z"
        fill="#ffbc13"
      />
      <path
        d="m 199.63633,185.86602 c -1.94427,-46.87735 -35.77951,-64.41973 -71.94139,-64.41973 -38.99421,0 -70.12667,19.7327 -75.58026,64.41973 z M 51.034408,219.1909 c 2.704332,45.48365 34.069782,72.38437 77.197532,72.38437 29.88033,0 56.45979,-12.17498 65.35948,-38.66041 h 51.68424 c -10.05205,53.73979 -67.15384,71.98058 -116.303,71.98058 C 39.606424,324.89544 0,275.67889 0,209.30653 0,136.24203 40.965642,88.12194 129.78809,88.12194 c 70.69867,0 122.49992,36.99926 122.49992,117.75572 v 13.31324 z"
        fill="#f12c2d"
      />
      <path
        d="M 380.83181,290.6235 c 46.57228,0 78.44078,-33.52181 78.44078,-84.10854 0,-50.58203 -31.8685,-84.10854 -78.44078,-84.10854 -46.31058,0 -78.44392,33.52651 -78.44392,84.10854 0,50.58673 32.13334,84.10854 78.44392,84.10854 z M 252.2854,0 h 50.10249 l -0.005,125.87707 c 24.55682,-29.25975 58.38892,-37.75513 91.68976,-37.75513 55.83503,0 117.85132,37.6773 117.85132,119.02875 0,68.12232 -49.32155,117.74475 -118.78114,117.74475 -36.35726,0 -70.58062,-13.04265 -91.68663,-38.88294 0,10.32107 -0.57618,20.72364 -1.70503,30.56413 h -49.17162 c 0.85513,-15.90944 1.70555,-35.7184 1.70555,-51.74693 z"
        fill="#0968f6"
      />
      <path
        d="M 1000,96.45747 845.05541,400.75099 H 788.94926 L 833.49578,316.25589 716.89033,96.45747 h 58.6266 l 85.80469,171.73057 85.56283,-171.73057 z"
        fill="#93c822"
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
