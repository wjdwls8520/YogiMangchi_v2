package com.yogimangchi.trading.tradingaccount.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description="Own member Futures account; new member account initial balance is10000USDT with round1; legacy accounts are not auto-credited. Repeated opening does not reset or credit the wallet. Guest history is never merged.")
public record MemberAccountResponse(Long accountId,Long memberId,String status,String quoteAsset,String balance) { }
