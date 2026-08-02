import type { GradeLevel, SubjectArea } from "@/types/content";

export const SUBJECT_AREAS: { value: SubjectArea; label: string }[] = [
  { value: "history", label: "History" },
  { value: "biology", label: "Biology" },
  { value: "geography", label: "Geography" },
  { value: "culture", label: "Culture" },
  { value: "conservation", label: "Conservation" },
  { value: "folklore", label: "Folklore" },
];

export const GRADE_LEVELS: { value: GradeLevel; label: string }[] = [
  { value: "primary", label: "Primary" },
  { value: "o_level", label: "O-Level" },
  { value: "a_level", label: "A-Level" },
  { value: "tertiary", label: "Tertiary" },
  { value: "general", label: "General" },
];
