"use client";

import { useId, useRef, useState, type ChangeEvent } from "react";

export interface SelectedS3File {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  previewUrl: string;
  rawFile?: File;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_GIF_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const COMMUNITY_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ProfileImageUploadSlot({
  slotName,
  initialLabel = "기본 프로필 아바타",
  compact = false,
}: {
  slotName: "signup-profile-image" | "account-profile-image";
  initialLabel?: string;
  compact?: boolean;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedS3File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    if (!file) return;
    if (!ALLOWED_MIME.includes(file.type)) {
      setError("JPG, PNG, WEBP 형식의 이미지만 등록할 수 있습니다.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("파일 용량은 최대 5MB까지 업로드할 수 있습니다.");
      event.target.value = "";
      return;
    }
    if (selected?.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(selected.previewUrl);
    }
    const previewUrl =
      typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : "";
    setSelected({
      id: `${file.name}-${file.size}`,
      name: file.name,
      sizeBytes: file.size,
      mimeType: file.type,
      previewUrl,
      rawFile: file,
    });
  }

  function handleReset() {
    if (selected?.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(selected.previewUrl);
    }
    setSelected(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="ym-s3-profile-slot" data-s3-slot={slotName}>
      <div className="ym-s3-profile-row">
        <div className={`ym-avatar-frame ${compact ? "is-compact" : "is-large"}`} aria-label={initialLabel}>
          {selected?.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selected.previewUrl} alt="선택한 프로필 미리보기" className="ym-avatar-img" />
          ) : (
            <span className="ym-avatar-placeholder" aria-hidden="true">YM</span>
          )}
        </div>
        <div className="ym-file-box">
          <input
            type="text"
            readOnly
            className="myInput ym-file-display"
            aria-label="선택된 프로필 이미지 파일명"
            value={selected ? `${selected.name} (${formatBytes(selected.sizeBytes)})` : ""}
            placeholder="프로필 이미지 선택 (JPG, PNG, WEBP · 최대 5MB)"
          />
          <label htmlFor={inputId} className="ym-file-trigger">
            파일 선택
          </label>
          <input
            ref={fileInputRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={handleFileChange}
          />
          {selected && (
            <button type="button" className="ym-file-reset" onClick={handleReset}>
              기본 이미지로 초기화
            </button>
          )}
        </div>
      </div>
      <small className="ym-helper-violet">
        JPG, PNG, WEBP · 최대 5MB · S3 스토리지 업로드 연동 준비 완료 ({selected ? "프리뷰 적용됨" : "선택 사항"})
      </small>
      {error && (
        <p role="alert" className="member-message">
          {error}
        </p>
      )}
    </div>
  );
}

export function CommunityImageUploadSlot({
  files,
  onChange,
  onInspectImage,
}: {
  files: SelectedS3File[];
  onChange: (next: SelectedS3File[]) => void;
  onInspectImage?: (file: SelectedS3File) => void;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    setError(null);
    if (picked.length === 0) return;

    const next: SelectedS3File[] = [...files];
    for (const file of picked) {
      if (next.length >= 4) {
        setError("이미지는 게시글당 최대 4장까지 첨부할 수 있습니다.");
        break;
      }
      if (file.type.startsWith("video/")) {
        setError("동영상 파일은 아직 업로드할 수 없습니다. (이미지 및 3MB 이하 GIF만 가능)");
        continue;
      }
      if (!COMMUNITY_ALLOWED_MIME.includes(file.type)) {
        setError("JPG, PNG, WEBP 또는 GIF(움짤) 형식의 이미지만 첨부할 수 있습니다.");
        continue;
      }
      if (file.type === "image/gif" && file.size > MAX_GIF_BYTES) {
        setError("GIF 움짤은 쾌적한 환경을 위해 3MB 이하만 첨부할 수 있습니다.");
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError("각 이미지 용량은 최대 5MB 이하여야 합니다.");
        continue;
      }
      const previewUrl =
        typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(file)
          : "";
      next.push({
        id: `${file.name}-${file.size}-${next.length}`,
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type,
        previewUrl,
        rawFile: file,
      });
    }
    onChange(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(id: string) {
    const target = files.find(item => item.id === id);
    if (target?.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(target.previewUrl);
    }
    onChange(files.filter(item => item.id !== id));
  }

  return (
    <div className="ym-s3-community-slot" data-s3-slot="community-post-images">
      <div className="ym-s3-community-bar">
        <label htmlFor={inputId} className="ym-file-trigger-inline">
          + 차트·포지션 이미지 첨부 ({files.length}/4)
        </label>
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={handleSelect}
        />
        <span className="ym-s3-caption">
          JPG, PNG, WEBP(최대 5MB) · GIF 움짤(최대 3MB) · 동영상 업로드 불가
        </span>
      </div>

      {error && (
        <p role="alert" className="member-message">
          {error}
        </p>
      )}

      {files.length > 0 && (
        <ul className="ym-s3-thumb-grid" aria-label="첨부 이미지 미리보기">
          {files.map(item => (
            <li key={item.id} className="ym-s3-thumb-card">
              <button
                type="button"
                className="ym-s3-thumb-preview"
                onClick={() => onInspectImage?.(item)}
                title="클릭하여 원본 크기로 보기"
              >
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.previewUrl} alt={item.name} />
                ) : (
                  <span>{item.name}</span>
                )}
              </button>
              <div className="ym-s3-thumb-meta">
                <span className="ym-s3-thumb-name">{item.name}</span>
                <span className="ym-s3-thumb-size">{formatBytes(item.sizeBytes)}</span>
              </div>
              <button
                type="button"
                className="ym-s3-thumb-remove"
                aria-label={`${item.name} 첨부 제거`}
                onClick={() => removeFile(item.id)}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
