import { describe, expect, it } from "vitest";
import { getCheckInDetails } from "@/lib/checkInDetails";

describe("check-in details", () => {
  it("returns configured food preference and T-shirt size answers", () => {
    expect(getCheckInDetails([
      { field: { key: "food_preference", label: "Food preference" }, valueText: "Vegetarian", valueBool: null, valueNumber: null, valueDate: null },
      { field: { key: "t_shirt_size", label: "T-shirt size" }, valueText: "M", valueBool: null, valueNumber: null, valueDate: null },
      { field: { key: "company", label: "Company" }, valueText: "Yuyu", valueBool: null, valueNumber: null, valueDate: null },
    ])).toEqual([
      { label: "Food preference", value: "Vegetarian" },
      { label: "T-shirt size", value: "M" },
    ]);
  });

  it("joins multi-select dietary answers and omits missing answers", () => {
    expect(getCheckInDetails([
      { field: { key: "dietary_preference", label: "Dietary preference" }, valueText: "Vegan", valueBool: null, valueNumber: null, valueDate: null },
      { field: { key: "dietary_preference", label: "Dietary preference" }, valueText: "Nut-free", valueBool: null, valueNumber: null, valueDate: null },
      { field: { key: "tshirt_size", label: "T-shirt size" }, valueText: null, valueBool: null, valueNumber: null, valueDate: null },
    ])).toEqual([{ label: "Dietary preference", value: "Vegan, Nut-free" }]);
  });
});
