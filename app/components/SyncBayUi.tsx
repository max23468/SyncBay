/**
 * Componenti del design layer SyncBay (ADR 0010).
 *
 * Lista chiusa: tile metrica, hero di stato, scheda connessione, decision card
 * conflitto, pannello sorgente, tappa stepper, evento timeline, scheda
 * impostazione, stato vuoto e scheletro di sezione. Sono wrapper in light DOM con
 * CSS minimo (`app/styles/syncbay-embedded.css`) attorno a componenti Polaris
 * Web Components nativi. Non aggiungere altri wrapper custom senza aggiornare
 * l'ADR.
 */

import type { ReactNode } from "react";

import type { ImportStepStatus } from "../lib/syncbay-import-step-status";

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

type MetricTrend = {
  label: string;
  tone: "up" | "watch" | "neutral";
};

type MetricTileProps = {
  detail?: string;
  icon: SyncBayIcon;
  label: string;
  tone?: SyncBayTone;
  trend?: MetricTrend;
  value: string;
};

export function MetricTile({
  detail,
  icon,
  label,
  tone = "neutral",
  trend,
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
        {trend ? (
          trend.tone === "neutral" ? (
            <s-text color="subdued">{trend.label}</s-text>
          ) : (
            <span className={`syncbay-tile__trend syncbay-tile__trend--${trend.tone}`}>
              {trend.label}
            </span>
          )
        ) : null}
      </span>
    </div>
  );
}

type SyncPulseProps = {
  appliedLabel: string;
  marketplaceLabel: string;
  readLabel: string;
  working: boolean;
};

/**
 * Battito del sync (Panoramica): flusso eBay -> SyncBay -> Shopify. Quando
 * `working` è vero, i connettori mostrano pallini in viaggio e l'hub ruota;
 * a riposo l'hub diventa una spunta e il flusso è statico. I conteggi sono
 * etichette derivate dai dati reali. Vedi ADR 0010.
 */
export function SyncPulse({
  appliedLabel,
  marketplaceLabel,
  readLabel,
  working,
}: SyncPulseProps) {
  return (
    <figure
      aria-label={`Flusso di sincronizzazione da ${marketplaceLabel} a Shopify, ${
        working ? "in corso" : "a riposo"
      }. ${readLabel}. ${appliedLabel}.`}
      className="syncbay-pulse"
    >
      <span aria-hidden="true" className="syncbay-pulse__stage">
        <span className="syncbay-pulse__node">
          <s-icon type="store" tone="neutral" size="base" />
        </span>
        <s-text>{marketplaceLabel}</s-text>
        <s-text color="subdued">sorgente</s-text>
      </span>
      <span aria-hidden="true" className="syncbay-pulse__track">
        {working ? (
          <>
            <span className="syncbay-pulse__dot" />
            <span className="syncbay-pulse__dot syncbay-pulse__dot--delay" />
          </>
        ) : null}
        <span className="syncbay-pulse__track-label">{readLabel}</span>
      </span>
      <span aria-hidden="true" className="syncbay-pulse__stage">
        <span
          className={`syncbay-pulse__node ${
            working ? "syncbay-pulse__node--hub" : "syncbay-pulse__node--done"
          }`}
        >
          {working ? (
            <span className="syncbay-pulse__spin">
              <s-icon type="refresh" tone="info" size="base" />
            </span>
          ) : (
            <s-icon type="check-circle" tone="success" size="base" />
          )}
        </span>
        <s-text>SyncBay</s-text>
        <s-text color="subdued">{working ? "allinea" : "allineato"}</s-text>
      </span>
      <span aria-hidden="true" className="syncbay-pulse__track">
        {working ? <span className="syncbay-pulse__dot" /> : null}
        <span className="syncbay-pulse__track-label">{appliedLabel}</span>
      </span>
      <span aria-hidden="true" className="syncbay-pulse__stage">
        <span className="syncbay-pulse__node">
          <s-icon type="store-online" tone="neutral" size="base" />
        </span>
        <s-text>Shopify</s-text>
        <s-text color="subdued">vetrina</s-text>
      </span>
    </figure>
  );
}

type SparklineProps = {
  ariaLabel: string;
  values: number[];
};

/**
 * Sparkline minima dell'andamento (Panoramica): polilinea in accento Bay Blue,
 * scalata sui valori reali. Serie vuota o piatta resa come baseline. I valori
 * arrivano dall'aggregazione dello storico job, non sono sintetici.
 */
export function Sparkline({ ariaLabel, values }: SparklineProps) {
  const width = 150;
  const height = 34;
  const pad = 3;
  const max = Math.max(1, ...values);
  const count = values.length;
  const point = (value: number, index: number) => {
    const x =
      count <= 1 ? width - pad : (index / (count - 1)) * (width - pad * 2) + pad;
    const y = height - pad - (value / max) * (height - pad * 2);

    return { x, y };
  };
  const points = values
    .map((value, index) => {
      const { x, y } = point(value, index);

      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = count > 0 ? point(values[count - 1], count - 1) : null;

  return (
    <svg
      aria-label={ariaLabel}
      className="syncbay-reliability__spark"
      height={height}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      {count > 1 ? (
        <polyline
          fill="none"
          points={points}
          stroke="var(--syncbay-accent)"
          strokeWidth="2"
        />
      ) : (
        <line
          stroke="var(--syncbay-mist)"
          strokeWidth="2"
          x1={pad}
          x2={width - pad}
          y1={height / 2}
          y2={height / 2}
        />
      )}
      {last ? <circle cx={last.x} cy={last.y} fill="var(--syncbay-accent)" r="3" /> : null}
    </svg>
  );
}

type RiskLensProps = {
  body: string;
  count: number;
  href?: string;
  title: string;
};

/**
 * Lente rischio disponibilità (Panoramica): la card più pesante della pagina.
 * Quando ci sono prodotti a rischio è in tono di attenzione con azione diretta;
 * a zero diventa una rassicurazione verde. Protezione disponibilità = valore #1
 * del prodotto. Vedi ADR 0010/0011.
 */
export function RiskLens({ body, count, href, title }: RiskLensProps) {
  const clear = count === 0;

  return (
    <div className={`syncbay-risk ${clear ? "syncbay-risk--clear" : ""}`}>
      <span className="syncbay-risk__icon">
        <s-icon
          type={clear ? "check-circle" : "alert-triangle"}
          tone={clear ? "success" : "warning"}
          size="base"
        />
      </span>
      <span className="syncbay-risk__body">
        <s-heading>{title}</s-heading>
        <s-text color="subdued">{body}</s-text>
      </span>
      {!clear && href ? (
        <span className="syncbay-risk__actions">
          <s-button href={href} variant="primary">
            Rivedi
          </s-button>
        </span>
      ) : null}
    </div>
  );
}

export type StepStatus = ImportStepStatus;

type StepProps = {
  children: ReactNode;
  index: number;
  isLast?: boolean;
  status: StepStatus;
  statusLabel: string;
  title: string;
};

/**
 * Tappa di uno stepper verticale (Importazione). Nodo numerato, o spuntato se
 * completato, con connettore verso la tappa successiva. Vedi ADR 0010.
 */
export function Step({
  children,
  index,
  isLast = false,
  status,
  statusLabel,
  title,
}: StepProps) {
  const tone: SyncBayTone =
    status === "completed" ? "success" : status === "active" ? "info" : "neutral";

  return (
    <li className={`syncbay-step syncbay-step--${status}`}>
      <span className="syncbay-step__rail">
        <span className="syncbay-step__node">
          {status === "completed" ? "✓" : index}
        </span>
        {isLast ? null : <span className="syncbay-step__line" />}
      </span>
      <div className="syncbay-step__panel">
        <span className="syncbay-step__head">
          <s-heading>{title}</s-heading>
          <s-badge tone={tone}>{statusLabel}</s-badge>
        </span>
        <s-stack gap="base">{children}</s-stack>
      </div>
    </li>
  );
}

type TimelineEventProps = {
  children: ReactNode;
  icon: SyncBayIcon;
  isLast?: boolean;
  tone: SyncBayTone;
};

/**
 * Evento di una timeline operativa (Attività). Nodo con icona colorata per
 * esito e connettore verso l'evento successivo. Vedi ADR 0010.
 */
export function TimelineEvent({
  children,
  icon,
  isLast = false,
  tone,
}: TimelineEventProps) {
  return (
    <li className={`syncbay-event syncbay-event--${tone}`}>
      <span className="syncbay-event__rail">
        <span className="syncbay-event__node">
          <s-icon type={icon} tone={tone} size="base" />
        </span>
        {isLast ? null : <span className="syncbay-event__line" />}
      </span>
      <div className="syncbay-event__panel">{children}</div>
    </li>
  );
}

type SettingCardProps = {
  children: ReactNode;
  description?: string;
  icon: SyncBayIcon;
  statusLabel: string;
  statusTone: SyncBayTone;
  title: string;
};

/**
 * Scheda impostazione (Impostazioni). Box verticale con intestazione icona +
 * titolo + stato corrente a colpo d'occhio, poi i controlli. Vedi ADR 0010.
 */
export function SettingCard({
  children,
  description,
  icon,
  statusLabel,
  statusTone,
  title,
}: SettingCardProps) {
  return (
    <section className="syncbay-setting">
      <header className="syncbay-setting__head">
        <span className="syncbay-setting__icon">
          <s-icon type={icon} tone="neutral" size="base" />
        </span>
        <span className="syncbay-setting__heading">
          <s-heading>{title}</s-heading>
          {description ? <s-text color="subdued">{description}</s-text> : null}
        </span>
        <span className="syncbay-setting__status">
          <s-badge tone={statusTone}>{statusLabel}</s-badge>
        </span>
      </header>
      <s-stack gap="base">{children}</s-stack>
    </section>
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

type EmptyStateProps = {
  actionHref?: string;
  actionLabel?: string;
  actionVariant?: "primary" | "secondary";
  body: string;
  icon: SyncBayIcon;
  title: string;
};

/**
 * Stato vuoto del design layer (Catalogo, Conflitti, Attività e simili). Nodo
 * icona neutro + titolo che dichiara la causa + corpo che spiega cosa fare, con
 * un'azione opzionale. Uniforma gli stati "nessun risultato" finora hand-rolled
 * con `s-box`, così le superfici parlano la stessa lingua visiva. Vedi ADR 0010.
 */
export function EmptyState({
  actionHref,
  actionLabel,
  actionVariant = "primary",
  body,
  icon,
  title,
}: EmptyStateProps) {
  return (
    <div className="syncbay-empty">
      <span aria-hidden="true" className="syncbay-empty__icon">
        <s-icon type={icon} tone="neutral" size="base" />
      </span>
      <div className="syncbay-empty__body">
        <s-heading>{title}</s-heading>
        <s-text color="subdued">{body}</s-text>
      </div>
      {actionHref && actionLabel ? (
        <span className="syncbay-empty__actions">
          <s-button href={actionHref} variant={actionVariant}>
            {actionLabel}
          </s-button>
        </span>
      ) : null}
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

/**
 * Scheletro di sezione mostrato durante la navigazione tra le superfici, finché
 * il loader della pagina di destinazione non risponde: dà un riscontro
 * strutturale immediato (velocità percepita) senza ricorrere allo streaming
 * `defer`, scartato perché i loader sono DB-bound (ADR 0014). È puramente
 * decorativo: `aria-hidden`, perché l'annuncio accessibile lo fa già
 * l'indicatore live di cambio rotta. Lo shimmer si ferma con
 * `prefers-reduced-motion`. Vedi ADR 0010.
 */
export function RouteSkeleton() {
  return (
    <div aria-hidden="true" className="syncbay-skeleton">
      <span className="syncbay-skeleton__line syncbay-skeleton__line--title" />
      <div className="syncbay-skeleton__grid">
        <span className="syncbay-skeleton__tile" />
        <span className="syncbay-skeleton__tile" />
        <span className="syncbay-skeleton__tile" />
      </div>
      <div className="syncbay-skeleton__rows">
        <span className="syncbay-skeleton__row" />
        <span className="syncbay-skeleton__row" />
        <span className="syncbay-skeleton__row" />
        <span className="syncbay-skeleton__row" />
      </div>
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
        d="m 633.08,212.53 c -45.44,1.49 -73.67,9.69 -73.67,39.62 0,19.38 15.45,40.38 54.66,40.38 52.58,0 80.64,-28.66 80.64,-75.66 l 0,-5.17 c -18.43,0 -41.16,0.16 -61.64,0.83 z m 111.75,62.1 c 0,14.58 0.42,28.98 1.69,41.94 h -46.61 c -1.24,-10.67 -1.7,-21.28 -1.7,-31.57 -25.2,30.98 -55.18,39.89 -96.76,39.89 -61.68,0 -94.7,-32.6 -94.7,-70.31 0,-54.61 44.92,-73.87 122.89,-75.65 21.32,-0.49 45.27,-0.56 65.08,-0.56 l 0,-5.34 c 0,-36.56 -23.44,-51.59 -64.07,-51.59 -30.16,0 -52.39,12.48 -54.68,34.05 h -52.65 c 5.57,-53.77 62.07,-67.37 111.74,-67.37 59.51,0 109.77,21.17 109.77,84.11 z"
        fill="#ffbc13"
      />
      <path
        d="m 199.64,185.87 c -1.94,-46.88 -35.78,-64.42 -71.94,-64.42 -38.99,0 -70.13,19.73 -75.58,64.42 z M 51.03,219.19 c 2.7,45.48 34.07,72.38 77.2,72.38 29.88,0 56.46,-12.17 65.36,-38.66 h 51.68 c -10.05,53.74 -67.15,71.98 -116.3,71.98 C 39.61,324.9 0,275.68 0,209.31 0,136.24 40.97,88.12 129.79,88.12 c 70.7,0 122.5,37 122.5,117.76 v 13.31 z"
        fill="#f12c2d"
      />
      <path
        d="M 380.83,290.62 c 46.57,0 78.44,-33.52 78.44,-84.11 0,-50.58 -31.87,-84.11 -78.44,-84.11 -46.31,0 -78.44,33.53 -78.44,84.11 0,50.59 32.13,84.11 78.44,84.11 z M 252.29,0 h 50.1 l 0,125.88 c 24.56,-29.26 58.39,-37.76 91.69,-37.76 55.84,0 117.85,37.68 117.85,119.03 0,68.12 -49.32,117.74 -118.78,117.74 -36.36,0 -70.58,-13.04 -91.69,-38.88 0,10.32 -0.58,20.72 -1.71,30.56 h -49.17 c 0.86,-15.91 1.71,-35.72 1.71,-51.75 z"
        fill="#0968f6"
      />
      <path
        d="M 1000,96.46 845.06,400.75 H 788.95 L 833.5,316.26 716.89,96.46 h 58.63 l 85.8,171.73 85.56,-171.73 z"
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
