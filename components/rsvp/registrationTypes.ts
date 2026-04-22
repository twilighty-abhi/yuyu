import type { RegistrationFieldType } from "@prisma/client";

export type RegistrationFieldDefinition = {
  key: string;
  label: string;
  type: RegistrationFieldType;
  required: boolean;
  options: string[];
};

