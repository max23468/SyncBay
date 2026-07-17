import { SYNCBAY_BRAND_ASSETS, SYNCBAY_TAGLINE } from "../lib/syncbay-brand";

type SyncBayBrandPanelProps = {
  detail: string;
  label?: string;
};

export function SyncBayBrandPanel({
  detail,
  label = "1.0 privata",
}: SyncBayBrandPanelProps) {
  return (
    <s-box
      background="subdued"
      border="base"
      borderColor="base"
      borderRadius="base"
      padding="base"
    >
      <s-stack gap="base">
        <s-grid
          gap="base"
          gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
        >
          <s-box inlineSize="180px">
            <s-image
              alt="SyncBay"
              aspectRatio="4/1"
              loading="eager"
              objectFit="contain"
              src={SYNCBAY_BRAND_ASSETS.logoHorizontal}
            />
          </s-box>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-badge tone="info">{label}</s-badge>
          </s-stack>
        </s-grid>
        <s-stack gap="small-200">
          <s-text>{SYNCBAY_TAGLINE}</s-text>
          <s-text color="subdued">{detail}</s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );
}
