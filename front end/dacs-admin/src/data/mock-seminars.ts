import type {
  SeminarModuleSummary,
  SeminarQuestionItem,
  SeminarVideoItem,
} from "@/types/admin";

export const MOCK_MODULES: SeminarModuleSummary[] = [
  {
    moduleNumber: 1,
    title: "Module 1: A Clearer Perspective of the Free-Range Poultry Scenario in the Philippines",
    description:
      "Foundations of free-range poultry raising in the Philippine setting: local market realities, common pitfalls, and the Dominant Asia approach.",
    videoCount: 12,
    questionCount: 10,
    passingScore: 70,
    price: 0,
    isPublished: true,
  },
  {
    moduleNumber: 2,
    title: "Module 2: AgriEntrepreneurship Online Seminar",
    description:
      "Running a poultry venture as a business: costing, pricing, record keeping, and building a repeatable farm-to-market operation.",
    videoCount: 3,
    questionCount: 5,
    passingScore: 70,
    price: 2700,
    isPublished: true,
  },
  {
    moduleNumber: 3,
    title: "Module 3: Dominant Cz Genetics & Breeding Seminar",
    description:
      "The Dominant Cz breed lines, selection and mating guidance, brooding standards, and the breeder certification pathway.",
    videoCount: 10,
    questionCount: 8,
    passingScore: 70,
    price: 2600,
    isPublished: true,
  },
];

export const MOCK_MODULE_VIDEOS: Record<number, SeminarVideoItem[]> = {
  1: [
    { id: "v1", title: "Video #1", duration: "12:30", displayOrder: 1 },
    { id: "v2", title: "Video #2", duration: "10:00", displayOrder: 2 },
    { id: "v3", title: "Video #3", duration: "15:27", displayOrder: 3 },
  ],
  2: [
    { id: "v4", title: "Video #1", duration: "18:05", displayOrder: 1 },
    { id: "v5", title: "Video #2", duration: "11:42", displayOrder: 2 },
    { id: "v6", title: "Video #3", duration: "09:58", displayOrder: 3 },
  ],
  3: [
    { id: "v7", title: "Video #1", duration: "14:12", displayOrder: 1 },
    { id: "v8", title: "Video #2", duration: "16:40", displayOrder: 2 },
    { id: "v9", title: "Video #3", duration: "13:21", displayOrder: 3 },
  ],
};

function question(
  id: string,
  index: number,
  correct: number
): SeminarQuestionItem {
  return {
    id,
    questionText: `Question #${index}`,
    choices: ["A", "B", "C", "D"].map((letter, choiceIndex) => ({
      id: `${id}-${letter}`,
      choiceText: `Answer ${letter}`,
      isCorrect: choiceIndex === correct,
    })),
  };
}

export const MOCK_MODULE_QUESTIONS: Record<number, SeminarQuestionItem[]> = {
  1: [
    question("q1", 1, 0),
    question("q2", 2, 3),
    question("q3", 3, 2),
    question("q4", 4, 1),
    question("q5", 5, 0),
  ],
  2: [question("q6", 1, 1), question("q7", 2, 2), question("q8", 3, 0)],
  3: [question("q9", 1, 3), question("q10", 2, 0), question("q11", 3, 1)],
};
