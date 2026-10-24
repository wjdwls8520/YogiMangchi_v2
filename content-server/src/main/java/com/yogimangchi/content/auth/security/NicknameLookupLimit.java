package com.yogimangchi.content.auth.security;

import com.yogimangchi.content.error.ApiErrors;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;
import org.springframework.web.filter.OncePerRequestFilter;

/** Coarse, bounded single-instance guard for anonymous nickname enumeration only. */
final class NicknameLookupLimit extends OncePerRequestFilter {
    private record Window(Instant until,int requests) { }
    private final Map<String,Window> windows=new HashMap<>();
    private final byte[] salt=new byte[32];
    private final Clock clock;
    private final int limit,capacity;
    NicknameLookupLimit(int limit) { this(limit,10_000,Clock.systemUTC()); }
    NicknameLookupLimit(int limit,int capacity,Clock clock) {
        if(limit<1 || capacity<1) throw new IllegalArgumentException("Positive lookup limits required");
        this.limit=limit;this.capacity=capacity;this.clock=clock;new SecureRandom().nextBytes(salt);
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getMethod().equals("GET") || !request.getRequestURI().substring(request.getContextPath().length()).equals("/api/v1/members/nickname/availability");
    }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        // Ignore Forwarded/X-Forwarded-For. Deployment must not rewrite remoteAddr from untrusted headers.
        long retry=acquire(key(request.getRemoteAddr()));
        if(retry>0) {
            response.setHeader("Retry-After",Long.toString(retry));
            ApiErrors.write(response,429,"RATE_LIMITED");return;
        }
        chain.doFilter(request,response);
    }
    private synchronized long acquire(String key) {
        Instant now=clock.instant();
        Window window=windows.get(key);
        if(window==null || !window.until().isAfter(now)) {
            if(windows.size()>=capacity) windows.values().removeIf(w -> !w.until().isAfter(now));
            if(window==null && windows.size()>=capacity) return 60;
            windows.put(key,new Window(now.plusSeconds(60),1));return 0;
        }
        if(window.requests()>=limit) return Math.max(1,(Duration.between(now,window.until()).toMillis()+999)/1000);
        windows.put(key,new Window(window.until(),window.requests()+1));return 0;
    }
    private String key(String address) {
        try {
            var digest=MessageDigest.getInstance("SHA-256");digest.update(salt);
            return HexFormat.of().formatHex(digest.digest(address.getBytes(StandardCharsets.UTF_8)));
        } catch(NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 required",impossible); }
    }
}
