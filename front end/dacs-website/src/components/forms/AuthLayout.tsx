import Image from "next/image";
import Link from "next/link";
import { ROUTES } from "@/constants/routes";

interface AuthLayoutProps {
  /** Which tab is highlighted red with the underline. */
  activeTab: "sign-in" | "register";
  /**
   * Bottom padding of the content band. Figma at 0.75 scale: Register ends
   * 113px -> 85px above the eggs background bottom, Sign In (default)
   * 143px -> 107px, and the Forgot Password steps pass their own values
   * (198 / 220 / 158) so every frame keeps its band height.
   */
  bottomPaddingClassName?: string;
  children: React.ReactNode;
}

// Figma: shared shell of Register (203:529), Sign In (320:57) and
// Forgot Password (535:586 / 535:622 / 535:654), rendered at 0.75 scale in a
// 1440px container — full-bleed chicken banner under the navbar (212 -> 159
// tall), faint eggs background, big logo left (430x428 -> 323x321),
// heading + tabs right (column 621 -> 466).
export function AuthLayout({
  activeTab,
  bottomPaddingClassName = "pb-[80px] lg:pb-[107px]",
  children,
}: AuthLayoutProps) {
  const tabBase =
    "flex-1 pb-[11px] text-center text-[18px] leading-normal";
  const activeTabClass = "border-b border-[#c00] text-[#c00]";
  const inactiveTabClass = "border-b border-transparent text-[#7d7d7d]";

  return (
    <div className="bg-white">
      {/* Chicken photo banner */}
      <section className="relative h-[140px] w-full lg:h-[159px]">
        <Image
          src="/images/register-signin.jpg"
          alt="Free-range chickens on the farm"
          fill
          className="object-cover"
          priority
        />
      </section>

      {/* Content band with faint eggs background */}
      <section className="relative">
        <Image
          src="/images/register-signin-2.jpg"
          alt=""
          fill
          className="pointer-events-none select-none object-cover opacity-15"
          aria-hidden
        />
        <div
          className={`relative mx-auto flex max-w-[1440px] flex-col items-center px-[20px] lg:flex-row lg:items-start lg:px-0 ${bottomPaddingClassName}`}
        >
          {/* Big logo, left column — Figma crops the wide source inside a
              near-square box (inner image 196.36% x 115.54%, offset -48% / -8.23%).
              The Figma offsets (117/197) assume a 1440px canvas — min(vw,px)
              keeps them exact at 1440 while shrinking them at 1024-1439 so
              the row never overflows the viewport. */}
          <div className="relative mt-[40px] aspect-[323/321] w-[240px] shrink-0 overflow-hidden lg:ml-[min(8.13vw,117px)] lg:mt-[128px] lg:h-[321px] lg:w-[323px]">
            <Image
              src="/images/register-signin-logo.png"
              alt="Dominant Asia Poultry Genetics"
              width={323}
              height={321}
              className="absolute left-[-48%] top-[-8.23%] h-[115.54%] w-[196.36%] max-w-none"
            />
          </div>

          {/* Heading + tabs + form, right column */}
          <div className="mt-[40px] w-full max-w-[466px] lg:ml-[min(13.7vw,197px)] lg:mt-[38px] lg:min-w-0">
            <h1 className="text-center text-[28px] font-semibold leading-normal text-black lg:text-[30px]">
              Dominant Asia Poultry Genetics
            </h1>
            <p className="mt-[15px] text-center text-[18px] leading-normal text-black lg:mt-[19px]">
              Your Trusted Poultry Partner
            </p>
            <div className="mt-[32px] flex lg:mt-[38px]">
              <Link
                href={ROUTES.signIn}
                aria-current={activeTab === "sign-in" ? "page" : undefined}
                className={`${tabBase} ${
                  activeTab === "sign-in" ? activeTabClass : inactiveTabClass
                }`}
              >
                Sign In
              </Link>
              <Link
                href={ROUTES.register}
                aria-current={activeTab === "register" ? "page" : undefined}
                className={`${tabBase} ${
                  activeTab === "register" ? activeTabClass : inactiveTabClass
                }`}
              >
                Register
              </Link>
            </div>
            {children}
          </div>
        </div>
      </section>
    </div>
  );
}
