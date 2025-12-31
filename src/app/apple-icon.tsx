import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
        borderRadius: 38,
      }}
    >
      <svg
        width="120"
        height="120"
        viewBox="-150 -150 300 300"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M-60,-120 C-120,-120 -140,-60 -140,20 C-140,100 -80,140 -20,140 C0,140 20,130 20,110 C20,90 0,80 -20,80 C-50,80 -70,50 -70,20 C-70,-20 -50,-50 -20,-50 C30,-50 60,-10 60,50 C60,90 40,120 40,120"
          stroke="white"
          strokeWidth="36"
          strokeLinecap="round"
        />
        <circle cx="40" cy="145" r="22" fill="white" />
        <path
          d="M60,-80 C100,-80 120,-40 120,20 C120,60 100,90 100,90"
          stroke="white"
          strokeWidth="28"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>
    </div>,
    { ...size }
  );
}
