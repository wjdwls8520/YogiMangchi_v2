"use client";

import { useRef, useState } from "react";
import { nicknamePattern } from "../api/contracts";

export function NicknameInput({ initialValue = "" }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  const composing = useRef(false);
  const limit = (value: string) => Array.from(value).slice(0, 8).join("");
  return <input name="nickname" autoComplete="nickname" required pattern={value === initialValue && initialValue ? undefined : nicknamePattern} value={value}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={event => { composing.current = false; setValue(limit(event.currentTarget.value)); }}
    onChange={event => setValue(composing.current ? event.currentTarget.value : limit(event.currentTarget.value))}
    title="공백과 특수문자를 제외한 1~8자" />;
}
