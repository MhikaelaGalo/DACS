import Image from "next/image";
import { Footer } from "@/components/layout/Footer";
import {
  PAYMENT_PROOF_DEADLINE_DAYS,
  PAYMENT_PROOF_EMAIL,
} from "@/components/orders/PaymentDeadlineNotice";

// Figma: About Us (368:13), rendered at 0.75 scale in a 1440px container:
// hero 410 -> 308 (text 48 -> 36), headings 40 -> 30, body 24 -> 18,
// columns 739/921 -> 554/691, cards rounded 20 -> 15 (shadow 20 -> 15),
// map band 544 -> 408.

/* Client-approved About page copy. */
const MISSION_TEXT =
  "To support poultry farmers across the Philippines by providing accessible poultry genetics, veterinary products, practical education, breeder certification support, and dependable services through efficient and farmer-friendly solutions.";

const VISION_TEXT =
  "To strengthen the Philippine poultry community through accessible knowledge, connected services, and responsible innovation that helps farmers manage and develop their poultry operations with greater confidence and efficiency.";

const OWNER_TEXT =
  "Dr. Erwin Joseph Cruz is the Owner of Dominant Asia Poultry Genetics. He leads an organization dedicated to serving poultry farmers through Parent Stock and F1 products, veterinary supplies, poultry education, and breeder certification programs throughout the Philippines.";

const CO_OWNER_TEXT =
  "Cristina Cruz is the Co-Owner of Dominant Asia Poultry Genetics. She supports the organization in providing poultry products, educational programs, customer services, and breeder certification initiatives for poultry farmers across the Philippines.";

/**
 * Fallback FAQ list (the client-approved copy, also seeded into the
 * backend via back end/scripts/seed-website-faqs.ts). The live list
 * comes from the public GET /api/faqs endpoint; this array only renders
 * when that call fails.
 */
const FAQ_ITEMS = [
  {
    question: "What do I need to complete before I can order Parent Stock?",
    answer:
      "Farmers must successfully complete Seminar Modules 1, 2, and 3 before Parent Stock ordering becomes available through DACS. Seminar enrollment, progress, assessments, and module completion are recorded in the farmer's account for verification.",
  },
  {
    question: "How do I submit my payment and know when it has been verified?",
    answer: `After placing an order, email your proof of payment to ${PAYMENT_PROOF_EMAIL} within ${PAYMENT_PROOF_DEADLINE_DAYS} days of checkout. Authorized Administrative Staff will review the emailed proof and update the corresponding payment and order status — orders with no recorded payment within ${PAYMENT_PROOF_DEADLINE_DAYS} days are cancelled automatically. You can monitor these updates and view your transaction history through your account.`,
  },
  {
    question: "How can I check my breeder eligibility and certification status?",
    answer:
      "Your DACS account allows you to view your breeder eligibility and certification status. Breeder eligibility is monitored using the released date of the applicable Parent Stock transaction and follows a ninety-day eligibility period. Breeder certifications are valid for two years, with statuses including Active, Pending, Expired, and Ineligible.",
  },
  {
    question: "How can I submit a question or follow up on an inquiry?",
    answer:
      "You can submit an inquiry through DACS and receive a reference number for tracking. Inquiry tickets may be marked as Submitted, Under Review, Responded, or Closed. Responses and resolutions are sent through the organization's official email, while the ticket and its status remain available in DACS.",
  },
];

interface FaqItem {
  question: string;
  answer: string;
}

/** Published FAQs from the DACS backend; approved fallback on failure. */
async function loadFaqs(): Promise<FaqItem[]> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000";
  try {
    const response = await fetch(`${baseUrl}/api/faqs`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) return FAQ_ITEMS;
    const payload = (await response.json()) as {
      data?: Array<{ question?: unknown; answer?: unknown }>;
    };
    const faqs = (payload.data ?? [])
      .filter(
        (row) =>
          typeof row.question === "string" && typeof row.answer === "string"
      )
      .map((row) => ({
        question: row.question as string,
        answer: row.answer as string,
      }));
    return faqs.length > 0 ? faqs : FAQ_ITEMS;
  } catch {
    return FAQ_ITEMS;
  }
}

export default async function AboutPage() {
  const faqItems = await loadFaqs();
  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="relative h-[300px] w-full lg:h-[308px]">
        <Image
          src="/images/about-us-2.jpg"
          alt="Aerial view of the Dominant Asia poultry farm"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 flex items-center justify-center px-[20px]">
          <p className="max-w-[831px] text-center font-josefin text-[28px] font-light italic leading-normal text-white lg:text-[36px]">
            A decade of dedication to elevating Philippine poultry farming
            through premium genetics and expertise.
          </p>
        </div>
      </section>

      {/* Our Background + Mission/Vision */}
      <section className="mx-auto flex max-w-[1440px] flex-col gap-[60px] px-[20px] pt-[60px] lg:flex-row lg:gap-[65px] lg:px-[65px] lg:pt-[63px]">
        <div className="flex min-w-0 flex-col lg:max-w-[554px] lg:flex-1">
          <h2 className="text-center text-[26px] font-semibold leading-normal text-black lg:text-[30px]">
            Our Background
          </h2>
          <div className="mt-[40px] text-justify text-[16px] leading-normal text-black lg:mt-[35px] lg:text-[18px]">
            <p>
              Dominant Asia Poultry Genetics is a Philippine poultry enterprise
              serving farmers across the country. The organization provides
              Parent Stocks, First Filial products, and veterinary supplies
              while also supporting poultry farmers through educational
              seminars and breeder certification programs.
            </p>
            <p className="mt-[22px]">
              As the organization continues to grow, Dominant Asia Poultry
              Genetics aims to provide farmers with more organized and
              accessible ways to interact with its products, programs, and
              services.
            </p>
            <p className="mt-[22px]">
              Through DACS, farmers can manage their information, participate
              in seminars, place and monitor orders, track payment status,
              check breeder eligibility and certification, submit inquiries,
              and review transaction records through a single account.
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col lg:pt-[70px]">
          <h3 className="text-[22px] font-semibold leading-normal text-black lg:text-[24px]">
            Our Mission
          </h3>
          <div className="mt-[14px] rounded-[15px] bg-white px-[24px] py-[32px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[23px] lg:pb-[31px] lg:pt-[30px]">
            <p className="text-justify text-[16px] leading-normal text-black lg:text-[18px]">
              {MISSION_TEXT}
            </p>
          </div>
          <h3 className="mt-[48px] text-[22px] font-semibold leading-normal text-black lg:text-[24px]">
            Our Vision
          </h3>
          <div className="mt-[14px] rounded-[15px] bg-white px-[24px] py-[32px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[23px] lg:pb-[31px] lg:pt-[30px]">
            <p className="text-justify text-[16px] leading-normal text-black lg:text-[18px]">
              {VISION_TEXT}
            </p>
          </div>
        </div>
      </section>

      {/* Meet the Owners */}
      <section className="mt-[60px] flex flex-col items-center px-[20px] lg:mt-[51px]">
        <h2 className="text-center text-[26px] font-semibold leading-normal text-black lg:text-[30px]">
          Meet the Owners
        </h2>
        <div className="mt-[35px] flex w-full max-w-[1127px] flex-col gap-[40px] lg:gap-[20px]">
          {/* Owner */}
          <div className="flex flex-col items-center gap-[11px] lg:flex-row lg:items-stretch">
            <div className="w-full rounded-[15px] bg-white p-[24px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:flex-1 lg:pb-[49px] lg:pl-[97px] lg:pr-[96px] lg:pt-[38px]">
              <p className="text-center text-[22px] font-semibold leading-normal text-black lg:text-[24px]">
                Dr. Erwin Joseph Cruz
              </p>
              <p className="mt-[2px] text-center text-[16px] font-semibold leading-normal text-[#7d7d7d] lg:text-[18px]">
                Owner
              </p>
              <p className="mt-[13px] text-justify text-[16px] leading-normal text-black lg:text-[18px]">
                {OWNER_TEXT}
              </p>
            </div>
            {/* The photo box stretches flush with the text card's top and
                bottom edges (Figma shows them aligned); 237px is the Figma
                height when the card text fits its design height. On mobile it
                gets symmetric vertical margins so it sits centered between
                its info card and the next section. */}
            <div className="relative my-[40px] h-[237px] w-full max-w-[279px] shrink-0 overflow-hidden rounded-[15px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:my-0 lg:h-auto lg:min-h-[237px] lg:w-[279px] lg:self-stretch">
              <Image
                src="/images/dr-erwin-joseph-cruz.jpg"
                alt="Dr. Erwin Joseph Cruz"
                fill
                className="rounded-[15px] object-cover"
              />
            </div>
          </div>
          {/* Co-Owner */}
          <div className="flex flex-col items-center gap-[11px] lg:flex-row lg:items-stretch">
            {/* Co-owner photo — temporarily reuses Dr. Erwin Joseph Cruz's
                portrait (per client) until Cristina Cruz's own photo is
                provided. */}
            <div className="relative order-last my-[40px] h-[237px] w-full max-w-[279px] shrink-0 overflow-hidden rounded-[15px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:order-none lg:my-0 lg:h-auto lg:min-h-[237px] lg:w-[279px] lg:self-stretch">
              <Image
                src="/images/dr-erwin-joseph-cruz.jpg"
                alt="Co-owner portrait"
                fill
                className="rounded-[15px] object-cover"
              />
            </div>
            <div className="w-full rounded-[15px] bg-white p-[24px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:flex-1 lg:pb-[49px] lg:pl-[97px] lg:pr-[96px] lg:pt-[35px]">
              <p className="text-center text-[22px] font-semibold leading-normal text-black lg:text-[24px]">
                Cristina Cruz
              </p>
              <p className="mt-[2px] text-center text-[16px] font-semibold leading-normal text-[#7d7d7d] lg:text-[18px]">
                Co-Owner
              </p>
              <p className="mt-[16px] text-justify text-[16px] leading-normal text-black lg:text-[18px]">
                {CO_OWNER_TEXT}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Frequently Asked Questions */}
      <section className="mx-auto mt-[60px] max-w-[1440px] lg:mt-[77px]">
        <h2 className="px-[20px] text-center text-[26px] font-semibold leading-normal text-black lg:text-[30px]">
          Frequently Asked Questions (FAQs)
        </h2>
        <div className="mt-[20px] flex flex-col gap-[40px] px-[20px] lg:gap-[20px] lg:px-[65px]">
          {faqItems.map((item, index) => (
            <div
              key={index}
              className="flex flex-col gap-[16px] lg:flex-row lg:gap-[32px]"
            >
              <ol
                start={index + 1}
                className="list-decimal text-[16px] font-semibold leading-normal text-black lg:mt-[30px] lg:w-[527px] lg:shrink-0 lg:text-[18px]"
              >
                <li className="ms-[27px]">{item.question}</li>
              </ol>
              <div className="min-w-0 rounded-[15px] bg-white px-[24px] py-[32px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:max-w-[691px] lg:flex-1 lg:px-[23px] lg:pb-[31px] lg:pt-[30px]">
                <p className="text-justify text-[16px] leading-normal text-black lg:text-[18px]">
                  {item.answer}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Location map — live Google Maps embed (Dominant Asia Livestock
          Genetics Breeder Farm), full-bleed and fully interactive. */}
      <section className="relative mt-[60px] h-[420px] w-full overflow-hidden lg:mt-[77px] lg:h-[450px]">
        <iframe
          src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3861.242501364394!2d121.25155887594626!3d14.585253085899318!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3397954ebd3bfd59%3A0xa7449462a1f03934!2sDominant%20Asia%20Livestock%20Genetics%20Breeder%20farm!5e0!3m2!1sen!2sph!4v1787051990725!5m2!1sen!2sph"
          style={{ border: 0 }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          title="Dominant Asia Livestock Genetics Breeder Farm"
          className="block h-full w-full max-w-full"
        />
      </section>

      <Footer />
    </div>
  );
}
