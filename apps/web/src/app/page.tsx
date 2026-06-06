import { RequirementDeliveryConsoleClient } from "@/components/delivery/requirement-delivery-console-client";
import { RunConsole } from "@/components/run-console";

export default function Home() {
  return (
    <>
      <RequirementDeliveryConsoleClient />
      <details className="legacyConsolePanel" id="legacy-run-console">
        <summary>Legacy Run Console</summary>
        <RunConsole />
      </details>
    </>
  );
}
