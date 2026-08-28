import Image from "next/image";
import Link from "next/link";
import { Footer } from "@/components/layout/Footer";
import { ROUTES } from "@/constants/routes";

// Figma: Home Page — logged out (203:380) and logged in (1:2). The layouts are
// identical; only the navbar right side differs, which the shared Navbar handles.
// Rendered at 0.75 scale in a 1440px container: hero 415 -> 311 (text 48 -> 36),
// headings 40 -> 30, body 24 -> 18, buttons 288x85 -> 216x64, egg band 553 -> 415,
// dark CTA band 455 -> 341 followed by a 101 -> 76 white strip before the footer,
// chicken cutouts 502x381 -> 377x286 (top 201 -> 151) and 335x376 -> 251x282
// (top 228 -> 171), both overhanging the white strip and the footer edge.
export default function HomePage() {
  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="relative h-[300px] w-full lg:h-[311px]">
        <Image
          src="/images/home-1.jpg"
          alt="Chickens in front of a red barn"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-[rgba(24,24,24,0.5)]" />
        <div className="absolute inset-0 flex items-center justify-center px-[20px]">
          <p className="max-w-[815px] text-center font-josefin text-[28px] font-light italic leading-normal text-white lg:text-[36px]">
            Original Program Breeding and Reproduction Poultry of the Supporting
            and Combined Type
          </p>
        </div>
      </section>

      {/* Your Trusted Poultry Partner */}
      <section className="mx-auto flex max-w-[1440px] flex-col items-center">
        <h2 className="mt-[44px] max-w-[689px] px-[20px] text-center text-[26px] font-semibold leading-normal text-black lg:text-[30px]">
          Your Trusted Poultry Partner
        </h2>
        {/* Mobile: balanced 2x2 grid (Breeds/Years, Farmers/Satisfaction);
            desktop keeps the Figma four-across row. */}
        <div className="mt-[62px] grid grid-cols-2 gap-x-[24px] gap-y-[32px] px-[20px] lg:flex lg:flex-wrap lg:items-center lg:justify-center lg:gap-[131px]">
          <div className="flex w-[125px] flex-col items-center justify-self-center">
            <img
              src="/figma/stat-premium-breeds.png"
              alt=""
              className="h-[98px] w-[111px] object-contain"
            />
            <p className="mt-[28px] text-center text-[18px] font-bold leading-normal text-[#6b6b6b]">
              15+ Premium Breeds
            </p>
          </div>
          <div className="flex w-[117px] flex-col items-center justify-self-center">
            <img
              src="/figma/icon-bookmark.svg"
              alt=""
              className="h-[96px] w-[64px]"
            />
            <p className="mt-[30px] text-center text-[18px] font-semibold leading-normal text-[#6b6b6b]">
              6+ Years of Experience
            </p>
          </div>
          <div className="flex w-[125px] flex-col items-center justify-self-center">
            <img
              src="/figma/stat-happy-farmers.png"
              alt=""
              className="size-[91px] object-contain"
            />
            <p className="mt-[28px] text-center text-[18px] font-semibold leading-normal text-[#6b6b6b]">
              54+ Happy Farmers
            </p>
          </div>
          <div className="flex w-[149px] flex-col items-center justify-self-center">
            <img
              src="/figma/icon-sparkle.svg"
              alt=""
              className="size-[82px]"
            />
            <p className="mt-[33px] text-center text-[18px] font-semibold leading-normal text-[#6b6b6b]">
              98% Satisfaction Rate
            </p>
          </div>
        </div>
        <div className="mt-[44px] w-full px-[20px] text-justify text-[16px] leading-normal text-black lg:pl-[84px] lg:pr-[66px] lg:text-[18px]">
          <p>
            Under the dedicated, decisive, and fearless leadership of{" "}
            <span className="font-bold">Dr. Erwin Joseph Cruz</span>, creator of
            the 1997 Bayanihan Poultry Program based on integrity and moral
            uprightness, and aimed at educating and empowering smallholder
            farmers nationwide, Dominant Asia is steadfast in providing a
            wholistic, complete, and sustainable colored chicken farming
            program: hardy and sturdy genetics with reliable production
            performance and highly adapted to our tropical climate, time-tested
            science-based technology, continuous education to equip farmers
            with the most reliable, doable, and sustainable farm practices
            while cultivating critical thinking and agri-entrepreneurial
            skills, dynamic market development and marketing support, and a
            thriving community of educated farmers!
          </p>
          <p className="mt-[22px]">
            It has been 29 fruitful years since that fateful day of electing
            the decision to embark on the less travelled road! Mabuhay!
          </p>
        </div>
        <Link
          href={ROUTES.about}
          className="mt-[44px] flex h-[64px] w-[216px] items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
        >
          <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
            Learn More
          </span>
        </Link>
      </section>

      {/* Egg tray band */}
      <div className="relative mt-[44px] h-[300px] w-full lg:h-[415px]">
        <Image
          src="/images/home-2.jpg"
          alt="Tray of farm eggs"
          fill
          className="object-cover"
        />
      </div>

      {/* Order CTA */}
      <section className="relative">
        <div className="bg-[#181818]">
          <div className="relative mx-auto max-w-[1440px] pb-[120px] pt-[60px] lg:h-[341px] lg:pb-0 lg:pt-0">
            <div className="relative z-10 flex flex-col items-center px-[20px]">
              <h2 className="max-w-[689px] text-center text-[28px] font-semibold leading-normal text-white lg:mt-[72px] lg:text-[30px]">
                Order Premium Poultry Products Today
              </h2>
              <p className="mt-[40px] max-w-[920px] text-center text-[16px] font-light italic leading-normal text-white lg:mt-[32px] lg:text-[18px]">
                Browse our complete catalog of F1 chicks, Parent Stocks, and
                veterinary products.
              </p>
              <Link
                href={ROUTES.products}
                className="mt-[40px] flex h-[64px] w-[216px] items-center justify-center rounded-[15px] bg-[#c00] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:mt-[44px]"
              >
                <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
                  View Products
                </span>
              </Link>
            </div>
            <img
              src="/images/home-4.png"
              alt=""
              className="pointer-events-none absolute left-[17px] top-[151px] z-10 hidden h-[286px] w-[377px] object-contain xl:block"
            />
            <img
              src="/images/home-3.png"
              alt=""
              className="pointer-events-none absolute right-[47px] top-[171px] z-10 hidden h-[282px] w-[251px] object-contain xl:block"
            />
          </div>
        </div>
        {/* White strip between the dark band and the footer (Figma 101 -> 76) */}
        <div aria-hidden className="hidden h-[76px] lg:block" />
      </section>

      <Footer />
    </div>
  );
}
