"use client";

import { useRef, useState } from "react";

/** Max avatar upload size (the backend caps profile images at 5 MB). */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME_TYPES = ["image/jpeg", "image/png"];

// Shared avatar-picking logic for the profile edit pages (Personal
// Information and Farm Details edit): hidden file input, .jpg/.jpeg/.png +
// 2MB validation, data-URL preview, and remove-selection support. The
// selected File is kept for the multipart upload to
// PUT /api/customers/me/profile-image on save.
export function useAvatarSelection() {
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    fileInputRef.current?.click();
  }

  function clearSelection() {
    setPreview(null);
    setFile(null);
    setError(null);
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Allow picking the same file again after removing the selection.
    event.target.value = "";
    if (!file) return;
    if (!AVATAR_MIME_TYPES.includes(file.type)) {
      setError("Only .jpg, .jpeg, or .png images are allowed.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError("Image must be 2MB or smaller.");
      return;
    }
    setError(null);
    setFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPreview(reader.result);
    };
    reader.readAsDataURL(file);
  }

  return {
    preview,
    file,
    error,
    fileInputRef,
    openPicker,
    clearSelection,
    handleFile,
  };
}
