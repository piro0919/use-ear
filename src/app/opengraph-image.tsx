import { ImageResponse } from "next/og";

export const alt = "useEar";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

const TITLE = "useEar";
const DESCRIPTION = "React hook for wake word detection using the Web Speech API.";

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        padding: "0 80px",
        background: "#0b0b0f",
        color: "#ffffff",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: 600,
        }}
      >
      <div
        style={{
          display: "flex",
          fontSize: 84,
          fontWeight: 700,
          letterSpacing: -1,
        }}
      >
        {TITLE}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 32,
          marginTop: 28,
          lineHeight: 1.4,
          color: "#a1a1aa",
        }}
      >
        {DESCRIPTION}
      </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            marginTop: 48,
            color: "#71717a",
          }}
        >
          kkweb.io
        </div>
      </div>

      {/* 何をするパッケージなのかを右に置く。名前と説明だけだと、
          9件が同じ絵になってタイムラインで見分けが付かない */}
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flex: 1,
          justifyContent: "center",
        }}
      >
        {/* 起動語を待っている状態。声の大きさだけが動く */}
        <div
          style={{
            alignItems: "center",
            background: "#15151c",
            border: "1px solid #26262f",
            borderRadius: 20,
            display: "flex",
            gap: 22,
            padding: "28px 30px",
          }}
        >
          <div
            style={{
              alignItems: "center",
              background: "#10b981",
              borderRadius: 999,
              display: "flex",
              height: 74,
              justifyContent: "center",
              width: 74,
            }}
          >
            <svg
              fill="none"
              height="38"
              viewBox="0 0 24 24"
              width="38"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Zm7 9a7 7 0 0 1-6 6.93V22h-2v-3.07A7 7 0 0 1 5 12h2a5 5 0 0 0 10 0h2Z"
                fill="#03231a"
              />
            </svg>
          </div>
          <div style={{ alignItems: "center", display: "flex", gap: 7 }}>
            {[26, 52, 88, 40, 70, 30, 58, 22].map((h, i) => (
              <div
                key={i}
                style={{
                  background: "#10b981",
                  borderRadius: 999,
                  height: h,
                  opacity: 0.35 + (h / 88) * 0.65,
                  width: 9,
                }}
              />
            ))}
          </div>
        </div>
      </div>

    </div>,
    size,
  );
}
