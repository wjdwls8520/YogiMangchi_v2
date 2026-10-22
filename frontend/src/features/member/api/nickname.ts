import { ContentApiError, contentJson, contentMessage } from "./client";
import { parseNicknameAvailability, validNickname } from "./contracts";

export type NicknameFeedback = { kind: "available" | "unavailable" | "invalid" | "error"; message: string };

export function nicknameIssue(value: string): string | null {
  if (!value) return "닉네임을 입력해 주세요.";
  if (Array.from(value).length > 8) return "닉네임은 최대 8자까지 입력할 수 있습니다.";
  if (/\s/u.test(value)) return "닉네임에는 공백이나 줄바꿈을 사용할 수 없습니다.";
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return "닉네임에는 보이지 않는 문자나 제어문자를 사용할 수 없습니다.";
  if (!validNickname(value)) return "닉네임에는 특수문자나 이모지를 사용할 수 없습니다.";
  return null;
}

export async function checkNickname(origin: string, nickname: string, signal: AbortSignal, transport: typeof fetch = fetch): Promise<NicknameFeedback> {
  if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
  const issue = nicknameIssue(nickname);
  if (issue) return { kind: "invalid", message: issue };
  try {
    const value = await contentJson(origin, `/members/nickname/availability?nickname=${encodeURIComponent(nickname)}`, { signal }, transport);
    if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
    const available = parseNicknameAvailability(value);
    return available ? { kind: "available", message: "사용 가능한 닉네임입니다. 가입·저장 시 중복 여부를 다시 확인합니다." }
      : { kind: "unavailable", message: "이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요." };
  } catch (error) {
    if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof ContentApiError) {
      // The endpoint has no field-level error code; do not invent a minimum length or language restriction.
      if (error.status === 400) return { kind: "invalid", message: "서버가 닉네임 형식을 허용하지 않았습니다. 공백·특수문자 없이 1~8자로 입력했는지 확인해 주세요. 조건에 맞는 입력이라면 잠시 후 다시 확인해 주세요." };
      if (error.status === 409 && error.code === "NICKNAME_UNAVAILABLE") return { kind: "unavailable", message: "이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요." };
      if (error.status === 409) return { kind: "error", message: "회원 정보가 변경 중이거나 요청이 충돌했습니다. 잠시 후 다시 확인해 주세요." };
      if (error.status === 422) return { kind: "error", message: "닉네임 확인 응답을 읽지 못했습니다. 잠시 후 다시 확인해 주세요." };
    }
    return { kind: "error", message: contentMessage(error) };
  }
}
