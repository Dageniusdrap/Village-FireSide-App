export type CountryCode = {
  name: string;
  dialCode: string;
};

// `satisfies` (not a `: readonly CountryCode[]` annotation) keeps this a
// literal tuple type instead of widening it to a general array — with this
// project's `noUncheckedIndexedAccess` tsconfig option, a general array's
// indexed access is `CountryCode | undefined`, but a tuple's fixed-index
// access is not. COUNTRY_CODES[0] must stay non-optional for Task 11's
// default form value.
export const COUNTRY_CODES = [
  { name: "Kenya", dialCode: "+254" },
  { name: "Uganda", dialCode: "+256" },
  { name: "Tanzania", dialCode: "+255" },
  { name: "Rwanda", dialCode: "+250" },
  { name: "Ethiopia", dialCode: "+251" },
  { name: "Nigeria", dialCode: "+234" },
] as const satisfies readonly CountryCode[];

export function toE164(dialCode: string, localNumber: string): string {
  const digitsOnly = localNumber.replace(/\D/g, "");
  const withoutLeadingZero = digitsOnly.replace(/^0+/, "");
  return `${dialCode}${withoutLeadingZero}`;
}
