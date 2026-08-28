import Image from "next/image";
import Link from "next/link";
import { ROUTES } from "@/constants/routes";

// Figma footer (1920 frame, rendered at 0.75 scale in a 1440px container):
// 464px tall -> 348px, logo 161x230 -> 121x173, title 32 -> 24, body 24 -> 18,
// bottom row 16 -> 12. The dashed divider is full-bleed like the background;
// only the text content is constrained to the 1440px container.
export function Footer() {
  return (
    <footer className="relative w-full overflow-clip">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <img
          src="/images/footer.png"
          alt=""
          className="absolute size-full max-w-none object-cover"
        />
        <div className="absolute inset-0 bg-[rgba(24,24,24,0.7)]" />
      </div>
      <div className="relative mx-auto max-w-[1440px] pt-[50px] lg:pt-[82px]">
        <div className="flex w-full flex-col gap-[36px] px-[20px] lg:flex-row lg:items-center lg:justify-between lg:px-[117px]">
          <div className="flex flex-col items-start gap-[24px] sm:flex-row sm:items-center sm:gap-[41px] lg:w-[540px] lg:shrink-0 lg:gap-[55px]">
            <div className="h-[173px] w-[121px] shrink-0">
              <Image
                src="/images/logo.png"
                alt="Dominant Asia Poultry Genetics"
                width={121}
                height={173}
                className="size-full object-cover"
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-[26px] font-medium text-white">
              <p className="whitespace-nowrap text-[22px] leading-normal lg:text-[24px]">
                Dominant Asia Poultry Genetics
              </p>
              <p className="text-justify text-[16px] leading-normal lg:text-[18px]">
                Your trusted partner in premium poultry genetics, veterinary
                care, and farm management training in Rizal, Philippines.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-[20px] lg:w-[432px] lg:shrink-0">
            <p className="text-[18px] font-bold leading-normal text-white">
              Contact
            </p>
            <div className="flex flex-col gap-[20px] sm:flex-row sm:items-start sm:gap-0">
              <div className="flex min-w-0 flex-1 items-start gap-[15px]">
                <img
                  src="/figma/icon-location.svg"
                  alt=""
                  className="h-[27px] w-[28px] shrink-0"
                />
                <p className="pt-[2px] text-[18px] leading-normal text-white">
                  Rizal, Philippines
                </p>
              </div>
              <div className="flex items-start gap-[19px] lg:shrink-0">
                <img
                  src="/figma/icon-phone.svg"
                  alt=""
                  className="mt-px size-[20px] shrink-0"
                />
                <p className="text-[18px] leading-normal text-white">
                  +63 917 123 4567
                </p>
              </div>
            </div>
            <div className="mt-[6px] flex items-start gap-[15px]">
              <img
                src="/figma/icon-mail.svg"
                alt=""
                className="h-[23px] w-[28px] shrink-0"
              />
              <p className="text-[18px] leading-normal text-white">
                info@dominantasia.com
              </p>
            </div>
          </div>
        </div>
      </div>
      <div
        aria-hidden
        className="relative mt-[32px] h-px w-full bg-[repeating-linear-gradient(to_right,#fff_0,#fff_10px,transparent_10px,transparent_15px)] lg:mt-[40px]"
      />
      <div className="relative mx-auto max-w-[1440px] pb-[16px] pt-[18px] lg:pb-[21px] lg:pt-[19px]">
        <div className="flex w-full flex-col items-start gap-2 px-[20px] text-[12px] font-medium text-white sm:flex-row sm:items-center sm:justify-between lg:px-[66px]">
          <p className="leading-normal">
            © 2026 National Group Research. All rights reserved.
          </p>
          <div className="flex items-center gap-[40px] leading-normal">
            <Link
              href={ROUTES.privacyPolicy}
              className="hover:underline hover:underline-offset-4"
            >
              Privacy Policy
            </Link>
            <Link
              href={ROUTES.termsAndConditions}
              className="hover:underline hover:underline-offset-4"
            >
              Terms and Conditions
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
