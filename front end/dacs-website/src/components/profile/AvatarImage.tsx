/*
 * Avatar renderer that handles every source the session can produce:
 * bundled assets ("/images/...") go through next/image; backend upload
 * URLs (http://.../uploads/profile-images/...) and in-memory data-URL
 * previews use a plain <img> — the backend host is not a configured
 * next/image remote and data URLs are not optimizable.
 */
import Image from "next/image";
import { DEFAULT_AVATAR_URL } from "@/constants/profile";

export function AvatarImage({
  src,
  alt,
  size,
  className = "size-full object-cover",
}: {
  src: string;
  alt: string;
  size: number;
  className?: string;
}) {
  const url = src || DEFAULT_AVATAR_URL;
  if (url.startsWith("http") || url.startsWith("data:")) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img src={url} alt={alt} width={size} height={size} className={className} />
    );
  }
  return (
    <Image src={url} alt={alt} width={size} height={size} className={className} />
  );
}
