"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignInRequiredDialog } from "@/components/auth/SignInRequiredDialog";
import { useAuth } from "@/components/providers/AuthProvider";
import { SeminarLockInline } from "@/components/seminars/SeminarLockNotice";
import { ROUTES } from "@/constants/routes";
import { orderHrefForProduct } from "@/services/order-entry";
import {
  fetchSeminarEligibility,
  type SeminarEligibility,
} from "@/services/eligibility.service";
import type { Product } from "@/types/product";

// Figma: F1/PS Description (217:861) at 0.75 scale in the 1440px shell:
// detail card 1515 -> 1136 (rounded 50 -> 38), main image 401 -> 301,
// thumbnails 92x96 -> 69x72, headings 32 -> 24, body 24 -> 18. The Figma
// frame's gray placeholder boxes now render the real product photo
// (main image + thumbnails), uncropped via object-contain; the two
// breeding-specification tables remain exported image assets.
// While Seminar Modules 1-3 are incomplete, a compact locked-ordering notice
// (per-module progress + Continue Seminar) renders under the description.
export function F1PsDescription({ product }: { product: Product }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  // Order Now enters the existing F1 / Parent Stock order form with this
  // product preselected (signed-out visitors sign in first and return
  // straight to the form). Eligibility gating stays with the order pages
  // and the backend's own Parent Stock rule.
  const orderHref = orderHrefForProduct(product);
  const [signInOpen, setSignInOpen] = useState(false);

  function handleOrderNow() {
    if (!orderHref) return;
    if (!user) {
      setSignInOpen(true);
      return;
    }
    router.push(orderHref);
  }
  // Ordered photo set: multi-image products list every approved photo in
  // galleryImageUrls (first entry is the primary imageUrl); the rest fall
  // back to their single photo. Thumbnails select which one shows large.
  const gallery = product.galleryImageUrls?.length
    ? product.galleryImageUrls
    : product.imageUrl
      ? [product.imageUrl]
      : [];
  const [imageIndex, setImageIndex] = useState(0);
  // Set only when a SIGNED-IN farmer's chick ordering is still locked
  // (signed-out visitors browse freely and meet the Sign In flow at ordering
  // entry points instead). Read client-side so SSR and hydration match.
  const [lockedEligibility, setLockedEligibility] =
    useState<SeminarEligibility | null>(null);

  useEffect(() => {
    if (!ready || !user) {
      setLockedEligibility(null);
      return;
    }
    let cancelled = false;
    fetchSeminarEligibility()
      .then((eligibility) => {
        if (cancelled) return;
        setLockedEligibility(
          eligibility.chickOrderingEligible ? null : eligibility
        );
      })
      .catch(() => {
        /* Unknown state shows no inline notice; ordering re-checks. */
      });
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  return (
    <div className="bg-white">
      <div className="relative mx-auto max-w-[1136px] overflow-clip rounded-[38px] bg-white">
        <Link
          href={ROUTES.products}
          aria-label="Close"
          className="absolute left-[24px] top-[24px] block size-[17px] lg:left-[44px] lg:top-[37px] lg:size-[11px]"
        >
          <img src="/figma/icon-close.svg" alt="" className="size-full" />
        </Link>
        <div className="flex flex-col px-[20px] pb-[60px] pt-[70px] lg:flex-row lg:items-start lg:pb-[78px] lg:pl-[104px] lg:pr-[56px] lg:pt-0">
          {/* Left column: main image + thumbnails */}
          <div className="w-full shrink-0 lg:w-[317px] lg:pt-[78px]">
            <div className="h-[301px] w-full border border-[#bebebe] bg-white">
              {gallery.length > 0 ? (
                <img
                  src={gallery[imageIndex] ?? gallery[0]}
                  alt={product.name}
                  className="size-full object-contain"
                />
              ) : (
                <div className="size-full bg-[#d9d9d9]" />
              )}
            </div>
            {/* Mobile: compact centered thumbnail group; desktop keeps the
                Figma spacing across the 317px image column. The four slots
                cycle through the photo set; clicking one shows it large. */}
            <div className="mt-[22px] flex justify-center gap-[8px] lg:justify-between lg:gap-0">
              {[0, 1, 2, 3].map((i) => {
                const galleryIndex = gallery.length ? i % gallery.length : 0;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setImageIndex(galleryIndex)}
                    aria-label={`Show photo ${galleryIndex + 1} of ${product.name}`}
                    className="h-[69px] w-[72px] cursor-pointer border border-[#bebebe] bg-white"
                  >
                    {gallery.length > 0 ? (
                      <img
                        src={gallery[galleryIndex]}
                        alt=""
                        className="size-full object-contain"
                      />
                    ) : (
                      <div className="size-full bg-[#d9d9d9]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right column: name, category, description, breeding tables */}
          <div className="mt-[40px] min-w-0 flex-1 lg:ml-[63px] lg:mt-0 lg:pt-[95px]">
            <p className="text-[24px] font-semibold leading-normal text-black">
              {product.name}
            </p>
            <p className="mt-[8px] text-[18px] leading-normal text-black">
              {product.unit}
            </p>
            <p className="mt-[32px] text-justify text-[18px] leading-normal text-black">
              {product.description}
            </p>

            {lockedEligibility && (
              <SeminarLockInline
                eligibility={lockedEligibility}
                className="mt-[32px]"
              />
            )}

            {orderHref && (
              <button
                type="button"
                onClick={handleOrderNow}
                className="mt-[32px] flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
              >
                <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
                  Order Now
                </span>
              </button>
            )}

            <p className="mt-[32px] text-[24px] font-semibold leading-normal text-black">
              {product.name} - Parental Breeding
            </p>
            <p className="mt-[32px] text-[18px] font-bold leading-normal text-black">
              Breeding period (up to 18 weeks):
            </p>
            <img
              src="/figma/table-parental-breeding.png"
              alt={`${product.name} parental breeding specifications`}
              className="mt-[24px] w-full rounded-[15px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
            />

            <p className="mt-[45px] text-[24px] font-semibold leading-normal text-black">
              {product.name} - Utility Beams
            </p>
            <p className="mt-[32px] text-[18px] font-bold leading-normal text-black">
              Breeding period (up to 18 weeks):
            </p>
            <img
              src="/figma/table-utility-beams.png"
              alt={`${product.name} utility breeding specifications`}
              className="mt-[24px] w-full rounded-[15px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
            />
          </div>
        </div>
      </div>
      {orderHref && (
        <SignInRequiredDialog
          open={signInOpen}
          onClose={() => setSignInOpen(false)}
          returnTo={orderHref}
        />
      )}
    </div>
  );
}
