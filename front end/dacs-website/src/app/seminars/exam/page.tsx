"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SeminarPageHeader } from "@/components/seminars/SeminarPageHeader";
import { ROUTES } from "@/constants/routes";
import { errorMessage } from "@/lib/api";
import {
  getModuleQuiz,
  submitModuleQuiz,
  type ApiQuiz,
} from "@/lib/api/seminars";
import {
  LAST_QUIZ_RESULT_KEY,
  type LastQuizResult,
} from "@/lib/seminarHandoff";
import {
  canAccessView,
  fetchSeminarState,
  pickActiveView,
  type SeminarView,
} from "@/services/seminar.service";

// Figma: Module Seminar Exam (290:626), rendered at 0.75 scale in a 1440px
// container — question cards (469 -> 352 tall, headings 32 -> 24, choices
// 24 -> 18) and a Submit button (288x85 -> 216x64).
//
// The quiz comes from GET /api/seminars/modules/:id/quiz with the correct
// answers STRIPPED server-side; submissions are scored entirely by the
// backend (POST the chosen questionId/choiceId pairs). Passing per the
// module's own passing score completes the module (with all videos
// watched) and unlocks the next one.
//
// Route guard (mount effect): the ACTIVE seminar must be unlocked and
// enrolled with ALL its videos watched; otherwise the farmer is sent back
// to the first unwatched video.


export default function ModuleSeminarExamPage() {
  const router = useRouter();
  // null until the guard passes — the page renders nothing while checking.
  const [seminar, setSeminar] = useState<SeminarView | null>(null);
  const [quiz, setQuiz] = useState<ApiQuiz | null>(null);
  /** Chosen choice id per question id. */
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  /** Last failing score, shown in the retake notice. */
  const [failedScore, setFailedScore] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { views } = await fetchSeminarState();
        if (cancelled) return;
        const active = pickActiveView(views);
        if (!active || !canAccessView(active) || !active.started) {
          router.replace(ROUTES.seminars);
          return;
        }
        /*
         * A finished seminar still inside its 2-year window keeps the
         * result it earned: the exam is closed (the backend returns 409
         * for it too) and this route leads to the certificate instead.
         */
        if (active.retakeLocked) {
          router.replace("/seminars/certificate");
          return;
        }
        const firstUnwatched = active.videos.findIndex(
          (video) => !video.watched
        );
        if (firstUnwatched !== -1) {
          router.replace(`/seminars/modules/${firstUnwatched + 1}`);
          return;
        }
        const quizPayload = await getModuleQuiz(active.moduleId);
        if (cancelled) return;
        setSeminar(active);
        setQuiz(quizPayload);
      } catch (error) {
        if (cancelled) return;
        setServiceError(
          errorMessage(error, "The exam could not be loaded right now.")
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const allAnswered =
    quiz !== null &&
    quiz.questions.length > 0 &&
    quiz.questions.every((question) => answers[question.id]);

  function chooseAnswer(questionId: string, choiceId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: choiceId }));
  }

  async function handleSubmit() {
    if (!seminar || !quiz || !allAnswered || submitting) return;
    setServiceError(null);
    setSubmitting(true);
    try {
      const result = await submitModuleQuiz(
        seminar.moduleId,
        quiz.questions.map((question) => ({
          questionId: question.id,
          choiceId: answers[question.id],
        }))
      );
      if (result.passed) {
        const handoff: LastQuizResult = {
          seminarId: seminar.id,
          title: seminar.title,
          percentage: Math.round(result.percentage),
          passingScore: result.passingScore,
          moduleCompleted: result.moduleCompleted,
          completedAt: new Date().toISOString(),
        };
        window.sessionStorage.setItem(
          LAST_QUIZ_RESULT_KEY,
          JSON.stringify(handoff)
        );
        router.push("/seminars/certificate");
        return;
      }
      // Failed: stay here — answers stay selected so the farmer can revise
      // and resubmit (the backend records every attempt).
      setFailedScore(Math.round(result.percentage));
    } catch (error) {
      setServiceError(
        errorMessage(error, "Unable to submit the exam right now.")
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!seminar || !quiz) {
    return (
      <div className="bg-white">
        <div className="mx-auto max-w-[1440px] px-[20px] py-[80px]">
          <p className="text-center text-[18px] leading-normal text-[#7d7d7d]">
            {serviceError ?? "Loading exam..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white">
      <SeminarPageHeader
        title={seminar.title}
        activeStep={2}
        backHref={`/seminars/modules/${Math.max(seminar.videos.length, 1)}`}
      />

      <div className="mx-auto mt-[32px] flex max-w-[1440px] flex-col gap-[24px] px-[20px] lg:mt-[43px] lg:gap-[23px] lg:pl-[122px] lg:pr-[123px]">
        {quiz.questions.map((question, questionIndex) => (
          <section
            key={question.id}
            className="w-full rounded-[15px] bg-white pb-[40px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:min-h-[352px] lg:pb-[44px]"
          >
            <div className="px-[24px] pt-[32px] lg:px-[59px] lg:pt-[44px]">
              <h2 className="text-[24px] font-bold leading-normal text-black">
                QUESTION #{questionIndex + 1}
              </h2>
              <p className="mt-[16px] text-[16px] leading-normal text-black lg:mt-[23px] lg:text-[18px]">
                {question.questionText}
              </p>
              <div className="mt-[32px] flex flex-col gap-[17px] lg:mt-[37px] lg:pl-[38px]">
                {question.choices.map((choice) => {
                  const selected = answers[question.id] === choice.id;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => chooseAnswer(question.id, choice.id)}
                      aria-pressed={selected}
                      className="flex cursor-pointer items-center gap-[16px] text-left lg:gap-[20px]"
                    >
                      <img
                        src={
                          selected
                            ? "/figma/radio-checked.svg"
                            : "/figma/radio-exam.svg"
                        }
                        alt=""
                        className="size-[21px] shrink-0"
                      />
                      <span className="text-[16px] leading-normal text-black lg:text-[18px]">
                        {choice.choiceText}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </div>

      <div className="mx-auto flex max-w-[1440px] flex-col items-end gap-[24px] px-[20px] pb-[60px] pt-[40px] lg:pb-[60px] lg:pl-[122px] lg:pr-[123px] lg:pt-[62px]">
        {failedScore !== null && (
          <div
            role="alert"
            className="w-full rounded-[15px] border border-[#c00] bg-[#fdecec] px-[20px] py-[16px]"
          >
            <p className="text-[15px] font-semibold leading-normal text-[#c00]">
              Score: {failedScore}%. You need at least {quiz.passingScore}% to
              pass. Please review the videos and try again.
            </p>
          </div>
        )}
        {serviceError && (
          <p
            role="alert"
            className="w-full text-right text-[15px] leading-normal text-[#c00]"
          >
            {serviceError}
          </p>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allAnswered || submitting}
          className={`flex h-[64px] w-[216px] items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] ${
            allAnswered && !submitting
              ? "cursor-pointer"
              : "cursor-not-allowed opacity-50"
          }`}
        >
          <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
            {submitting ? "Submitting..." : "Submit"}
          </span>
        </button>
      </div>
    </div>
  );
}
