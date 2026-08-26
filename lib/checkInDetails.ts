export type CheckInDetail = {
  label: string;
  value: string;
};

/** A normalized answer available to the authenticated check-in desk. */
export type RegistrationDetail = CheckInDetail & {
  key: string;
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
export function getRegistrationDetails(answers: RegistrationAnswer[]): RegistrationDetail[] {
  const valuesByField = new Map<string, RegistrationDetail>();
  for (const answer of answers) {
    const value = displayAnswerValue(answer);
    if (!value) continue;
    const existing = valuesByField.get(answer.field.key);
    if (existing) {
      existing.value = `${existing.value}, ${value}`;
    } else {
      valuesByField.set(answer.field.key, {
        key: answer.field.key,
        label: answer.field.label,
        value,
      });
    }
  }
  return Array.from(valuesByField.values());
}

export function getCheckInDetails(answers: RegistrationAnswer[]): CheckInDetail[] {
  return getRegistrationDetails(answers)
    .filter((detail) => isDoorDetailField(detail))
    .map(({ label, value }) => ({ label, value }));
}
