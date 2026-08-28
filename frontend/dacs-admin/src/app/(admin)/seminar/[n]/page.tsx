"use client";

import { Suspense, use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ImageIcon,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import {
  addSeminarQuestion,
  deleteSeminarModule,
  deleteSeminarQuestion,
  deleteSeminarVideo,
  formatDuration,
  getSeminarModule,
  listSeminarModules,
  parseDuration,
  removeModuleCoverImage,
  reorderSeminarVideos,
  updateSeminarModule,
  updateSeminarQuestion,
  uploadModuleCoverImage,
  uploadSeminarVideo,
  type ApiSeminarModule,
  type ApiSeminarQuestion,
  type ApiSeminarVideo,
} from "@/lib/api/seminars";
import { appendAudit } from "@/lib/audit";
import { removeStorage, STORAGE_KEYS } from "@/lib/storage";
import type { SeminarQuestionItem, SeminarVideoItem } from "@/types/admin";

/*
 * Module detail (Figma Seminar frames): view state shows Edit Exam;
 * clicking it enters the edit state (+ Add Question / Done, per-item
 * trash, editable question + answer text, editable passing grade).
 * Add Video uploads the real file to the backend; the right-hand panel
 * manages the customer-facing card content — the Module Cover Image
 * (stored server-side, shown on the customer seminar page) and the
 * Module Description shown beneath the title on that page.
 *
 * Data source: the DACS backend. Text edits save on BLUR (leaving the
 * field) instead of per keystroke — one PATCH per finished edit; the
 * hasUnpublishedChanges flag is server-managed and mirrored locally.
 */

const ANSWER_LETTERS = ["A", "B", "C", "D"] as const;

function toVideoItem(video: ApiSeminarVideo): SeminarVideoItem {
  return {
    id: video.id,
    title: video.title,
    duration: formatDuration(video.durationSeconds),
    displayOrder: video.displayOrder,
    fileName: video.fileName ?? undefined,
    videoUrl: video.videoUrl,
  };
}

function toQuestionItem(question: ApiSeminarQuestion): SeminarQuestionItem {
  return {
    id: question.id,
    questionText: question.questionText,
    choices: question.choices.map((choice) => ({
      id: choice.id,
      choiceText: choice.choiceText,
      isCorrect: choice.isCorrect,
    })),
  };
}

function serializeQuestion(question: SeminarQuestionItem): string {
  return JSON.stringify({
    questionText: question.questionText,
    choices: question.choices.map((choice) => ({
      id: choice.id,
      choiceText: choice.choiceText,
      isCorrect: choice.isCorrect,
    })),
  });
}

/* The official module titles carry their own "Module N:" prefix; only
   prepend one for titles that lack it (e.g. fresh drafts), so labels
   never read "Module 1: Module 1: …". */
function moduleLabel(moduleNumber: number, title: string): string {
  const prefix = `Module ${moduleNumber}:`;
  return title.startsWith(prefix) ? title : `${prefix} ${title}`;
}

function ModuleDetail({ moduleNumber }: { moduleNumber: number }) {
  const router = useRouter();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const [moduleData, setModuleData] = useState<ApiSeminarModule | null>(null);
  const [videos, setVideos] = useState<SeminarVideoItem[]>([]);
  const [questions, setQuestions] = useState<SeminarQuestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /* Text drafts save on blur; these hold the in-progress values. */
  const [titleDraft, setTitleDraft] = useState("");
  const [gradeDraft, setGradeDraft] = useState("");
  const [priceDraft, setPriceDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const savedQuestionsRef = useRef<Map<string, string>>(new Map());
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  /* Header pencil: edits just the title without entering exam-edit mode. */
  const [editingTitle, setEditingTitle] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingModule, setDeletingModule] = useState(false);
  const [addingVideo, setAddingVideo] = useState(false);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoDuration, setVideoDuration] = useState("");
  const [videoFileName, setVideoFileName] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  /* Add Question dialog: the question exists only after a valid submit. */
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [questionText, setQuestionText] = useState("");
  const [answers, setAnswers] = useState(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [removingCover, setRemovingCover] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const videoFileInput = useRef<HTMLInputElement>(null);

  const applyDetail = useCallback((detail: ApiSeminarModule) => {
    setModuleData(detail);
    setTitleDraft(detail.title);
    setGradeDraft(String(detail.passingScore));
    setPriceDraft(String(Number(detail.price ?? 0)));
    setDescriptionDraft(detail.description ?? "");
    setVideos(detail.videos.map(toVideoItem));
    const mapped = (detail.questions ?? []).map(toQuestionItem);
    setQuestions(mapped);
    savedQuestionsRef.current = new Map(
      mapped.map((question) => [question.id, serializeQuestion(question)])
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const modules = await listSeminarModules();
      const match = modules.find(
        (entry) => entry.moduleNumber === moduleNumber && !entry.archivedAt
      );
      if (!match) {
        setModuleData(null);
        setLoadError(null);
        return;
      }
      applyDetail(await getSeminarModule(match.id));
      setLoadError(null);
    } catch (error) {
      setLoadError(
        errorMessage(error, "Unable to load this module. Please try again.")
      );
    } finally {
      setLoading(false);
    }
  }, [applyDetail, moduleNumber]);

  useEffect(() => {
    /* The backend is the source of truth now — drop the old mock key. */
    removeStorage(STORAGE_KEYS.modules);
    void load();
  }, [load]);

  /*
   * Bring the just-created question into view and flash it briefly.
   * Instant (non-smooth) scroll: smooth scrolling is animation-frame
   * driven and silently goes nowhere in throttled/background tabs.
   */
  useEffect(() => {
    if (!highlightId) return;
    document
      .getElementById(`question-${highlightId}`)
      ?.scrollIntoView({ block: "center" });
    const timer = setTimeout(() => setHighlightId(null), 2200);
    return () => clearTimeout(timer);
  }, [highlightId]);

  if (loading) {
    return (
      <p className="py-20 text-center text-dacs-muted">Loading module…</p>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <p className="text-dacs-muted">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="rounded-2xl bg-dacs-dark px-6 py-2.5 font-semibold text-white hover:opacity-90"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!moduleData) {
    return (
      <p className="py-20 text-center text-dacs-muted">Module not found.</p>
    );
  }

  const seminarModule = moduleData;
  const moduleId = moduleData.id;

  /* Merge a PATCH response's scalar fields (never carries videos). */
  function mergeModule(row: ApiSeminarModule) {
    setModuleData((current) =>
      current ? { ...current, ...row, videos: current.videos } : current
    );
  }

  /* Local mirror of the server rule: content writes on a published
     module set the pending-changes flag (the server does the same in
     the same transaction as each write). */
  function markPending() {
    setModuleData((current) =>
      current && current.isPublished
        ? { ...current, hasUnpublishedChanges: true }
        : current
    );
  }

  async function saveTitle() {
    const next = titleDraft.trim();
    if (!moduleData) return;
    if (!next || next === moduleData.title) {
      setTitleDraft(moduleData.title);
      return;
    }
    try {
      mergeModule(await updateSeminarModule(moduleId, { title: next }));
    } catch (error) {
      setTitleDraft(moduleData.title);
      showToast(
        errorMessage(error, "Unable to save the title. Please try again."),
        "error"
      );
    }
  }

  async function saveGrade() {
    if (!moduleData) return;
    const next = Number(gradeDraft);
    if (
      gradeDraft.trim() === "" ||
      !Number.isInteger(next) ||
      next < 0 ||
      next > 100
    ) {
      setGradeDraft(String(moduleData.passingScore));
      showToast("Passing grade must be a whole number between 0 and 100.", "error");
      return;
    }
    if (next === moduleData.passingScore) {
      setGradeDraft(String(next));
      return;
    }
    try {
      mergeModule(await updateSeminarModule(moduleId, { passingScore: next }));
    } catch (error) {
      setGradeDraft(String(moduleData.passingScore));
      showToast(
        errorMessage(error, "Unable to save the passing grade. Please try again."),
        "error"
      );
    }
  }

  /*
   * Module Price: 0 = free (no purchase needed), > 0 = the customer page
   * automatically shows Add to Cart and the module stays locked until
   * staff verify the payment on the seminar order. Existing purchases
   * keep their checkout-time price. Saves on blur, like the grade.
   */
  async function savePrice() {
    if (!moduleData) return;
    const currentPrice = Number(moduleData.price ?? 0);
    const next = Number(priceDraft);
    if (
      priceDraft.trim() === "" ||
      !Number.isFinite(next) ||
      next < 0 ||
      Math.round(next * 100) !== next * 100
    ) {
      setPriceDraft(String(currentPrice));
      showToast(
        "Module price must be 0 or a positive amount with at most centavo precision.",
        "error"
      );
      return;
    }
    if (next === currentPrice) {
      setPriceDraft(String(next));
      return;
    }
    try {
      mergeModule(await updateSeminarModule(moduleId, { price: next }));
      appendAudit(
        "Seminars",
        "SEMINAR_MODULE_PRICE_SET",
        `Set Module ${moduleNumber} price to ₱${next}.`
      );
    } catch (error) {
      setPriceDraft(String(currentPrice));
      showToast(
        errorMessage(error, "Unable to save the module price. Please try again."),
        "error"
      );
    }
  }

  async function moveVideo(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= videos.length) return;
    const previous = videos;
    const next = [...videos];
    [next[index], next[target]] = [next[target], next[index]];
    setVideos(next);
    try {
      await reorderSeminarVideos(
        moduleId,
        next.map((video) => video.id)
      );
      markPending();
    } catch (error) {
      setVideos(previous);
      showToast(
        errorMessage(error, "Unable to reorder the videos. Please try again."),
        "error"
      );
    }
  }

  async function removeVideo(videoId: string) {
    const previous = videos;
    setVideos(videos.filter((entry) => entry.id !== videoId));
    try {
      await deleteSeminarVideo(moduleId, videoId);
      markPending();
    } catch (error) {
      setVideos(previous);
      showToast(
        errorMessage(error, "Unable to remove the video. Please try again."),
        "error"
      );
    }
  }

  /*
   * Direct video-file upload: reads the duration from the file's
   * metadata and keeps the file itself for the multipart upload.
   */
  function handleVideoFile(file: File) {
    setVideoFile(file);
    setVideoFileName(file.name);
    if (!videoTitle.trim()) {
      setVideoTitle(file.name.replace(/\.[^.]+$/, ""));
    }
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      const total = Math.round(probe.duration);
      if (Number.isFinite(total) && total > 0) {
        const minutes = Math.floor(total / 60);
        const seconds = total % 60;
        setVideoDuration(
          `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        );
      }
      URL.revokeObjectURL(url);
    };
    probe.onerror = () => URL.revokeObjectURL(url);
    probe.src = url;
  }

  async function addVideo() {
    if (!videoTitle.trim() || !videoFile || uploadingVideo) return;
    setUploadingVideo(true);
    try {
      const uploaded = await uploadSeminarVideo(moduleId, videoFile, {
        title: videoTitle.trim(),
        durationSeconds: parseDuration(videoDuration),
        displayOrder: videos.length + 1,
      });
      setVideos((current) => [...current, toVideoItem(uploaded)]);
      markPending();
      appendAudit(
        "Seminars",
        "SEMINAR_VIDEO_ADDED",
        `Uploaded "${videoFileName}" to Module ${moduleNumber}.`
      );
      setAddingVideo(false);
      setVideoTitle("");
      setVideoDuration("");
      setVideoFileName("");
      setVideoFile(null);
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to upload the video. Please try again."),
        "error"
      );
    } finally {
      setUploadingVideo(false);
    }
  }

  function openAddQuestion() {
    setQuestionText("");
    setAnswers(["", "", "", ""]);
    setCorrectIndex(null);
    setQuestionError(null);
    setSavingQuestion(false);
    setAddingQuestion(true);
  }

  async function submitNewQuestion() {
    if (savingQuestion) return;

    const text = questionText.trim();
    const trimmedAnswers = answers.map((answer) => answer.trim());
    if (!text || trimmedAnswers.some((answer) => !answer)) {
      setQuestionError("Fill in the question and all four answers.");
      return;
    }
    if (correctIndex === null) {
      setQuestionError("Select which answer is correct.");
      return;
    }

    setSavingQuestion(true);
    try {
      const created = await addSeminarQuestion(moduleId, {
        questionText: text,
        displayOrder: questions.length + 1,
        choices: ANSWER_LETTERS.map((letter, index) => ({
          choiceText: trimmedAnswers[index],
          isCorrect: index === correctIndex,
        })),
      });
      const mapped = toQuestionItem(created);
      setQuestions((current) => [...current, mapped]);
      savedQuestionsRef.current.set(mapped.id, serializeQuestion(mapped));
      markPending();
      appendAudit(
        "Seminars",
        "SEMINAR_QUESTION_CREATED",
        `Added a question to Module ${moduleNumber}.`
      );
      setAddingQuestion(false);
      setHighlightId(mapped.id);
      showToast("Question added.");
    } catch (error) {
      setQuestionError(
        errorMessage(error, "Unable to save the question. Please try again.")
      );
    } finally {
      setSavingQuestion(false);
    }
  }

  /* Persist one question (full choice set, IDs preserved server-side). */
  async function persistQuestion(question: SeminarQuestionItem) {
    const serialized = serializeQuestion(question);
    if (savedQuestionsRef.current.get(question.id) === serialized) return;
    try {
      const updated = await updateSeminarQuestion(moduleId, question.id, {
        questionText: question.questionText,
        choices: question.choices.map((choice) => ({
          id: choice.id,
          choiceText: choice.choiceText,
          isCorrect: choice.isCorrect,
        })),
      });
      const mapped = toQuestionItem(updated);
      setQuestions((current) =>
        current.map((entry) => (entry.id === mapped.id ? mapped : entry))
      );
      savedQuestionsRef.current.set(mapped.id, serializeQuestion(mapped));
      markPending();
    } catch (error) {
      /* Restore the last saved version so the screen matches the server. */
      const saved = savedQuestionsRef.current.get(question.id);
      if (saved) {
        const parsed = JSON.parse(saved) as Omit<SeminarQuestionItem, "id">;
        setQuestions((current) =>
          current.map((entry) =>
            entry.id === question.id ? { id: question.id, ...parsed } : entry
          )
        );
      }
      showToast(
        errorMessage(error, "Unable to save the question. Please try again."),
        "error"
      );
    }
  }

  function saveQuestionOnBlur(questionId: string) {
    const question = questions.find((entry) => entry.id === questionId);
    if (question) void persistQuestion(question);
  }

  function setCorrectChoice(questionId: string, choiceId: string) {
    const question = questions.find((entry) => entry.id === questionId);
    if (!question) return;
    const next: SeminarQuestionItem = {
      ...question,
      choices: question.choices.map((choice) => ({
        ...choice,
        isCorrect: choice.id === choiceId,
      })),
    };
    setQuestions((current) =>
      current.map((entry) => (entry.id === questionId ? next : entry))
    );
    void persistQuestion(next);
  }

  async function removeQuestion(questionId: string) {
    const previous = questions;
    setQuestions(questions.filter((entry) => entry.id !== questionId));
    try {
      await deleteSeminarQuestion(moduleId, questionId);
      savedQuestionsRef.current.delete(questionId);
      markPending();
    } catch (error) {
      setQuestions(previous);
      showToast(
        errorMessage(error, "Unable to remove the question. Please try again."),
        "error"
      );
    }
  }

  /* Shown under the module title on the customer seminar page. */
  async function saveDescription() {
    if (!moduleData) return;
    const next = descriptionDraft.trim();
    const current = moduleData.description ?? "";
    if (next === current) {
      setDescriptionDraft(current);
      return;
    }
    if (next.length > 1000) {
      showToast("The description must be at most 1000 characters.", "error");
      return;
    }
    try {
      /* An emptied field clears the description (the backend stores null). */
      mergeModule(await updateSeminarModule(moduleId, { description: next }));
      appendAudit(
        "Seminars",
        "SEMINAR_MODULE_UPDATED",
        `Updated the description of Module ${moduleNumber}.`
      );
    } catch (error) {
      setDescriptionDraft(current);
      showToast(
        errorMessage(error, "Unable to save the description. Please try again."),
        "error"
      );
    }
  }

  /*
   * Cover-image upload for the customer-facing seminar card. The file is
   * validated here for fast feedback and again on the backend (magic
   * bytes + 5 MB multer cap) before it is stored.
   */
  const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const COVER_MAX_BYTES = 5 * 1024 * 1024;

  async function uploadCover(file: File) {
    if (uploadingCover) return;
    if (!COVER_TYPES.includes(file.type)) {
      showToast(
        "Only JPG, PNG, and WebP images can be used as a module cover.",
        "error"
      );
      return;
    }
    if (file.size > COVER_MAX_BYTES) {
      showToast("The cover image must not exceed 5 MB.", "error");
      return;
    }
    setUploadingCover(true);
    try {
      mergeModule(await uploadModuleCoverImage(moduleId, file));
      appendAudit(
        "Seminars",
        "SEMINAR_COVER_IMAGE_UPDATED",
        `Uploaded a cover image for Module ${moduleNumber}.`
      );
      showToast("Cover image updated.");
    } catch (error) {
      showToast(
        errorMessage(
          error,
          "Unable to upload the cover image. Please try again."
        ),
        "error"
      );
    } finally {
      setUploadingCover(false);
    }
  }

  async function removeCover() {
    if (removingCover) return;
    setRemovingCover(true);
    try {
      mergeModule(await removeModuleCoverImage(moduleId));
      appendAudit(
        "Seminars",
        "SEMINAR_COVER_IMAGE_REMOVED",
        `Removed the cover image of Module ${moduleNumber}.`
      );
      showToast("Cover image removed.");
    } catch (error) {
      showToast(
        errorMessage(
          error,
          "Unable to remove the cover image. Please try again."
        ),
        "error"
      );
    } finally {
      setRemovingCover(false);
    }
  }

  async function publishModule() {
    const republish = Boolean(seminarModule.hasUnpublishedChanges);
    try {
      mergeModule(await updateSeminarModule(moduleId, { isPublished: true }));
      appendAudit(
        "Seminars",
        "SEMINAR_MODULE_PUBLISHED",
        republish
          ? `Re-published Module ${moduleNumber} with updated content.`
          : `Published Module ${moduleNumber}.`
      );
      showToast(republish ? "Updated module published." : "Module published.");
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to publish this module. Please try again."),
        "error"
      );
    }
  }

  async function unpublishModule() {
    try {
      mergeModule(await updateSeminarModule(moduleId, { isPublished: false }));
      appendAudit(
        "Seminars",
        "SEMINAR_MODULE_UNPUBLISHED",
        `Unpublished Module ${moduleNumber}.`
      );
      showToast("Module unpublished.");
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to unpublish this module. Please try again."),
        "error"
      );
    }
  }

  async function deleteModule() {
    if (deletingModule) return;
    setDeletingModule(true);
    try {
      const outcome = await deleteSeminarModule(moduleId);
      appendAudit(
        "Seminars",
        outcome.result === "DELETED"
          ? "SEMINAR_MODULE_DELETED"
          : "SEMINAR_MODULE_ARCHIVED",
        `Deleted ${moduleLabel(moduleNumber, seminarModule.title)}.`
      );
      showToast(
        outcome.result === "DELETED"
          ? "Seminar deleted successfully."
          : "Seminar archived — enrolled farmers keep their records."
      );
      router.push("/seminar");
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to delete this seminar. Please try again."),
        "error"
      );
    } finally {
      setDeletingModule(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <>
      {/*
       * Module header bar: back arrow + title on the left, Publish on
       * the right of the same row (it wraps beneath the title on small
       * screens instead of overflowing).
       */}
      <div className="-mx-4 -mt-6 mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 bg-dacs-dark px-4 py-5 text-white sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mt-8 lg:mb-8 lg:gap-x-6 lg:px-10 lg:py-6">
        <Link href="/seminar" aria-label="Back to seminar list">
          <ArrowLeft size={26} />
        </Link>
        {editing || editingTitle ? (
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => {
              void saveTitle();
              setEditingTitle(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            autoFocus={editingTitle}
            aria-label="Module title"
            className="min-w-[180px] flex-1 bg-transparent text-lg font-bold outline-none placeholder:text-white/50 sm:text-2xl"
            placeholder="Module Title"
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="min-w-0 break-words text-lg font-bold sm:text-2xl">
              {seminarModule.title}
            </h1>
            <button
              type="button"
              aria-label="Edit module title"
              title="Edit title"
              onClick={() => {
                setTitleDraft(seminarModule.title);
                setEditingTitle(true);
              }}
              className="shrink-0 rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <Pencil size={18} />
            </button>
          </div>
        )}
        {/*
         * Publish state has three faces: published-and-current (green ✓,
         * Unpublish), published-but-edited (amber "Unpublished changes",
         * Publish primary + Unpublish secondary), and unpublished
         * (Publish only).
         */}
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-3">
          {seminarModule.isPublished &&
            (seminarModule.hasUnpublishedChanges ? (
              <span className="text-sm font-semibold text-amber-300">
                Published • Unpublished changes
              </span>
            ) : (
              <span className="text-sm font-semibold text-green-400">
                Published ✓
              </span>
            ))}
          {(!seminarModule.isPublished ||
            seminarModule.hasUnpublishedChanges) && (
            <button
              type="button"
              onClick={() => void publishModule()}
              className="rounded-2xl bg-white px-6 py-2.5 font-semibold text-dacs-dark hover:opacity-90"
            >
              Publish
            </button>
          )}
          {seminarModule.isPublished && (
            <button
              type="button"
              onClick={() => void unpublishModule()}
              className={
                seminarModule.hasUnpublishedChanges
                  ? "rounded-2xl border border-white/50 px-6 py-2.5 font-semibold text-white hover:bg-white/10"
                  : "rounded-2xl bg-white px-6 py-2.5 font-semibold text-dacs-dark hover:opacity-90"
              }
            >
              Unpublish
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
        <div>
          {/* Videos */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold">Uploaded Videos</h2>
            <button
              type="button"
              onClick={() => setAddingVideo(true)}
              className="flex items-center gap-2 rounded-2xl bg-dacs-dark px-6 py-3 font-semibold text-white hover:opacity-90"
            >
              <Plus size={16} />
              Add Video
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {videos.map((video, index) => (
              <div
                key={video.id}
                className="flex items-center gap-4 rounded-dacs-card bg-white p-4 shadow-dacs-card"
              >
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label="Move video up"
                    onClick={() => void moveVideo(index, -1)}
                    className="p-1 text-dacs-muted hover:text-dacs-dark"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Move video down"
                    onClick={() => void moveVideo(index, 1)}
                    className="p-1 text-dacs-muted hover:text-dacs-dark"
                  >
                    <ArrowDown size={16} />
                  </button>
                </div>
                <PlayCircle size={38} className="text-dacs-red" />
                <div className="flex-1">
                  <p className="font-semibold">{video.title}</p>
                  <p className="text-sm text-dacs-muted">
                    {video.duration}
                    {video.fileName ? ` · ${video.fileName}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Remove video"
                  onClick={() => void removeVideo(video.id)}
                  className="text-dacs-muted hover:text-dacs-red"
                >
                  <Trash2 size={18} />
                </button>
                <span className="text-dacs-muted">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
            ))}
            {videos.length === 0 && (
              <p className="rounded-dacs-card border border-dashed border-dacs-dark/30 py-10 text-center text-dacs-muted">
                No videos yet — click “Add Video”.
              </p>
            )}
          </div>

          {/* Exam questions */}
          <div className="mb-4 mt-10 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold">Exam Questions</h2>
            <div className="flex items-center gap-3">
              {editing && (
                <button
                  type="button"
                  onClick={openAddQuestion}
                  className="flex items-center gap-2 rounded-2xl border border-dacs-red px-5 py-2.5 font-semibold text-dacs-red hover:bg-red-50"
                >
                  <Plus size={16} />
                  Add Question
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (editing) {
                    appendAudit(
                      "Seminars",
                      "SEMINAR_MODULE_UPDATED",
                      `Saved exam changes for Module ${moduleNumber}.`
                    );
                  }
                  setEditing(!editing);
                }}
                className="flex items-center gap-2 rounded-2xl bg-dacs-dark px-6 py-3 font-semibold text-white hover:opacity-90"
              >
                {editing ? (
                  <>
                    <Check size={16} />
                    Done
                  </>
                ) : (
                  "Edit Exam"
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {questions.map((question, index) => (
              <div
                key={question.id}
                id={`question-${question.id}`}
                className={`rounded-dacs-card p-5 shadow-dacs-card transition-all duration-500 ${
                  highlightId === question.id
                    ? "bg-red-50 ring-2 ring-dacs-red"
                    : "bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  {editing ? (
                    <div className="flex flex-1 items-center gap-2 rounded-lg border border-dacs-light px-3 py-2">
                      <span className="font-bold">{index + 1}.</span>
                      <input
                        value={question.questionText}
                        onChange={(event) =>
                          setQuestions((current) =>
                            current.map((entry) =>
                              entry.id === question.id
                                ? { ...entry, questionText: event.target.value }
                                : entry
                            )
                          )
                        }
                        onBlur={() => saveQuestionOnBlur(question.id)}
                        aria-label={`Question ${index + 1} text`}
                        className="w-full font-bold outline-none"
                      />
                    </div>
                  ) : (
                    <p className="font-bold">
                      {index + 1}. {question.questionText}
                    </p>
                  )}
                  {editing && (
                    <button
                      type="button"
                      aria-label="Delete question"
                      onClick={() => void removeQuestion(question.id)}
                      className="text-dacs-muted hover:text-dacs-red"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  {question.choices.map((choice) => (
                    <label
                      key={choice.id}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                        choice.isCorrect
                          ? "border-green-300 bg-green-50"
                          : "border-dacs-light"
                      } ${editing ? "cursor-pointer" : ""}`}
                    >
                      <input
                        type="radio"
                        name={question.id}
                        checked={choice.isCorrect}
                        disabled={!editing}
                        onChange={() => setCorrectChoice(question.id, choice.id)}
                      />
                      {editing ? (
                        <input
                          value={choice.choiceText}
                          onChange={(event) =>
                            setQuestions((current) =>
                              current.map((entry) =>
                                entry.id === question.id
                                  ? {
                                      ...entry,
                                      choices: entry.choices.map((c) =>
                                        c.id === choice.id
                                          ? { ...c, choiceText: event.target.value }
                                          : c
                                      ),
                                    }
                                  : entry
                              )
                            )
                          }
                          onBlur={() => saveQuestionOnBlur(question.id)}
                          aria-label="Answer text"
                          className="flex-1 bg-transparent outline-none"
                        />
                      ) : (
                        <span>{choice.choiceText}</span>
                      )}
                      {choice.isCorrect && (
                        <span className="text-sm font-medium text-green-700">
                          (Correct)
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Customer-card content (cover image + description) + passing grade */}
        <aside>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-bold">Module Cover Image</h2>
            <button
              type="button"
              disabled={uploadingCover}
              onClick={() => coverInput.current?.click()}
              className="flex items-center gap-2 rounded-2xl bg-dacs-dark px-6 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              <Upload size={16} />
              {uploadingCover
                ? "Uploading…"
                : seminarModule.coverImageUrl
                  ? "Replace"
                  : "Upload Image"}
            </button>
            <input
              ref={coverInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadCover(file);
                event.target.value = "";
              }}
            />
          </div>

          <div className="rounded-dacs-card bg-white p-5 shadow-dacs-card">
            {seminarModule.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={seminarModule.coverImageUrl}
                alt={`Module ${moduleNumber} cover`}
                className="aspect-[4/3] w-full rounded-lg border border-dacs-light object-cover"
              />
            ) : (
              <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-dacs-dark/30 text-center text-dacs-muted">
                <ImageIcon size={32} />
                <p className="px-6 text-sm">
                  No cover image yet — upload a JPG, PNG, or WebP (max 5 MB).
                </p>
              </div>
            )}
            <p className="mt-3 text-sm text-dacs-muted">
              Shown on this module&apos;s card on the customer seminar page.
            </p>
            {seminarModule.coverImageUrl && (
              <button
                type="button"
                disabled={removingCover}
                onClick={() => void removeCover()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dacs-red py-3 font-semibold text-dacs-red hover:bg-red-50 disabled:opacity-60"
              >
                <Trash2 size={16} />
                {removingCover ? "Removing…" : "Remove Image"}
              </button>
            )}
          </div>

          {/* Customer-facing module description (saves when leaving the field). */}
          <div className="mt-8 rounded-dacs-card bg-white p-5 shadow-dacs-card">
            <h2 className="text-xl font-bold">Module Description</h2>
            <textarea
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              onBlur={() => void saveDescription()}
              maxLength={1000}
              rows={6}
              aria-label="Module description"
              placeholder="Describe what farmers will learn in this module…"
              className="mt-3 w-full resize-y rounded-lg border border-dacs-light px-3 py-2 text-sm leading-relaxed outline-none focus:border-dacs-dark"
            />
            <div className="mt-1 flex items-center justify-between gap-3 text-xs text-dacs-muted">
              <span>Shown under the module title on the customer seminar page.</span>
              <span>{descriptionDraft.length}/1000</span>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between rounded-dacs-card bg-white p-5 shadow-dacs-card">
            <h2 className="text-xl font-bold">Passing Grade</h2>
            <div className="flex items-center gap-1 text-lg">
              =
              <input
                type="number"
                min={0}
                max={100}
                value={gradeDraft}
                onChange={(event) => setGradeDraft(event.target.value)}
                onBlur={() => void saveGrade()}
                aria-label="Passing grade percentage"
                className="w-16 rounded-lg border border-dacs-light px-2 py-1 text-center font-semibold focus:border-dacs-dark"
              />
              %
            </div>
          </div>

          {/* Module access price. 0 = Free; any amount > 0 makes the
              customer page require Add to Cart -> checkout -> payment
              verification before the module unlocks (future modules
              inherit this automatically — no code changes needed). */}
          <div className="mt-8 rounded-dacs-card bg-white p-5 shadow-dacs-card">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Module Price</h2>
              <div className="flex items-center gap-1 text-lg">
                ₱
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={priceDraft}
                  onChange={(event) => setPriceDraft(event.target.value)}
                  onBlur={() => void savePrice()}
                  aria-label="Module price in pesos"
                  className="w-28 rounded-lg border border-dacs-light px-2 py-1 text-center font-semibold focus:border-dacs-dark"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-dacs-muted">
              {Number(moduleData.price ?? 0) > 0
                ? "Paid module: customers buy it through the normal cart and checkout; it unlocks once the seminar order's payment is verified. Customers who already purchased keep their original price."
                : "Free module: customers can take it without purchasing (the previous-module requirement still applies)."}
            </p>
          </div>

          {/* Destructive module delete, beneath the Passing Grade setting. */}
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl border border-dacs-red py-3 font-semibold text-dacs-red hover:bg-red-50"
          >
            <Trash2 size={16} />
            Delete Module
          </button>
        </aside>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          message="Delete Seminar?"
          detail={`Are you sure you want to delete "${seminarModule.title}"? Modules with enrolled farmers are archived so their records are kept.`}
          confirmLabel={deletingModule ? "Deleting…" : "Delete"}
          destructive
          onConfirm={() => void deleteModule()}
          onCancel={() => {
            if (!deletingModule) setConfirmingDelete(false);
          }}
        />
      )}

      {/* Add Question dialog: nothing is saved until a valid submit. */}
      {addingQuestion && (
        <Modal onClose={() => setAddingQuestion(false)} width="max-w-[560px]">
          <h2 className="mb-6 text-2xl font-bold">Add Question</h2>
          <div className="flex flex-col gap-4">
            <label className="block">
              <span className="text-sm font-semibold">Question</span>
              <input
                value={questionText}
                onChange={(event) => setQuestionText(event.target.value)}
                placeholder="Enter question text..."
                className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-dacs-dark ${
                  questionError && !questionText.trim()
                    ? "border-dacs-red"
                    : "border-dacs-dark/30"
                }`}
              />
            </label>
            {ANSWER_LETTERS.map((letter, index) => (
              <label key={letter} className="block">
                <span className="text-sm font-semibold">Answer {letter}</span>
                <input
                  value={answers[index]}
                  onChange={(event) =>
                    setAnswers((current) =>
                      current.map((answer, i) =>
                        i === index ? event.target.value : answer
                      )
                    )
                  }
                  placeholder={`Answer ${letter}`}
                  className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-dacs-dark ${
                    questionError && !answers[index].trim()
                      ? "border-dacs-red"
                      : "border-dacs-dark/30"
                  }`}
                />
              </label>
            ))}
            <label className="block">
              <span className="text-sm font-semibold">Correct Answer</span>
              <select
                value={correctIndex ?? ""}
                onChange={(event) =>
                  setCorrectIndex(
                    event.target.value === "" ? null : Number(event.target.value)
                  )
                }
                className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 outline-none focus:border-dacs-dark ${
                  questionError && correctIndex === null
                    ? "border-dacs-red"
                    : "border-dacs-dark/30"
                }`}
              >
                <option value="">Select answer</option>
                {ANSWER_LETTERS.map((letter, index) => (
                  <option key={letter} value={index}>
                    Answer {letter}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {questionError && (
            <p className="mt-4 text-sm font-medium text-dacs-red">
              {questionError}
            </p>
          )}
          <div className="mt-8 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setAddingQuestion(false)}
              className="rounded-2xl border border-dacs-dark/40 px-8 py-3 font-semibold hover:bg-dacs-light/50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitNewQuestion()}
              disabled={savingQuestion}
              className="rounded-2xl bg-dacs-dark px-8 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {savingQuestion ? "Saving..." : "Add Question"}
            </button>
          </div>
        </Modal>
      )}

      {/* Add Video dialog */}
      {addingVideo && (
        <Modal onClose={() => setAddingVideo(false)} width="max-w-[520px]">
          <h2 className="mb-6 text-2xl font-bold">Add Video</h2>
          <div className="flex flex-col gap-4">
            <label className="block">
              <span className="text-sm font-semibold">Title</span>
              <input
                value={videoTitle}
                onChange={(event) => setVideoTitle(event.target.value)}
                placeholder={`Video #${videos.length + 1}`}
                className="mt-1 w-full rounded-lg border border-dacs-dark/30 px-3 py-2 outline-none focus:border-dacs-dark"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Duration</span>
              <input
                value={videoDuration}
                onChange={(event) => setVideoDuration(event.target.value)}
                placeholder="12:30"
                className="mt-1 w-full rounded-lg border border-dacs-dark/30 px-3 py-2 outline-none focus:border-dacs-dark"
              />
            </label>
            <div>
              <span className="text-sm font-semibold">Video File</span>
              <button
                type="button"
                onClick={() => videoFileInput.current?.click()}
                className="mt-1 flex w-full items-center gap-3 rounded-lg border border-dashed border-dacs-dark/40 px-3 py-3 text-left text-sm hover:bg-dacs-light/40"
              >
                <Upload size={16} className="shrink-0 text-dacs-dark" />
                {videoFileName ? (
                  <span className="truncate font-medium">{videoFileName}</span>
                ) : (
                  <span className="italic text-dacs-muted">
                    Click to upload a video file (MP4, WebM...)
                  </span>
                )}
              </button>
              <input
                ref={videoFileInput}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleVideoFile(file);
                  event.target.value = "";
                }}
              />
            </div>
          </div>
          <div className="mt-8 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => void addVideo()}
              disabled={!videoTitle.trim() || !videoFile || uploadingVideo}
              className="rounded-2xl bg-dacs-dark px-8 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {uploadingVideo ? "Uploading…" : "Add Video"}
            </button>
            <button
              type="button"
              onClick={() => setAddingVideo(false)}
              className="rounded-2xl border border-dacs-dark/40 px-8 py-3 font-semibold hover:bg-dacs-light/50"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function SeminarModulePage({
  params,
}: {
  params: Promise<{ n: string }>;
}) {
  const { n } = use(params);
  return (
    <Suspense>
      <ModuleDetail moduleNumber={Number(n)} />
    </Suspense>
  );
}
