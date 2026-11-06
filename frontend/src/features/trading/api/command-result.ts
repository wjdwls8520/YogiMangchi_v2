import { record, instant, invalidContract } from "./contracts";
import { parseOrder, type TradingOrder } from "./orders";
import { parseStopLoss, type StopLoss } from "./stop-loss-contract";
import { parseGuestRetry } from "./guest-retry";
import { parseRestart } from "./member-rounds";
import { mutationRequest } from "./mutation-request";
import { canonicalJournalCommand, type JournalEntry } from "./command-journal";

type Operation="OPEN"|"CLOSE"|"LIMIT_CLOSE"|"STOP_LOSS_PUT"|"STOP_LOSS_DELETE"|"MEMBER_RESTART"|"GUEST_RETRY";
export type CommandResult = {status:"NOT_OBSERVED";operation:Operation;observedAt:string;resultKind:null;result:null}
  | {status:"FOUND";operation:"OPEN"|"CLOSE"|"LIMIT_CLOSE"|"CANCEL";observedAt:string;resultKind:"ORDER_CURRENT";result:TradingOrder}
  | {status:"FOUND";operation:"STOP_LOSS_PUT"|"STOP_LOSS_DELETE";observedAt:string;resultKind:"ORIGINAL_SNAPSHOT";result:StopLoss}
  | {status:"FOUND";operation:"GUEST_RETRY";observedAt:string;resultKind:"ORIGINAL_SNAPSHOT";result:ReturnType<typeof parseGuestRetry>}
  | {status:"FOUND";operation:"MEMBER_RESTART";observedAt:string;resultKind:"ORIGINAL_SNAPSHOT";result:ReturnType<typeof parseRestart>};
export function commandResultRequest(entry:JournalEntry) {
  const command=canonicalJournalCommand(entry.command),idempotencyKey=entry.key;
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey))return invalidContract();
  switch(command.kind) {
    case "open":return {operation:"OPEN" as const,idempotencyKey,request:mutationRequest(command).body!};
    case "close":return {operation:"CLOSE" as const,idempotencyKey,request:{positionId:command.positionId,...mutationRequest(command).body}};
    case "limitClose":return {operation:"LIMIT_CLOSE" as const,idempotencyKey,request:{positionId:command.positionId,...mutationRequest(command).body}};
    case "stopLoss":return {operation:command.stopPrice===undefined?"STOP_LOSS_DELETE" as const:"STOP_LOSS_PUT" as const,idempotencyKey,request:{positionId:command.positionId,expectedVersion:command.expectedVersion,...(command.stopPrice===undefined?{}:{stopPrice:command.stopPrice})}};
    case "guestRetry":return {operation:"GUEST_RETRY" as const,idempotencyKey};
    case "memberRestart":return {operation:"MEMBER_RESTART" as const,idempotencyKey};
    case "cancel":return invalidContract();
  }
}
export function parseCommandResult(value:unknown,entry:JournalEntry):CommandResult {
  const data=record(value),request=commandResultRequest(entry),observedAt=instant(data.observedAt),operation=request.operation;
  if(data.operation!==operation)return invalidContract();
  if(data.status==="NOT_OBSERVED") {
    if(data.resultKind!==null||data.result!==null)return invalidContract();
    return {status:"NOT_OBSERVED",operation,observedAt,resultKind:null,result:null};
  }
  if(data.status!=="FOUND")return invalidContract();
  const command=entry.command;
  if(operation==="OPEN"||operation==="CLOSE"||operation==="LIMIT_CLOSE") {
    if(data.resultKind!=="ORDER_CURRENT")return invalidContract();const result=parseOrder(data.result);
    if(command.kind==="open"&&(result.tradingSymbolId!==command.tradingSymbolId||result.side!==command.side||result.type!==command.type||result.action!=="OPEN")
      ||(command.kind==="close"||command.kind==="limitClose")&&(result.positionId!==command.positionId||result.action!=="CLOSE"||result.type!==(command.kind==="close"?"MARKET":"LIMIT")))return invalidContract();
    return {status:"FOUND",operation,observedAt,resultKind:"ORDER_CURRENT",result};
  }
  if(data.resultKind!=="ORIGINAL_SNAPSHOT")return invalidContract();
  if(operation==="STOP_LOSS_PUT"||operation==="STOP_LOSS_DELETE")return {status:"FOUND",operation,observedAt,resultKind:"ORIGINAL_SNAPSHOT",result:parseStopLoss(data.result,command.kind==="stopLoss"?command.positionId:undefined)};
  if(operation==="GUEST_RETRY")return {status:"FOUND",operation,observedAt,resultKind:"ORIGINAL_SNAPSHOT",result:parseGuestRetry(data.result,entry.owner.accountId)};
  return {status:"FOUND",operation,observedAt,resultKind:"ORIGINAL_SNAPSHOT",result:parseRestart(data.result)};
}
export function commandResultSettled(result:CommandResult) {
  return result.status==="FOUND"&&(result.operation!=="CANCEL"||result.result.status!=="PENDING");
}
