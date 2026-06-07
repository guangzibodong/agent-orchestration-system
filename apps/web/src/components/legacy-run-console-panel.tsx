"use client";

import dynamic from "next/dynamic";
import { useState, type SyntheticEvent } from "react";

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
  const [hasOpened, setHasOpened] = useState(false);

  function handleToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open) {
      setHasOpened(true);
    }
  }

  return (
    <details
      className="legacyConsolePanel"
      id="legacy-run-console"
      onToggle={handleToggle}
    >
      <summary aria-label="Legacy Run Console secondary ops/debug">
        <span>Legacy Run Console</span>
        <em>Secondary ops/debug</em>
      </summary>
      {hasOpened ? (
        <ClientRunConsole />
      ) : (
        <div className="legacyConsoleHydrationSlot" aria-hidden="true" />
      )}
    </details>
  );
}
