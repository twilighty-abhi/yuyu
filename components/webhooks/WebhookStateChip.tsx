import { Chip } from "@/components/ui/display";
import type { WebhookEndpointState } from "@/lib/webhooks/eventTypes";

const LABELS: Record<WebhookEndpointState, { label: string; tone: "success" | "neutral" | "danger" }> = {
  enabled: { label: "Enabled", tone: "success" },
  disabled: { label: "Disabled", tone: "neutral" },
  auto_disabled: { label: "Auto-disabled", tone: "danger" },
};

export function WebhookStateChip({ state }: { state: WebhookEndpointState }) {
  const { label, tone } = LABELS[state];
  return <Chip size="sm" tone={tone}>{label}</Chip>;
}
