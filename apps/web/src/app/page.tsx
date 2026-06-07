import { RequirementDeliveryConsoleClient } from "@/components/delivery/requirement-delivery-console-client";
import { LegacyRunConsolePanel } from "@/components/legacy-run-console-panel";

export default function Home() {
  return (
    <>
      <RequirementDeliveryConsoleClient />
      <LegacyRunConsolePanel />
    </>
  );
}
