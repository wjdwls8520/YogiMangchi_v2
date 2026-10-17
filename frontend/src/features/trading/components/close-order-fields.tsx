import { OrderChoices, OrderInput } from "./order-controls";

export type CloseFieldsProps = {
  prefix: string; type: "MARKET" | "LIMIT"; quantity: string; limitPrice: string; ratio: number;
  partialOnly: boolean; disabled: boolean; unit: string;
  onType: (value: string) => void; onQuantity: (value: string) => void; onPrice: (value: string) => void; onRatio: (value: number) => void;
};
export function CloseOrderFields({prefix,type,quantity,limitPrice,ratio,partialOnly,disabled,unit,onType,onQuantity,onPrice,onRatio}:CloseFieldsProps) {
  return <div className="close-order-fields">
    <OrderChoices legend="청산 주문 유형" name={`${prefix}-type`} selected={type} disabled={disabled} onChange={onType}
      choices={[{value:"MARKET",label:"시장가"},{value:"LIMIT",label:"지정가"}]} />
    {type==="LIMIT" && <OrderInput id={`${prefix}-price`} label="청산 지정가" unit="USDT" placeholder="가격 입력" value={limitPrice} disabled={disabled} onChange={onPrice} />}
    <OrderInput id={`${prefix}-quantity`} label="청산 수량" unit={unit} placeholder="수량 입력" value={quantity} disabled={disabled} onChange={onQuantity} />
    <div><label className="field-label" htmlFor={`${prefix}-ratio`}>청산 가능 수량 비율 <span>{ratio}%</span></label>
      <input id={`${prefix}-ratio`} type="range" min="0" max={partialOnly ? 99 : 100} step="1" value={ratio} disabled={disabled} onChange={event=>onRatio(Number(event.target.value))} />
      <OrderChoices legend="청산 비율 선택" name={`${prefix}-ratio-preset`} selected={String(ratio)} disabled={disabled} onChange={value=>onRatio(Number(value))}
        choices={(partialOnly ? [25,50,75] : [25,50,75,100]).map(value=>({value:String(value),label:`${value}%`}))} />
    </div>
  </div>;
}
