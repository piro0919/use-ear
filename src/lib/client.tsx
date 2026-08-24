"use client";

import { SerwistProvider as OriginalSerwistProvider } from "@serwist/turbopack/react";
import type { ReactNode } from "react";

type SerwistProviderProps = {
  children: ReactNode;
  swUrl: string;
};

export function SerwistProvider({ children, swUrl }: SerwistProviderProps) {
  // 開発環境ではService Workerを登録しない
  if (process.env.NODE_ENV === "development") {
    return <>{children}</>;
  }

  return (
    <OriginalSerwistProvider swUrl={swUrl}>{children}</OriginalSerwistProvider>
  );
}
