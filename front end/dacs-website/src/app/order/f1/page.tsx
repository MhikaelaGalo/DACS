"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Footer } from "@/components/layout/Footer";
import { F1OrderForm } from "@/components/orders/F1OrderForm";
import { SeminarLockNotice } from "@/components/seminars/SeminarLockNotice";
import { ROUTES } from "@/constants/routes";
import { ORDER_PRODUCT_PARAM } from "@/services/order-entry";
import {
  fetchSeminarEligibility,
  type SeminarEligibility,
} from "@/services/eligibility.service";

// Figma: First Filial Generation (F1) Order Form — 450:1569 ("Other" schedule
// state) and 255:3697 (month state). The month dropdown panel (When need F1
// 255:2400) and the Order Received dialog (252:1493) are states of this page
// rendered by F1OrderForm.
// Ordering F1 chicks requires Seminar Modules 1-3 completed: until eligibility
// is known (from the DACS backend) nothing renders; when ineligible the
// form is NOT rendered — only the locked-order notice over the dark backdrop.
// An Order Now deep link (?product=<slug>) pre-checks that F1 line on the form.
function F1OrderPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedSlug = searchParams.get(ORDER_PRODUCT_PARAM);
  const [eligibility, setEligibility] = useState<SeminarEligibility | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    fetchSeminarEligibility()
      .then((result) => {
        if (!cancelled) setEligibility(result);
      })
      .catch(() => {
        /* Unknown state renders nothing — the safe (locked) direction. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!eligibility) return null;

  if (!eligibility.chickOrderingEligible) {
    return (
      <div className="min-h-screen bg-[#181818]">
        <SeminarLockNotice
          open
          onClose={() => router.push(ROUTES.forms)}
          eligibility={eligibility}
        />
      </div>
    );
  }

  return (
    <div className="bg-[#181818]">
      <F1OrderForm preselectedSlug={preselectedSlug} />
      <Footer />
    </div>
  );
}

// useSearchParams needs a Suspense boundary so the rest of the route can
// still prerender (Next docs: app/api-reference/functions/use-search-params).
export default function F1OrderPage() {
  return (
    <Suspense fallback={null}>
      <F1OrderPageContent />
    </Suspense>
  );
}
