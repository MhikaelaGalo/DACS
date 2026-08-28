"use client";

import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Footer } from "@/components/layout/Footer";
import { SeminarCard } from "@/components/seminars/SeminarCard";
import { useCart } from "@/components/providers/CartProvider";
import { ROUTES } from "@/constants/routes";
import { errorMessage } from "@/lib/api";
import {
  canAccessView,
  certificateAvailableOn,
  ensureStarted,
  fetchSeminarState,
  lockReasonFor,
  nextModuleAfter,
  setActiveSeminarId,
  type SeminarCompletion,
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
  const [seminars, setSeminars] = useState<SeminarView[]>([]);
  // The account's seminar cycle from the backend — whether Modules 1-3
  // are finished and still inside their 2-year validity.
  const [completion, setCompletion] = useState<SeminarCompletion | null>(null);
  const [loading, setLoading] = useState(true);
  const [lockedNotice, setLockedNotice] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Shared by the initial load and the focus refresh so the same
  // catalog+progress pair is never fetched twice at once.
  const refreshingRef = useRef(false);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    // window.location is read in the effect instead of useSearchParams so the
    // statically prerendered page needs no Suspense boundary; the query is
    // cleaned afterwards so the banner never reappears on refresh.
    const params = new URLSearchParams(window.location.search);
    const lockedParam = params.get("locked");
    if (lockedParam && /^module-\d+$/.test(lockedParam)) {
      router.replace(ROUTES.seminars, { scroll: false });
    }

    let cancelled = false;
    // Shares the in-flight/cooldown refs with the focus refresh below, so
    // the focus event the browser fires right after load cannot repeat
    // this same catalog+progress pair.
    refreshingRef.current = true;
    fetchSeminarState()
      .then(({ views, completion: cycle }) => {
        if (cancelled) return;
        setSeminars(views);
        setCompletion(cycle);
        setLoading(false);
        // The banner explains exactly why the bounced module is locked
        // (previous module, purchase, or pending payment).
        const bounced = views.find((view) => view.id === lockedParam);
        const reason = bounced && lockReasonFor(bounced);
        if (bounced && reason) {
          setLockedNotice(`Module ${bounced.moduleNumber} is locked. ${reason}`);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      })
      .finally(() => {
        refreshingRef.current = false;
        lastRefreshRef.current = Date.now();
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  /* Refetch when the tab regains focus so a staff approval (payment
     verified) unlocks the module without any manual workaround.
     Returning to a tab fires visibilitychange AND focus, which used to
     run the whole catalog+progress refetch twice back to back; one
     in-flight guard plus a short cooldown keeps the refresh (the point
     of this effect) while dropping the duplicate. */
  useEffect(() => {
    function refresh() {
      if (document.visibilityState !== "visible") return;
      if (refreshingRef.current) return;
      if (Date.now() - lastRefreshRef.current < 1000) return;
      refreshingRef.current = true;
      fetchSeminarState()
        .then(({ views, completion: cycle }) => {
          setSeminars(views);
          setCompletion(cycle);
        })
        .catch(() => {
          /* keep the last good views */
        })
        .finally(() => {
          refreshingRef.current = false;
          lastRefreshRef.current = Date.now();
        });
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const visibleSeminars = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return seminars;
    return seminars.filter((s) => s.title.toLowerCase().includes(term));
  }, [seminars, query]);

  /** Opens a module's own flow: its videos, or its exam when it has none.
   *  Free/purchased modules the farmer never formally registered for are
   *  enrolled (idempotently) on entry. */
  async function openModuleFlow(seminar: SeminarView) {
    setServiceError(null);
    try {
      await ensureStarted(seminar);
    } catch (error) {
      setServiceError(
        errorMessage(error, "Unable to open this module right now.")
      );
      return;
    }
    setActiveSeminarId(seminar.id);
    router.push(
      seminar.videos.length === 0 ? "/seminars/exam" : "/seminars/modules/1"
    );
  }

  /**
   * The card's action. A completed module either ENDS the required
   * sequence — and opens the one Certificate of Attendance — or points at
   * the next module. Finishing Module 1 or 2 never opens a certificate.
   */
  async function handleTake(seminar: SeminarView, completed: boolean) {
    if (!completed) {
      await openModuleFlow(seminar);
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
    await openModuleFlow(next);
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

      {/* Service errors (e.g. enrollment on Take Now failed) */}
      {serviceError && (
        <section className="mx-auto mt-[24px] max-w-[1440px] px-[20px] lg:px-[65px]">
          <p role="alert" className="text-[15px] font-semibold leading-normal text-[#c00]">
            {serviceError}
          </p>
        </section>
      )}

      {/* Seminar cards */}
      <section className="mx-auto mt-[60px] flex max-w-[1440px] flex-col gap-[40px] px-[20px] lg:mt-[71px] lg:gap-[44px] lg:px-[65px]">
        {visibleSeminars.map((seminar) => {
          const registered = seminar.started;
          // The views carry each module's own backend access verdict
          // (prerequisite + purchase), so all flags come straight from
          // server truth (cards only render after the catalog+progress
          // fetch resolves — no unlock flash).
          const completed = seminar.status === "Completed";
          const locked = !completed && !canAccessView(seminar);
          return (
            <SeminarCard
              key={seminar.id}
              seminar={seminar}
              durationLabel={seminar.durationLabel}
              speaker={seminar.speaker}
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
                registered ? "/seminars/modules/1" : ROUTES.seminarRegistration
              }
              onTake={() => void handleTake(seminar, completed)}
              onAddToCart={() => handleAddToCart(seminar)}
              inCart={hasItem(seminar.moduleId)}
            />
          );
        })}
        {loading && (
          <p className="text-center text-[18px] leading-normal text-[#7d7d7d]">
            Loading seminar modules...
          </p>
        )}
        {!loading && visibleSeminars.length === 0 && (
          <p className="text-center text-[18px] leading-normal text-[#7d7d7d]">
            No seminar modules found.
          </p>
        )}
      </section>

      <div className="h-[60px] lg:h-[69px]" />
      <Footer />
    </div>
  );
}
