"use client";

import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Footer } from "@/components/layout/Footer";
import { SeminarCard } from "@/components/seminars/SeminarCard";
import { useCart } from "@/components/providers/CartProvider";
import { ROUTES } from "@/constants/routes";
import { errorMessage } from "@/lib/api";
import { listSeminarModules, type ApiMyProgress, type ApiSeminarModule } from "@/lib/api/seminars";
import {
  canAccessView,
  certificateAvailableOn,
  seminarRegistrationHref,
  buildSeminarState,
  fetchSeminarProgress,
  lockReasonFor,
  nextModuleAfter,
  setActiveSeminarId,
  type SeminarView,
} from "@/services/seminar.service";

// Figma: Seminars Page — default (203:35) and registered (252:254) states,
// rendered at 0.75 scale in a 1440px container. The registered state adds the
// "Registered" badge + "Take Now" button on the seminar the farmer registered
// for. Access rules add per-card Completed/Locked states and a dismissible
// banner when a route guard bounced the farmer back here with
// ?locked=<module-id>: a module opens once every module before it is
// complete AND — for paid modules — its purchase has been verified by DACS
// staff (Add to Cart -> checkout -> staff approval, all through the normal
// DACS ordering workflow). Every published module renders — newly published
// modules from the admin appear automatically, paid or free.

export default function SeminarsPage() {
  const router = useRouter();
  const { addSeminarItem, hasItem } = useCart();
  const [modules, setModules] = useState<ApiSeminarModule[] | null>(null);
  // undefined means access is unknown. A successful 404 for a missing profile
  // uses the same first-time customer rules as the quiz and module pages.
  const [progress, setProgress] = useState<ApiMyProgress | null>();
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [progressError, setProgressError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [lockedNotice, setLockedNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { views: seminars, completion } = useMemo(
    () => buildSeminarState(modules ?? [], progress ?? null),
    [modules, progress]
  );
  const accessKnown = progress !== undefined && !progressError && !catalogError;

  useEffect(() => {
    let active = true;
    let busy = false;
    let lastRefresh = 0;
    let lockedId = new URLSearchParams(window.location.search).get("locked");
    if (lockedId) router.replace(ROUTES.seminars, { scroll: false });

    async function load() {
      if (busy) return;
      busy = true;
      const [catalog, account] = await Promise.allSettled([
        listSeminarModules().then((result) => {
          if (active) {
            setModules(result);
            setCatalogError(null);
          }
          return result;
        }).catch((error: unknown) => {
          if (active) setCatalogError(errorMessage(error, "Unable to load the seminar catalog."));
          throw error;
        }),
        fetchSeminarProgress().then((result) => {
          if (active) {
            setProgress(result);
            setProgressError(false);
          }
          return result;
        }).catch((error: unknown) => {
          if (active) setProgressError(true);
          throw error;
        }),
      ]);
      if (!active) return;
      busy = false;
      lastRefresh = Date.now();
      if (lockedId && catalog.status === "fulfilled" && account.status === "fulfilled") {
        const views = buildSeminarState(catalog.value, account.value).views;
        const bounced = views.find((view) => view.id === lockedId);
        const reason = bounced && lockReasonFor(bounced);
        if (bounced && reason) setLockedNotice(`Module ${bounced.moduleNumber} is locked. ${reason}`);
        lockedId = null;
      }
    }

    function refresh() {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh >= 1000) void load();
    }
    void load();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, attempt]);

  const visibleSeminars = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return seminars;
    return seminars.filter((s) => s.title.toLowerCase().includes(term));
  }, [seminars, query]);

  function openModuleFlow(seminar: SeminarView) {
    setActiveSeminarId(seminar.id);
    if (!seminar.registered) {
      router.push(seminarRegistrationHref(seminar));
      return;
    }
    router.push(seminar.videos.length === 0 ? "/seminars/exam" : "/seminars/modules/1");
  }

  /**
   * The card's action. A completed module either ENDS the required
   * sequence — and opens the one Certificate of Attendance — or points at
   * the next module. Finishing Module 1 or 2 never opens a certificate.
   */
  function handleTake(seminar: SeminarView, completed: boolean) {
    if (!completed) {
      openModuleFlow(seminar);
      return;
    }

    if (completion && certificateAvailableOn(seminar, completion)) {
      setActiveSeminarId(seminar.id);
      router.push("/seminars/certificate");
      return;
    }

    // Go to Next Module — locked ones explain themselves rather than
    // dead-ending the farmer on a guarded route.
    const next = nextModuleAfter(seminars, seminar);
    if (!next) {
      setActiveSeminarId(seminar.id);
      router.push("/seminars/certificate");
      return;
    }
    if (!canAccessView(next)) {
      const reason = lockReasonFor(next);
      setLockedNotice(
        `Module ${next.moduleNumber} is locked.${reason ? ` ${reason}` : ""}`
      );
      return;
    }
    openModuleFlow(next);
  }

  /** Add to Cart for a paid module — the ordinary DACS cart, quantity 1. */
  function handleAddToCart(seminar: SeminarView) {
    addSeminarItem({
      moduleId: seminar.moduleId,
      title: seminar.title,
      price: seminar.price,
      imageUrl: seminar.imageUrl,
    });
  }

  return (
    <div className="bg-white">
      {/* Hero (full-bleed) */}
      <section className="relative h-[300px] w-full lg:h-[306px]">
        <Image
          src="/images/seminars-1.jpg"
          alt="Farmers feeding free-range chickens"
          fill
          className="object-cover"
          priority
        />
      </section>

      {/* Locked-module notice (set by the module/exam route guards) */}
      {lockedNotice && (
        <section className="mx-auto mt-[24px] max-w-[1440px] px-[20px] lg:px-[65px]">
          <div
            role="alert"
            className="flex items-center justify-between gap-[16px] rounded-[15px] border border-[#c00] bg-[#fdecec] px-[20px] py-[16px]"
          >
            <p className="text-[15px] font-semibold leading-normal text-[#c00]">
              {lockedNotice}
            </p>
            <button
              type="button"
              onClick={() => setLockedNotice(null)}
              aria-label="Dismiss notice"
              className="shrink-0 cursor-pointer text-[#c00]"
            >
              <X className="size-[18px]" />
            </button>
          </div>
        </section>
      )}

      {/* Heading + search + register */}
      <section className="mx-auto mt-[40px] flex max-w-[1440px] flex-col gap-[24px] px-[20px] lg:mt-[38px] lg:flex-row lg:items-start lg:gap-0 lg:pl-[87px] lg:pr-[42px]">
        <div className="lg:w-[278px] lg:shrink-0">
          <p className="text-[18px] font-semibold leading-normal text-[#c00]">
            Education
          </p>
          <h1 className="mt-[7px] text-[26px] font-semibold leading-normal text-black lg:text-[30px]">
            Seminar Modules
          </h1>
        </div>
        <div className="relative w-full lg:mt-[27px] lg:w-[792px] lg:shrink">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search seminar modules"
            className="h-[37px] w-full rounded-[11px] border border-[#181818] bg-white pl-[15px] pr-[42px] text-[15px] leading-normal text-black outline-none"
          />
          <img
            src="/figma/icon-search.svg"
            alt=""
            className="pointer-events-none absolute right-[18px] top-1/2 h-[14px] w-[13px] -translate-y-1/2"
          />
        </div>
        <Link
          href={ROUTES.seminarRegistration}
          className="flex h-[64px] w-[216px] shrink-0 items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:ml-[26px] lg:mt-[6px]"
        >
          <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
            Register
          </span>
        </Link>
      </section>

      {/* Seminar cards */}
      <section className="mx-auto mt-[60px] flex max-w-[1440px] flex-col gap-[40px] px-[20px] lg:mt-[71px] lg:gap-[44px] lg:px-[65px]">
        {(catalogError || (progressError && !!modules?.length)) && (
          <div role="alert" className="text-center">
            <p>{catalogError ?? "We couldn’t load your seminar progress. Try again to see which modules you can take."}</p>
            <button type="button" className="mt-2 font-semibold underline" onClick={() => {
              setCatalogError(null);
              setAttempt((current) => current + 1);
            }}>
              Try again
            </button>
          </div>
        )}
        {visibleSeminars.map((seminar) => {
          const registered = accessKnown && seminar.registered;
          const completed = accessKnown && seminar.status === "Completed";
          const locked = accessKnown && !completed && !canAccessView(seminar);
          return (
            <SeminarCard
              key={seminar.id}
              seminar={seminar}
              durationLabel={seminar.durationLabel}
              speaker={seminar.speaker}
              accessKnown={accessKnown}
              registered={registered}
              completed={completed}
              locked={locked}
              lockMessage={locked ? lockReasonFor(seminar) : undefined}
              completedAction={
                !completed || !completion
                  ? null
                  : certificateAvailableOn(seminar, completion)
                    ? "certificate"
                    : nextModuleAfter(seminars, seminar)
                      ? "next-module"
                      : null
              }
              detailsHref={
                registered || completed ? "/seminars/modules/1" : seminarRegistrationHref(seminar)
              }
              onTake={() => handleTake(seminar, completed)}
              onAddToCart={() => handleAddToCart(seminar)}
              inCart={hasItem(seminar.moduleId)}
            />
          );
        })}
        {modules === null && !catalogError && (
          <p className="text-center text-[18px] leading-normal text-[#7d7d7d]">
            Loading seminar modules...
          </p>
        )}
        {modules !== null && !catalogError && visibleSeminars.length === 0 && (
          <p className="text-center text-[18px] leading-normal text-[#7d7d7d]">
            {modules.length ? "No seminar modules match your search." : "No seminar modules are currently published."}
          </p>
        )}
      </section>

      <div className="h-[60px] lg:h-[69px]" />
      <Footer />
    </div>
  );
}
