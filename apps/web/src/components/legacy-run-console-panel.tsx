"use client";

import dynamic from "next/dynamic";

const ClientRunConsole = dynamic(
  () => import("./run-console").then((module) => module.RunConsole),
  {
    loading: () => (
      <div className="legacyConsoleHydrationSlot" aria-hidden="true" />
    ),
    ssr: false
  }
);

export function LegacyRunConsolePanel() {
  return (
    <details className="legacyConsolePanel" id="legacy-run-console">
      <summary>Legacy Run Console</summary>
      <ClientRunConsole />
    </details>
  );
}
