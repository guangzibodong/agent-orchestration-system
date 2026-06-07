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
      <summary aria-label="Legacy Run Console secondary ops/debug">
        <span>Legacy Run Console</span>
        <em>Secondary ops/debug</em>
      </summary>
      <ClientRunConsole />
    </details>
  );
}
