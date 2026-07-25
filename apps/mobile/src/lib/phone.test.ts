// apps/mobile/src/lib/phone.test.ts
import { COUNTRY_CODES, toE164 } from "./phone";

describe("toE164", () => {
  it("combines a dial code and local digits", () => {
    expect(toE164("+254", "712345678")).toBe("+254712345678");
  });

  it("strips a leading 0 from the local number", () => {
    expect(toE164("+254", "0712345678")).toBe("+254712345678");
  });

  it("strips non-digit characters from the local number", () => {
    expect(toE164("+256", "070-123-4567")).toBe("+256701234567");
  });
});

describe("COUNTRY_CODES", () => {
  it("includes at least Kenya, Uganda, Tanzania, Rwanda, Ethiopia, and Nigeria", () => {
    const names = COUNTRY_CODES.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["Kenya", "Uganda", "Tanzania", "Rwanda", "Ethiopia", "Nigeria"]),
    );
  });

  it("every dial code starts with a plus sign followed by digits", () => {
    for (const country of COUNTRY_CODES) {
      expect(country.dialCode).toMatch(/^\+\d+$/);
    }
  });
});
