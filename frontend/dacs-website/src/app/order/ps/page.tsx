"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Footer } from "@/components/layout/Footer";
import { PsOrderForm } from "@/components/orders/PsOrderForm";
import { SeminarLockNotice } from "@/components/seminars/SeminarLockNotice";
import { ROUTES } from "@/constants/routes";
import { ORDER_PRODUCT_PARAM } from "@/services/order-entry";
import {
  fetchSeminarEligibility,
  type SeminarEligibility,
} from "@/services/eligibility.service";

// Figma: Parent Stocks (PS) Order Form (252:756). The shipping dropdown panel
// (Receive PS Chicks 252:1121) and the Order Received dialog (252:1493) are
// states of this page rendered by PsOrderForm.
// Ordering PS chicks requires Seminar Modules 1-3 completed: until eligibility
// is known (from the DACS backend) nothing renders; when ineligible the
// form is NOT rendered — only the locked-order notice over the dark backdrop.
// (The backend additionally rejects ineligible Parent Stock orders with 409.)
// An Order Now deep link (?product=<slug>) pre-checks that breed on the form.
function PsOrderPageContent() {
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
      <PsOrderForm preselectedSlug={preselectedSlug} />
      <Footer />
    </div>
  );
}

// useSearchParams needs a Suspense boundary so the rest of the route can
// still prerender (Next docs: app/api-reference/functions/use-search-params).
export default function PsOrderPage() {
  return (
    <Suspense fallback={null}>
      <PsOrderPageContent />
    </Suspense>
  );
}
