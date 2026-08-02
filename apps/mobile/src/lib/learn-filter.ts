export type LearnFilterable = {
  gradeLevel: string | null;
  syllabusTopic: string | null;
  culturalGroupIds: string[];
};

export function matchesLearnFilters(
  item: LearnFilterable,
  selectedGradeLevels: string[],
  selectedSyllabusTopics: string[],
  selectedCulturalGroupIds: string[],
): boolean {
  const gradeOk =
    selectedGradeLevels.length === 0 ||
    (item.gradeLevel !== null && selectedGradeLevels.includes(item.gradeLevel));
  const topicOk =
    selectedSyllabusTopics.length === 0 ||
    (item.syllabusTopic !== null && selectedSyllabusTopics.includes(item.syllabusTopic));
  const culturalGroupOk =
    selectedCulturalGroupIds.length === 0 ||
    item.culturalGroupIds.some((id) => selectedCulturalGroupIds.includes(id));
  return gradeOk && topicOk && culturalGroupOk;
}
