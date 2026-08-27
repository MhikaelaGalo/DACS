import {
  MOCK_MODULE_QUESTIONS,
  MOCK_MODULE_VIDEOS,
  MOCK_MODULES,
} from "@/data/mock-seminars";
import type {
  SeminarModuleSummary,
  SeminarQuestionItem,
  SeminarVideoItem,
} from "@/types/admin";

/*
 * Seminar module content store (mock persistence). Integration swap:
 * modules from GET /api/seminars/modules, videos/questions from the
 * module detail endpoints, writes via POST/PATCH.
 */
export interface SeminarStore {
  modules: SeminarModuleSummary[];
  videos: Record<number, SeminarVideoItem[]>;
  questions: Record<number, SeminarQuestionItem[]>;
  /* moduleNumber -> certificate template image (path or data URL). */
  certificates: Record<number, string>;
}

export function defaultSeminarStore(): SeminarStore {
  return {
    modules: MOCK_MODULES,
    videos: MOCK_MODULE_VIDEOS,
    questions: MOCK_MODULE_QUESTIONS,
    certificates: {},
  };
}

export function newQuestion(index: number): SeminarQuestionItem {
  const id = `q-${Date.now()}-${index}`;
  return {
    id,
    questionText: `Question #${index}`,
    choices: ["A", "B", "C", "D"].map((letter, choiceIndex) => ({
      id: `${id}-${letter}`,
      choiceText: `Answer ${letter}`,
      isCorrect: choiceIndex === 0,
    })),
  };
}
