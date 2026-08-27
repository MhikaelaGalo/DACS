import { AvatarImage } from "@/components/profile/AvatarImage";

// Figma: circular avatar column with action buttons below it (frames
// 203:55 / 256:6370 / 255:3998 / 256:6599), rendered at 0.75 scale:
// avatar 275 -> 206, column 288 -> 216, edit badge 79 -> 59. In edit mode
// a red pencil badge overlaps the top-right of the avatar.
export function ProfileAvatarColumn({
  avatarUrl,
  alt,
  editing = false,
  placeholder = false,
  onChangePhoto,
  children,
}: {
  avatarUrl: string;
  alt: string;
  editing?: boolean;
  /** Renders an empty gray circle instead of a photo (farm frames 255:3998 / 256:6599). */
  placeholder?: boolean;
  /** When set, the edit-mode pencil badge becomes a "Change Photo" button. */
  onChangePhoto?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-col items-center lg:ml-[51px] lg:mt-[45px] lg:w-[216px] lg:items-start">
      <div className="relative size-[200px] lg:ml-[5px] lg:size-[206px]">
        <div className="size-full overflow-hidden rounded-full">
          {placeholder ? (
            <div className="size-full bg-[#d9d9d9]" />
          ) : (
            <AvatarImage src={avatarUrl} alt={alt} size={206} />
          )}
        </div>
        {editing &&
          (onChangePhoto ? (
            <button
              type="button"
              onClick={onChangePhoto}
              aria-label="Change Photo"
              title="Change Photo"
              className="absolute left-[130px] top-[-8px] size-[59px] cursor-pointer lg:left-[140px]"
            >
              <img
                src="/figma/icon-avatar-edit.svg"
                alt=""
                className="size-full max-w-none"
              />
            </button>
          ) : (
            <img
              src="/figma/icon-avatar-edit.svg"
              alt=""
              className="absolute left-[130px] top-[-8px] size-[59px] max-w-none lg:left-[140px]"
            />
          ))}
      </div>
      <div className="mt-[33px] flex w-[216px] flex-col gap-[19px]">
        {children}
      </div>
    </div>
  );
}
