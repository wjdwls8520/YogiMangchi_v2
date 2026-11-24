import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RestartConfirmation } from "../src/features/trading/components/member-simulation-views";
import { TradingApiError } from "../src/features/trading/api/client";
import { mutationMessage } from "../src/features/trading/api/mutation-request";

test("unconfirmed retry CTA explains possible execution, stays manual, and preserves new-request admission blocking",()=>{
  let executions=0;
  const props={acknowledged:true,pending:false,blocked:"서버 복구 중",onAcknowledge:()=>{},onExecute:()=>{executions++;},onClose:()=>{}};
  const unknown=renderToStaticMarkup(<RestartConfirmation {...props} uncertain/>);
  assert.match(unknown,/아직 접수되지 않은 요청이 실행될 수 있습니다/);
  assert.match(unknown,/<button(?![^>]*disabled)[^>]*>원래 다시시작 요청 재전송/);
  assert.equal(executions,0,"mounting recovery UI must not transmit a mutation");
  const fresh=renderToStaticMarkup(<RestartConfirmation {...props} uncertain={false}/>);
  assert.match(fresh,/<button[^>]*disabled=""[^>]*>새 회차 시작 확인/);
  const pending=renderToStaticMarkup(<RestartConfirmation {...props} pending uncertain/>);
  assert.match(pending,/<button[^>]*disabled=""[^>]*>처리 중…/);
  assert.match(mutationMessage(new TradingApiError(0)),/실행될 수 있습니다/);
});
