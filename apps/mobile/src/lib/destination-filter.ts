import type { Destination } from "@/types/content";

export function matchesDestinationFilters(
  destination: Destination,
  selectedCountries: string[],
  selectedCategories: string[],
): boolean {
  const countryOk =
    selectedCountries.length === 0 ||
    (destination.country !== null && selectedCountries.includes(destination.country));
  const categoryOk =
    selectedCategories.length === 0 ||
    destination.categories.some((category) => selectedCategories.includes(category));
  return countryOk && categoryOk;
}
