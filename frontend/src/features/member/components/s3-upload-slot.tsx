"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { DimModal } from "./dim-modal";
import { V1Button, V1IconClose } from "./v1-ui";

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

function createSafeFileId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
  const ownedUrlsRef = useRef<Set<string>>(new Set());
  const [selected, setSelected] = useState<SelectedS3File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeSelected = selectedFile !== undefined ? selectedFile : selected;
  void memberId;

  useEffect(() => {
    const urls = ownedUrlsRef.current;
    return () => {
      urls.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revoke errors
        }
      });
      urls.clear();
    };
  }, []);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    if (!file) return;
    if (file.type.startsWith("video/")) {
      setError(
        `[${file.name}] 동영상 파일은 업로드할 수 없습니다. (일반 이미지 최대 5MB · GIF 움짤 최대 3MB만 가능)`,
      );
      event.target.value = "";
      return;
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      setError(
        `[${file.name}] 지원하지 않는 파일 형식입니다. JPG, PNG, WEBP, GIF 형식의 이미지만 등록할 수 있습니다.`,
      );
      event.target.value = "";
      return;
    }
    if (file.type === "image/gif" && file.size > MAX_GIF_BYTES) {
      setError(
        `[${file.name} (${formatBytes(file.size)})] GIF 움짤은 최대 3MB 이하만 첨부할 수 있습니다.`,
      );
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(
        `[${file.name} (${formatBytes(file.size)})] 일반 이미지는 장당 최대 5MB 이하만 첨부할 수 있습니다.`,
      );
      event.target.value = "";
      return;
    }
    if (activeSelected?.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(activeSelected.previewUrl);
      ownedUrlsRef.current.delete(activeSelected.previewUrl);
    }
    const previewUrl =
      typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : "";
    if (previewUrl.startsWith("blob:")) {
      ownedUrlsRef.current.add(previewUrl);
    }
    const nextSelected: SelectedS3File = {
      id: createSafeFileId(),
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
      ownedUrlsRef.current.delete(activeSelected.previewUrl);
    }
    setSelected(null);
    onSelectFile?.(null);
    if (currentImageUrl || onRequestReset) {
      onRequestReset?.(true);
    }
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  const displayValue = activeSelected
    ? `${activeSelected.name} (${formatBytes(activeSelected.sizeBytes)})`
    : resetRequested
      ? "기본 프로필 이미지로 초기화 예정"
      : "";

  return (
    <div className="ym-s3-profile-slot" data-s3-slot={slotName}>
      <div className="ym-s3-profile-row">
        <button
          type="button"
          className={`ym-avatar-frame cursor-pointer transition-opacity hover:opacity-85 ${compact ? "is-compact" : "is-large"}`}
          aria-label={`${initialLabel} 변경`}
          title="클릭하여 프로필 이미지 선택"
          onClick={openFilePicker}
        >
          {activeSelected?.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={activeSelected.previewUrl} alt="선택한 프로필 미리보기" className="ym-avatar-img" />
          ) : currentImageUrl && !resetRequested ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentImageUrl} alt={`${nickname || "회원"} 현재 프로필 이미지`} className="ym-avatar-img" />
          ) : (
            <span className="ym-avatar-placeholder" aria-hidden="true">YM</span>
          )}
        </button>
        <div className="ym-file-box">
          <input
            type="text"
            readOnly
            className="myInput ym-file-display cursor-pointer"
            aria-label="선택된 프로필 이미지 파일명 (클릭하여 파일 선택)"
            title={displayValue || "클릭하여 프로필 이미지 선택"}
            value={displayValue}
            placeholder="프로필 이미지 선택"
            onClick={openFilePicker}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openFilePicker();
              }
            }}
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
      <small className="ym-helper-primary text-center sm:text-left">
        JPG, PNG, WEBP (최대 5MB) · GIF (최대 3MB)
      </small>
      {error && (
        <div
          role="alert"
          className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-600"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="업로드 오류 안내 닫기"
            className="shrink-0 rounded p-0.5 text-red-500 hover:bg-red-100"
          >
            <V1IconClose className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function CommunityImageUploadSlot({
  files,
  onChange,
  onInspectImage,
  maxFiles = 10,
}: {
  files: SelectedS3File[];
  onChange: (next: SelectedS3File[]) => void;
  onInspectImage?: (file: SelectedS3File) => void;
  maxFiles?: number;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ownedUrlsRef = useRef<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [inspectedFile, setInspectedFile] = useState<SelectedS3File | null>(null);
  const allowedMax = Math.max(0, Math.min(10, maxFiles));

  useEffect(() => {
    const urls = ownedUrlsRef.current;
    return () => {
      urls.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revoke errors
        }
      });
      urls.clear();
    };
  }, []);

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    setError(null);
    if (picked.length === 0) return;

    const next: SelectedS3File[] = [...files];
    for (const file of picked) {
      if (next.length >= allowedMax) {
        setError(`이미지는 현재 최대 ${allowedMax}장까지 첨부할 수 있습니다.`);
        break;
      }
      if (file.type.startsWith("video/")) {
        setError(
          `[${file.name}] 동영상 파일은 업로드할 수 없습니다. (일반 이미지 최대 5MB · GIF 움짤 최대 3MB만 가능)`,
        );
        continue;
      }
      if (!COMMUNITY_ALLOWED_MIME.includes(file.type)) {
        setError(
          `[${file.name}] 지원하지 않는 파일 형식입니다. JPG, PNG, WEBP 또는 GIF(움짤)만 첨부할 수 있습니다.`,
        );
        continue;
      }
      if (file.type === "image/gif" && file.size > MAX_GIF_BYTES) {
        setError(
          `[${file.name} (${formatBytes(file.size)})] GIF 움짤은 최대 3MB 이하만 첨부할 수 있습니다.`,
        );
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(
          `[${file.name} (${formatBytes(file.size)})] 일반 이미지는 장당 최대 5MB 이하만 첨부할 수 있습니다.`,
        );
        continue;
      }
      const previewUrl =
        typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(file)
          : "";
      if (previewUrl.startsWith("blob:")) {
        ownedUrlsRef.current.add(previewUrl);
      }
      next.push({
        id: createSafeFileId(),
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
      ownedUrlsRef.current.delete(target.previewUrl);
    }
    if (inspectedFile?.id === id) setInspectedFile(null);
    onChange(files.filter(item => item.id !== id));
  }

  function handleInspect(file: SelectedS3File) {
    if (onInspectImage) {
      onInspectImage(file);
    } else {
      setInspectedFile(file);
    }
  }

  return (
    <div className="ym-s3-community-slot" data-s3-slot="community-post-images">
      <div className="ym-s3-community-bar">
        <label
          htmlFor={allowedMax > 0 ? inputId : undefined}
          aria-disabled={files.length >= allowedMax}
          className={`ym-file-trigger-inline whitespace-nowrap shrink-0 ${
            files.length >= allowedMax ? "opacity-50" : "cursor-pointer"
          }`}
        >
          + 차트·포지션 이미지 첨부 ({files.length}/{allowedMax})
        </label>
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          multiple
          disabled={files.length >= allowedMax}
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={handleSelect}
        />
        <span className="ym-s3-caption">
          JPG, PNG, WEBP(최대 5MB) · GIF 움짤(최대 3MB) · 최대 {allowedMax}장 · 동영상 불가
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-600"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="업로드 오류 안내 닫기"
            className="shrink-0 rounded p-0.5 text-red-500 hover:bg-red-100"
          >
            <V1IconClose className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <DimModal
        open={inspectedFile !== null}
        onClose={() => setInspectedFile(null)}
        title={inspectedFile?.name ?? "첨부 이미지 미리보기"}
        subtitle={
          inspectedFile
            ? `${formatBytes(inspectedFile.sizeBytes)} · ${inspectedFile.mimeType}`
            : undefined
        }
        maxWidth="760px"
        footer={
          <V1Button type="button" variant="gray" size="sm" onClick={() => setInspectedFile(null)}>
            닫기
          </V1Button>
        }
      >
        {inspectedFile?.previewUrl ? (
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={inspectedFile.previewUrl}
              alt={inspectedFile.name}
              className="ym-lightbox-img"
            />
          </div>
        ) : (
          <p className="text-sm text-gray-500">미리보기 이미지를 표시할 수 없습니다.</p>
        )}
      </DimModal>

      {files.length > 0 && (
        <ul className="ym-s3-thumb-grid" aria-label="첨부 이미지 미리보기">
          {files.map(item => (
            <li key={item.id} className="ym-s3-thumb-card">
              <button
                type="button"
                className="ym-s3-thumb-preview"
                onClick={() => handleInspect(item)}
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
