"use client";

import { useId, useRef, useState, type ChangeEvent } from "react";
import { DimModal } from "./dim-modal";
import { V1Button } from "./v1-ui";

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
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const COMMUNITY_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function UploadLimitAlertModal({
  error,
  onClose,
}: {
  error: string | null;
  onClose: () => void;
}) {
  return (
    <DimModal
      open={Boolean(error)}
      onClose={onClose}
      title="첨부파일 업로드 제한 안내"
      subtitle="업로드할 수 없는 파일이 포함되어 제외되었습니다."
      maxWidth="448px"
    >
      <div className="space-y-4">
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-bold leading-relaxed text-red-600"
        >
          <span className="mb-1 inline-block rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
            업로드 거절 사유
          </span>
          <p className="mt-1">{error}</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-[#F9FAFB] p-3.5 text-xs text-gray-700">
          <p className="mb-2 font-black text-gray-900">첨부파일 허용 기준</p>
          <ul className="space-y-1 font-medium text-gray-600">
            <li>• 일반 이미지(JPG, PNG, WEBP): 장당 최대 5MB</li>
            <li>• 움짤(GIF): 장당 최대 3MB</li>
            <li>• 동영상(MP4, MOV 등): 업로드 불가</li>
            <li>• 최대 첨부 장수: 게시글당 4장</li>
          </ul>
        </div>

        <div className="flex justify-end pt-1">
          <V1Button type="button" variant="blue" size="sm" onClick={onClose}>
            확인
          </V1Button>
        </div>
      </div>
    </DimModal>
  );
}

export function ProfileImageUploadSlot({
  slotName,
  initialLabel = "기본 프로필 아바타",
  compact = false,
  currentImageUrl = null,
  memberId = null,
  nickname,
  selectedFile,
  resetRequested = false,
  onSelectFile,
  onRequestReset,
}: {
  slotName: "signup-profile-image" | "account-profile-image";
  initialLabel?: string;
  compact?: boolean;
  currentImageUrl?: string | null;
  memberId?: number | null;
  nickname?: string;
  selectedFile?: SelectedS3File | null;
  resetRequested?: boolean;
  onSelectFile?: (file: SelectedS3File | null) => void;
  onRequestReset?: (reset: boolean) => void;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedS3File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const activeSelected = selectedFile !== undefined ? selectedFile : selected;
  void memberId;

  function reportError(message: string) {
    setError(message);
    setModalError(message);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    if (!file) return;
    if (file.type.startsWith("video/")) {
      reportError(
        `[${file.name}] 동영상 파일은 업로드할 수 없습니다. (일반 이미지 최대 5MB · GIF 움짤 최대 3MB만 가능)`,
      );
      event.target.value = "";
      return;
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      reportError(
        `[${file.name}] 지원하지 않는 파일 형식입니다. JPG, PNG, WEBP, GIF 형식의 이미지만 등록할 수 있습니다.`,
      );
      event.target.value = "";
      return;
    }
    if (file.type === "image/gif" && file.size > MAX_GIF_BYTES) {
      reportError(
        `[${file.name} (${formatBytes(file.size)})] GIF 움짤은 최대 3MB 이하만 첨부할 수 있습니다.`,
      );
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      reportError(
        `[${file.name} (${formatBytes(file.size)})] 일반 이미지는 장당 최대 5MB 이하만 첨부할 수 있습니다.`,
      );
      event.target.value = "";
      return;
    }
    if (activeSelected?.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(activeSelected.previewUrl);
    }
    const previewUrl =
      typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : "";
    const nextSelected: SelectedS3File = {
      id: `${file.name}-${file.size}`,
      name: file.name,
      sizeBytes: file.size,
      mimeType: file.type,
      previewUrl,
      rawFile: file,
    };
    setSelected(nextSelected);
    onSelectFile?.(nextSelected);
    onRequestReset?.(false);
  }

  function handleReset() {
    if (activeSelected?.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(activeSelected.previewUrl);
    }
    setSelected(null);
    onSelectFile?.(null);
    if (currentImageUrl || onRequestReset) {
      onRequestReset?.(true);
    }
    setError(null);
    setModalError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="ym-s3-profile-slot" data-s3-slot={slotName}>
      <div className="ym-s3-profile-row">
        <div className={`ym-avatar-frame ${compact ? "is-compact" : "is-large"}`} aria-label={initialLabel}>
          {activeSelected?.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={activeSelected.previewUrl} alt="선택한 프로필 미리보기" className="ym-avatar-img" />
          ) : currentImageUrl && !resetRequested ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentImageUrl} alt={`${nickname || "회원"} 현재 프로필 이미지`} className="ym-avatar-img" />
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
            value={
              activeSelected
                ? `${activeSelected.name} (${formatBytes(activeSelected.sizeBytes)})`
                : resetRequested
                  ? "기본 프로필 이미지로 초기화 예정"
                  : ""
            }
            placeholder="프로필 이미지 선택 (JPG, PNG, WEBP, GIF · 최대 5MB)"
          />
          <label htmlFor={inputId} className="ym-file-trigger">
            파일 선택
          </label>
          <input
            ref={fileInputRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={handleFileChange}
          />
          {(activeSelected || (Boolean(currentImageUrl) && !resetRequested)) && (
            <button type="button" className="ym-file-reset" onClick={handleReset}>
              기본 이미지로 초기화
            </button>
          )}
          {resetRequested && !activeSelected && (
            <button
              type="button"
              className="ym-file-reset text-[#0058FF]"
              onClick={() => onRequestReset?.(false)}
            >
              초기화 취소
            </button>
          )}
        </div>
      </div>
      <small className="ym-helper-violet">
        JPG, PNG, WEBP (최대 5MB) · GIF (최대 3MB)
      </small>
      {error && (
        <div
          role="alert"
          className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-600"
        >
          {error}
        </div>
      )}
      <UploadLimitAlertModal error={modalError} onClose={() => setModalError(null)} />
    </div>
  );
}

export function CommunityImageUploadSlot({
  files,
  onChange,
  onInspectImage,
  maxFiles = 4,
}: {
  files: SelectedS3File[];
  onChange: (next: SelectedS3File[]) => void;
  onInspectImage?: (file: SelectedS3File) => void;
  maxFiles?: number;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  function reportError(message: string) {
    setError(message);
    setModalError(message);
  }

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    setError(null);
    if (picked.length === 0) return;

    const allowedMax = Math.max(0, Math.min(4, maxFiles));
    const next: SelectedS3File[] = [...files];
    for (const file of picked) {
      if (next.length >= allowedMax) {
        reportError(
          allowedMax < 4
            ? `기존 이미지를 포함해 게시글당 최대 4장까지 첨부할 수 있습니다. (추가 가능 ${allowedMax}장)`
            : "이미지는 게시글당 최대 4장까지 첨부할 수 있습니다.",
        );
        break;
      }
      if (file.type.startsWith("video/")) {
        reportError(
          `[${file.name}] 동영상 파일은 업로드할 수 없습니다. (일반 이미지 최대 5MB · GIF 움짤 최대 3MB만 가능)`,
        );
        continue;
      }
      if (!COMMUNITY_ALLOWED_MIME.includes(file.type)) {
        reportError(
          `[${file.name}] 지원하지 않는 파일 형식입니다. JPG, PNG, WEBP 또는 GIF(움짤)만 첨부할 수 있습니다.`,
        );
        continue;
      }
      if (file.type === "image/gif" && file.size > MAX_GIF_BYTES) {
        reportError(
          `[${file.name} (${formatBytes(file.size)})] GIF 움짤은 쾌적한 환경을 위해 최대 3MB 이하만 첨부할 수 있습니다.`,
        );
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        reportError(
          `[${file.name} (${formatBytes(file.size)})] 일반 이미지는 장당 최대 5MB 이하만 첨부할 수 있습니다.`,
        );
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
        <label
          htmlFor={Math.max(0, Math.min(4, maxFiles)) > 0 ? inputId : undefined}
          aria-disabled={files.length >= Math.max(0, Math.min(4, maxFiles))}
          className={`ym-file-trigger-inline whitespace-nowrap shrink-0 ${
            files.length >= Math.max(0, Math.min(4, maxFiles)) ? "opacity-50" : "cursor-pointer"
          }`}
        >
          + 차트·포지션 이미지 첨부 ({files.length}/{Math.max(0, Math.min(4, maxFiles))})
        </label>
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          multiple
          disabled={files.length >= Math.max(0, Math.min(4, maxFiles))}
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={handleSelect}
        />
        <span className="ym-s3-caption">
          JPG, PNG, WEBP(최대 5MB) · GIF 움짤(최대 3MB) · 동영상 업로드 불가
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-600"
        >
          {error}
        </div>
      )}

      <UploadLimitAlertModal error={modalError} onClose={() => setModalError(null)} />

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
