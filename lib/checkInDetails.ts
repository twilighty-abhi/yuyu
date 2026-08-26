export type CheckInDetail = {
  label: string;
  value: string;
};

type RegistrationAnswer = {
  valueText: string | null;
  valueBool: boolean | null;
  valueNumber: number | null;
  valueDate: Date | null;
  field: { key: string; label: string };
};

function isDoorDetailField(field: RegistrationAnswer["field"]) {
  const identifier = `${field.key} ${field.label}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    identifier.includes("foodpreference") ||
    identifier.includes("dietarypreference") ||
    identifier.includes("tshirtsize") ||
    identifier.includes("shirtsize")
  );
}

function displayAnswerValue(answer: RegistrationAnswer) {
  if (answer.valueText) return answer.valueText;
  if (answer.valueNumber !== null) return String(answer.valueNumber);
  if (answer.valueBool !== null) return answer.valueBool ? "Yes" : "No";
  if (answer.valueDate) return answer.valueDate.toISOString().slice(0, 10);
  return "";
}

/**
 * Returns only the operational registration answers staff need at the door.
 * Multi-select fields have one row per answer, so values are joined by label.
 */
export function getCheckInDetails(answers: RegistrationAnswer[]): CheckInDetail[] {
  const valuesByLabel = new Map<string, string[]>();
  for (const answer of answers) {
    if (!isDoorDetailField(answer.field)) continue;
    const value = displayAnswerValue(answer);
    if (!value) continue;
    const existing = valuesByLabel.get(answer.field.label) ?? [];
    existing.push(value);
    valuesByLabel.set(answer.field.label, existing);
  }
  return Array.from(valuesByLabel, ([label, values]) => ({
    label,
    value: values.join(", "),
  }));
}
