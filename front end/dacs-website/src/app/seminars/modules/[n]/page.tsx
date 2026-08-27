"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SeminarPageHeader } from "@/components/seminars/SeminarPageHeader";
import { ROUTES } from "@/constants/routes";
import { reportVideoProgress } from "@/lib/api/seminars";
import {
  canAccessView,
  fetchSeminarViews,
  pickActiveView,
  type SeminarView,
} from "@/services/seminar.service";

// Figma: Module Seminar Video pages — Video #1 (262:2), Video #2 (290:542),
// Video #3 (290:579) — rendered at 0.75 scale in a 1440px container:
// sidebar 400x372 -> 300x279, player 1125x592 -> 844x444, description
// 24 -> 18, buttons 288x85 -> 216x64. The Next Video button (290:538 /
// 290:616) unlocks once the current video finishes; the last video shows
// Take Exam (290:621).
//
// Route guard (mount effect — progress comes from the DACS backend): the
// ACTIVE seminar must be accessible (strict module sequence AND — for
// paid modules — a staff-verified purchase) AND enrolled, and video n
// requires videos 1..n-1 watched; direct URLs to anything further are
// redirected back. The backend enforces the same access rule on the
// progress/quiz APIs and strips locked modules' video URLs, so a URL
// typed by hand can never bypass the lock. Watch progress is reported to
// PATCH /api/seminars/videos/:videoId/progress (monotonic; 100 marks the
// video complete server-side).

/** Highest video number the farmer may open (first unwatched, else the last). */
function highestAllowedVideo(watched: boolean[]): number {
  const firstUnwatched = watched.findIndex((done) => !done);
  return firstUnwatched === -1 ? watched.length : firstUnwatched + 1;
}

const MILESTONES = [25, 50, 75] as const;

export default function ModuleSeminarVideoPage() {
  const params = useParams<{ n: string }>();
  const router = useRouter();

  const parsed = Number(params?.n);
  const requestedNumber = Number.isFinite(parsed)
    ? Math.max(1, Math.trunc(parsed))
    : 1;

  // null until the guard passes — the page renders nothing while checking.
  const [seminar, setSeminar] = useState<SeminarView | null>(null);
  // Watched flags for THIS session (seeded from the backend, flipped as
  // videos finish); index-aligned with seminar.videos.
  const [watched, setWatched] = useState<boolean[]>([]);
  const reportedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const views = await fetchSeminarViews();
        if (cancelled) return;
        const active = pickActiveView(views);
        if (!active) {
          router.replace(ROUTES.seminars);
          return;
        }
        if (!canAccessView(active)) {
          router.replace(`${ROUTES.seminars}?locked=${active.id}`);
          return;
        }
        if (!active.started) {
          router.replace(ROUTES.seminars);
          return;
        }
        if (active.videos.length === 0) {
          // Exam-only module (no videos yet) — its flow starts at the exam.
          router.replace("/seminars/exam");
          return;
        }
        const flags = active.videos.map((video) => video.watched);
        const allowed = highestAllowedVideo(flags);
        if (requestedNumber > Math.min(allowed, active.videos.length)) {
          router.replace(
            `/seminars/modules/${Math.min(allowed, active.videos.length)}`
          );
          return;
        }
        setWatched(flags);
        setSeminar(active);
      } catch {
        router.replace(ROUTES.seminars);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, requestedNumber]);

  if (!seminar) return null;

  const videos = seminar.videos;
  const videoNumber = Math.min(requestedNumber, videos.length);
  const currentVideo = videos[videoNumber - 1];
  const watchedCount = watched.filter(Boolean).length;
  const isLastVideo = videoNumber === videos.length;
  const unlocked = watched[videoNumber - 1] ?? false;

  // Guard for in-page sidebar navigation to a not-yet-allowed video.
  if (videoNumber > highestAllowedVideo(watched)) {
    return null;
  }

  /** Reports partial progress once per milestone per video (best-effort). */
  function handleTimeUpdate(event: React.SyntheticEvent<HTMLVideoElement>) {
    const element = event.currentTarget;
    if (!element.duration || !currentVideo) return;
    const percent = (element.currentTime / element.duration) * 100;
    for (const milestone of MILESTONES) {
      const key = `${currentVideo.id}:${milestone}`;
      if (percent >= milestone && !reportedRef.current.has(key)) {
        reportedRef.current.add(key);
        reportVideoProgress(currentVideo.id, milestone).catch(() => {
          reportedRef.current.delete(key);
        });
      }
    }
  }

  function handleEnded() {
    if (!currentVideo) return;
    const key = `${currentVideo.id}:100`;
    if (!reportedRef.current.has(key)) {
      reportedRef.current.add(key);
      reportVideoProgress(currentVideo.id, 100).catch(() => {
        reportedRef.current.delete(key);
      });
    }
    setWatched((current) =>
      current.map((done, index) => (index === videoNumber - 1 ? true : done))
    );
  }

  function handleNext() {
    if (!unlocked) return;
    if (isLastVideo) {
      router.push("/seminars/exam");
    } else {
      router.push(`/seminars/modules/${videoNumber + 1}`);
    }
  }

  return (
    <div className="bg-white">
      <SeminarPageHeader
        title={seminar.title}
        activeStep={1}
        backHref={ROUTES.seminars}
      />

      <div className="mx-auto mt-[24px] flex max-w-[1440px] flex-col gap-[40px] px-[20px] pb-[60px] lg:mt-[8px] lg:flex-row lg:gap-[68px] lg:pl-[137px] lg:pr-[90px]">
        {/* Video lessons sidebar */}
        <aside className="w-full shrink-0 overflow-clip rounded-[15px] bg-white pb-[34px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:mt-[35px] lg:min-h-[279px] lg:w-[300px] lg:pb-[20px]">
          <p className="pl-[34px] pt-[37px] text-[18px] font-medium leading-normal text-[#7d7d7d]">
            Video Lessons
          </p>
          <p className="mt-[11px] pl-[34px] text-[15px] leading-normal text-[#7d7d7d]">
            {watchedCount}/{videos.length} Completed
          </p>
          <div className="mt-[20px]">
            {videos.map((video) => {
              const active = video.number === videoNumber;
              return (
                <Link
                  key={video.id}
                  href={`/seminars/modules/${video.number}`}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-[49px] items-center pl-[34px] ${
                    active ? "bg-[#c00]" : ""
                  }`}
                >
                  <span
                    className={`truncate pr-[16px] text-[18px] leading-normal ${
                      active ? "font-bold text-white" : "text-black"
                    }`}
                  >
                    {video.title}
                  </span>
                </Link>
              );
            })}
          </div>
        </aside>

        {/* Player + description */}
        <div className="min-w-0 flex-1 lg:max-w-[845px]">
          <div className="h-[240px] w-full bg-black sm:h-[400px] lg:h-[444px] lg:w-[844px]">
            <video
              key={currentVideo.videoUrl}
              src={currentVideo.videoUrl}
              controls
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
              className="size-full object-cover"
            />
          </div>
          <p className="mt-[32px] text-[16px] leading-normal text-black lg:mt-[42px] lg:text-[18px]">
            {currentVideo.description}
          </p>
          <div className="mt-[30px] flex justify-end">
            {isLastVideo ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={!unlocked}
                className={`flex h-[64px] w-[216px] items-center justify-center rounded-[15px] border border-[#c00] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] ${
                  unlocked ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                }`}
              >
                <span className="text-[18px] font-bold leading-normal text-[#c00]">
                  Take Exam
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                disabled={!unlocked}
                className={`flex h-[64px] w-[216px] items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] ${
                  unlocked ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                }`}
              >
                <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
                  Next Video
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
