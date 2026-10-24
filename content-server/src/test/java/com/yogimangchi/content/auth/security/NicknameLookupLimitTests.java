package com.yogimangchi.content.auth.security;

import java.time.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import static org.assertj.core.api.Assertions.*;

class NicknameLookupLimitTests {
    static class MutableClock extends Clock {
        Instant now=Instant.parse("2026-10-23T00:00:00Z");
        public Instant instant(){return now;}
        public ZoneId getZone(){return ZoneOffset.UTC;}
        public Clock withZone(ZoneId zone){return this;}
    }
    private MockHttpServletResponse request(NicknameLookupLimit filter,String path,String address,String forwarded) throws Exception {
        var req=new MockHttpServletRequest("GET",path);req.setRemoteAddr(address);req.addHeader("X-Forwarded-For",forwarded);
        var response=new MockHttpServletResponse();filter.doFilter(req,response,new MockFilterChain());return response;
    }
    @Test void fixedWindowIgnoresSpoofedHeadersExpiresAndDoesNotBlockOtherRoutes() throws Exception {
        var clock=new MutableClock();var filter=new NicknameLookupLimit(2,2,clock);String path="/api/v1/members/nickname/availability";
        assertThat(request(filter,path,"127.0.0.1","1").getStatus()).isEqualTo(200);
        assertThat(request(filter,path,"127.0.0.1","2").getStatus()).isEqualTo(200);
        var denied=request(filter,path,"127.0.0.1","3");assertThat(denied.getStatus()).isEqualTo(429);
        assertThat(denied.getHeader("Retry-After")).isEqualTo("60");assertThat(denied.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(denied.getContentAsString()).contains("RATE_LIMITED").doesNotContain("127.0.0.1");
        assertThat(request(filter,"/api/v1/auth/refresh","127.0.0.1","4").getStatus()).isEqualTo(200);
        clock.now=clock.now.plusSeconds(60);assertThat(request(filter,path,"127.0.0.1","5").getStatus()).isEqualTo(200);
    }
    @Test void keyCapacityIsBoundedAndRecoversAfterExpiry() throws Exception {
        var clock=new MutableClock();var filter=new NicknameLookupLimit(2,1,clock);String path="/api/v1/members/nickname/availability";
        request(filter,path,"127.0.0.1","1");assertThat(request(filter,path,"127.0.0.2","1").getStatus()).isEqualTo(429);
        clock.now=clock.now.plusSeconds(61);assertThat(request(filter,path,"127.0.0.2","1").getStatus()).isEqualTo(200);
    }
}
