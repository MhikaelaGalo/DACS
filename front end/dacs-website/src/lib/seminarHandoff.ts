/**
 * Session-scoped handoff from the exam page to the certificate page so
 * the just-scored result can be shown without refetching (the server
 * remains the source of truth — the certificate page also loads the
 * backend progress).
 */
export interface LastQuizResult {
  seminarId: string;
  title: string;
  percentage: number;
  passingScore: number;
  moduleCompleted: boolean;
  completedAt: string;
}

export const LAST_QUIZ_RESULT_KEY = "dacs.lastQuizResult";
