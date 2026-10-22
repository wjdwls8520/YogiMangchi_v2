import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNickname } from "../src/features/member/api/nickname";

const origin = "http://localhost:8080";
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const check = (nickname: string, transport: typeof fetch) => checkNickname(origin, nickname, new AbortController().signal, transport);

test("nickname checks explain local empty, length, whitespace, invisible and special-character failures without a request", async () => {
  for (const [nickname, reason] of [["", /입력해/], ["123456789", /최대 8자/], ["가 나", /공백/], ["가\u200b나", /보이지 않는/], ["가!나", /특수문자/], ["가😀", /이모지/]] as const) {
    const result = await check(nickname, async () => assert.fail("Invalid input must not reach the server"));
    assert.equal(result.kind, "invalid"); assert.match(result.message, reason);
  }
});
test("server format rejection never invents the removed minimum length, language or Jamo restrictions", async () => {
  for (const nickname of ["가", "ㄱㄱ", "ㅏㅏ", "東京"]) {
    const result = await check(nickname, async () => response({ code: "INVALID_REQUEST" }, 400));
    assert.equal(result.kind, "invalid"); assert.match(result.message, /1~8자/);
    assert.equal(result.message.includes("최소 2자"), false);
    assert.equal(result.message.includes("완성된 한글"), false);
    assert.equal(result.message.includes("이미 사용 중"), false);
  }
  for (const nickname of ["가", "ㄱㄱ", "ㅏㅏ", "東京"]) {
    const accepted = await check(nickname, async () => response({ available: true }));
    assert.equal(accepted.kind, "available");
  }
});
test("availability, real duplicate, busy conflicts and malformed responses remain distinct and never expose server details", async () => {
  assert.equal((await check("가나", async () => response({ available: false }))).kind, "unavailable");
  assert.equal((await check("가나", async () => response({ code: "NICKNAME_UNAVAILABLE" }, 409))).kind, "unavailable");
  for (const code of ["MEMBER_BUSY", "UNKNOWN_CONFLICT"]) {
    const result = await check("가나", async () => response({ code }, 409));
    assert.equal(result.kind, "error"); assert.match(result.message, /충돌/); assert.equal(result.message.includes("이미 사용 중"), false);
  }
  const secret = "Bearer private-secret https://private.example";
  const result = await check("가나", async () => response({ code: secret, detail: secret }, 400));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal((await check("가나", async () => response({ available: "true" }))).kind, "error");
  const network = await check("가나", async () => { throw new Error(secret); });
  assert.equal(network.kind, "error"); assert.equal(network.message.includes(secret), false);
});
test("a canceled check rejects even a cancellation-resistant late response", async () => {
  const controller = new AbortController(); let finish!: (value: Response) => void;
  const pending = checkNickname(origin, "가나", controller.signal, async () => new Promise(done => { finish = done; }));
  controller.abort(); finish(response({ available: true }));
  await assert.rejects(pending, { name: "AbortError" });
});
