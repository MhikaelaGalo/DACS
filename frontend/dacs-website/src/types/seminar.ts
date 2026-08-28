import type { SeminarStatus } from "@/constants/statuses";

export interface SeminarModule {
  id: string;
  number: number;
  title: string;
  description: string;
  videoUrl: string;
  durationLabel: string;
  watched: boolean;
}

export interface Seminar {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  modules: SeminarModule[];
  status: SeminarStatus;
  examPassed: boolean;
  /** ISO date stamped when the exam was passed (drives "Completed:" rows). */
  completedAt?: string;
  /** Passing score stamped with completedAt — survives the single stored
   *  exam result being overwritten by a later module's exam. */
  completedScorePercent?: number;
}

export interface SeminarRegistrationInput {
  fullName: string;
  email: string;
  contactNumber: string;
  completeAddress: string;
  farmName: string;
  farmAddress: string;
  isReEnrollee: boolean;
}

export interface ExamQuestion {
  id: string;
  question: string;
  choices: string[];
  answerIndex: number;
}
