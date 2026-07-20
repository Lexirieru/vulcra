import { ImageResponse } from "next/og";

// Route segment config + image metadata
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";
export const alt = "Vulcra — Forge dollars from your XRP";

// Dynamic OG image. Only flexbox + a subset of CSS is supported by ImageResponse,
// so colors are hex (no oklch) and layout is flexbox only.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background: "#17120d",
          backgroundImage:
            "radial-gradient(ellipse 90% 70% at 50% -10%, rgba(240,124,42,0.42) 0%, rgba(23,18,13,0) 60%)",
          color: "#f4f1ea",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #f07c2a 0%, #f3ad3f 100%)",
              color: "#1b1108",
              fontSize: "34px",
              fontWeight: 800,
            }}
          >
            V
          </div>
          <div style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.02em" }}>
            Vulcra
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0 22px",
              fontSize: "84px",
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              maxWidth: "960px",
            }}
          >
            <span>Forge dollars from your</span>
            <span
              style={{
                background: "linear-gradient(135deg, #f07c2a 0%, #f3ad3f 100%)",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              XRP.
            </span>
          </div>
          <div style={{ fontSize: "30px", color: "#b8a794", maxWidth: "820px" }}>
            A CDP stablecoin on Flare. Lock FXRP, mint vUSD, repay to unlock.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "16px",
            fontSize: "22px",
            color: "#8f8171",
          }}
        >
          <span>FTSOv2</span>
          <span>·</span>
          <span>FAssets / FXRP</span>
          <span>·</span>
          <span>Smart Accounts 0xFE</span>
          <span>·</span>
          <span>FCC / TEE</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
