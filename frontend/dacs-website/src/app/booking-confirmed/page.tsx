"use client";

// Figma: Booking Confirmed (252:2336). The frame is a dialog shown after a
// consultancy booking is submitted; this route hosts it so the seminar flow
// can deep-link to it. Closing the dialog returns to the Seminars page.
import { useRouter } from "next/navigation";
import { BookingConfirmedModal } from "@/components/booking/BookingConfirmedModal";
import { ROUTES } from "@/constants/routes";

export default function BookingConfirmedPage() {
  const router = useRouter();

  return (
    <div className="min-h-[60vh] bg-white">
      <BookingConfirmedModal onClose={() => router.push(ROUTES.seminars)} />
    </div>
  );
}
