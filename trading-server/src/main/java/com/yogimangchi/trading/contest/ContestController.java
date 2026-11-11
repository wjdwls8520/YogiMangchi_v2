package com.yogimangchi.trading.contest;

import com.yogimangchi.trading.contest.ContestDtos.ApplyContestRequest;
import com.yogimangchi.trading.contest.ContestDtos.ContestApplicationView;
import com.yogimangchi.trading.contest.ContestDtos.LeaderboardPageResponse;
import com.yogimangchi.trading.contest.ContestDtos.MemberContestParticipationView;
import com.yogimangchi.trading.contest.ContestDtos.MemberContestSeasonsResponse;
import com.yogimangchi.trading.contest.ContestDtos.MyContestOverviewResponse;
import com.yogimangchi.trading.contest.ContestDtos.PublicSeasonsOverviewResponse;
import com.yogimangchi.trading.contest.ContestDtos.SyncContestNicknameRequest;
import com.yogimangchi.trading.contest.ContestDtos.SyncContestNicknameResponse;
import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/trading/contest")
@Tag(name = "Contest", description = "Seasonal contest public leaderboards, member applications, and contest assets")
public class ContestController {

    private final ContestService contestService;

    public ContestController(ContestService contestService) {
        this.contestService = contestService;
    }

    @GetMapping("/public/seasons")
    @Operation(summary = "List public contest seasons grouped by status")
    public PublicSeasonsOverviewResponse getPublicSeasons() {
        return contestService.getPublicSeasons();
    }

    @GetMapping("/public/seasons/{seasonId:[0-9]+}/leaderboard")
    @Operation(summary = "Get real-time or settled Olympic-ranked leaderboard for a contest season")
    public LeaderboardPageResponse getLeaderboard(
            @PathVariable Long seasonId,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(defaultValue = "20") int size) {
        return contestService.getLeaderboard(seasonId, cursorId, size);
    }

    @GetMapping("/public/members/{memberId:[0-9]+}/seasons")
    @Operation(summary = "Get a member's public contest participation history and results")
    public MemberContestSeasonsResponse getMemberPublicContestSeasons(@PathVariable Long memberId) {
        return contestService.getMemberContestSeasons(memberId);
    }

    @GetMapping("/me/overview")
    @Operation(summary = "Get authenticated member's contest overview (participating, recruiting, pending, rejected)")
    public MyContestOverviewResponse getMyOverview(@AuthenticationPrincipal TradingPrincipal principal) {
        return contestService.getMyOverview(principal.memberId());
    }

    @PostMapping("/seasons/{seasonId:[0-9]+}/applications")
    @Operation(summary = "Apply for a recruiting contest season")
    public ContestApplicationView applyForSeason(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @RequestBody(required = false) ApplyContestRequest request) {
        return contestService.applyForSeason(principal.memberId(), seasonId, request);
    }

    @DeleteMapping("/seasons/{seasonId:[0-9]+}/applications")
    @Operation(summary = "Cancel authenticated member's pending contest season application")
    public ContestApplicationView cancelMyApplication(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId) {
        return contestService.cancelMyApplication(principal.memberId(), seasonId);
    }

    @PatchMapping("/account/nickname")
    @Operation(summary = "Synchronize authenticated member's updated nickname across contest applications and participations")
    public SyncContestNicknameResponse syncMyContestNickname(
            @AuthenticationPrincipal TradingPrincipal principal,
            @RequestBody SyncContestNicknameRequest request) {
        return contestService.syncMyContestNickname(principal.memberId(), request);
    }

    @GetMapping("/account/live")
    @Operation(summary = "Get authenticated member's active or latest contest season participation")
    public MemberContestParticipationView getMyLiveContestAccount(@AuthenticationPrincipal TradingPrincipal principal) {
        return contestService.getMemberContestSeasons(principal.memberId()).activeSeason();
    }

    @GetMapping("/account/seasons")
    @Operation(summary = "Get authenticated member's all contest season participations")
    public MemberContestSeasonsResponse getMyContestSeasons(@AuthenticationPrincipal TradingPrincipal principal) {
        return contestService.getMemberContestSeasons(principal.memberId());
    }
}
