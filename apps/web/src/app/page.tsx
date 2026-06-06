import { buildDeliveryConsoleModel } from "@/components/delivery/delivery-console-model";
import { RequirementDeliveryConsole } from "@/components/delivery/requirement-delivery-console";
import { RunConsole } from "@/components/run-console";

export default function Home() {
  return (
    <>
      <RequirementDeliveryConsole model={buildDeliveryConsoleModel([])} />
      <details className="legacyConsolePanel" id="legacy-run-console">
        <summary>Legacy Run Console</summary>
        <RunConsole />
      </details>
    </>
  );
}
