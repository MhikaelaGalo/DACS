import { Footer } from "@/components/layout/Footer";

/*
 * Shared shell for the canonical DACS legal pages (/privacy-policy and
 * /terms-and-conditions). These pages are the single copy of each document
 * for the whole system — the admin app links here cross-origin instead of
 * hosting its own versions — so the document text lives only in the two
 * page files that use this shell.
 *
 * The header mirrors the client PDFs: document title, system name,
 * developer (NGR), and the effective/last-updated lines.
 */
export function LegalPageLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col bg-white">
      <article className="mx-auto w-full max-w-[900px] flex-1 px-[20px] pb-[60px] pt-[40px] lg:pb-[80px] lg:pt-[56px]">
        <header className="border-b border-dacs-light pb-[28px] text-center lg:pb-[32px]">
          <h1 className="text-[26px] font-semibold leading-normal text-black lg:text-[30px]">
            {title}
          </h1>
          <p className="mt-[10px] text-[15px] leading-normal text-dacs-muted lg:text-[16px]">
            Digital Agriculture Collaboration and Support System (DACS)
            <br />
            National Group Research (NGR)
          </p>
          <p className="mt-[14px] text-[13px] leading-normal text-dacs-gray lg:text-[14px]">
            Effective Date: [Insert Effective Date]
            <br />
            Last Updated: [Insert Last Updated Date]
          </p>
        </header>
        {children}
      </article>
      <Footer />
    </div>
  );
}

/* Introductory paragraphs shown between the document header and section 1. */
export function LegalIntro({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-[28px] flex flex-col gap-[14px] text-justify text-[16px] leading-relaxed text-black lg:mt-[32px] lg:text-[18px]">
      {children}
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-[36px] lg:mt-[40px]">
      <h2 className="text-[20px] font-semibold leading-normal text-black lg:text-[22px]">
        {heading}
      </h2>
      <div className="mt-[14px] flex flex-col gap-[14px] text-justify text-[16px] leading-relaxed text-black lg:text-[18px]">
        {children}
      </div>
    </section>
  );
}

/* Items are ReactNode so bolded phrases from the PDFs can be preserved. */
export function LegalBullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="ms-[27px] flex list-disc flex-col gap-[8px] text-start">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
