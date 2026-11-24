package com.yogimangchi.trading.qa;

import com.fasterxml.jackson.databind.*;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.lang.reflect.*;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.regex.Pattern;
import javax.sql.DataSource;
import org.slf4j.*;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

/** Test-only request/actual commit timing. It does not claim browser WebSocket delivery latency. */
final class ControlledQaTelemetry implements BeanPostProcessor {
    private static final Logger log=LoggerFactory.getLogger(ControlledQaTelemetry.class);
    private static final ObjectMapper JSON=new ObjectMapper();
    private static final ThreadLocal<Timing> ACTIVE=new ThreadLocal<>();
    private static final String ORDER_EVENT_INSERT="insert into trading.trading_event(account_id,order_id,order_status,event_type,payload,occurred_at)";
    static volatile String phase="STARTING";
    private static final class Timing {final long started=System.nanoTime();long committed;int commits;}
    static void record(String kind,Map<String,?> values){
        try{log.info("CONTROLLED_QA_{} {}",kind.toUpperCase(Locale.ROOT),JSON.writeValueAsString(values));}
        catch(Exception failure){log.warn("Controlled QA telemetry unavailable cause={}",failure.getClass().getSimpleName());}
    }
    @Override public Object postProcessAfterInitialization(Object bean,String name){
        if(!(bean instanceof DataSource source))return bean;
        return new DelegatingDataSource(source){
            @Override public Connection getConnection()throws SQLException{return wrap(super.getConnection());}
            @Override public Connection getConnection(String user,String password)throws SQLException{return wrap(super.getConnection(user,password));}
        };
    }
    private static Connection wrap(Connection connection){
        List<OrderTransition> pending=new ArrayList<>();
        return (Connection)Proxy.newProxyInstance(Connection.class.getClassLoader(),new Class<?>[]{Connection.class},(proxy,method,args)->{
            Object result=invoke(connection,method,args);
            switch(method.getName()){
                case "prepareStatement" -> {
                    if(result instanceof PreparedStatement statement&&args[0] instanceof String sql&&sql.startsWith(ORDER_EVENT_INSERT))
                        return orderEvents(statement,pending);
                }
                case "commit" -> {
                    Timing timing=ACTIVE.get();
                    if(timing!=null){timing.committed=System.nanoTime();timing.commits++;}
                    if(!pending.isEmpty()){
                        String committedAt=Instant.now().toString();
                        for(var transition:pending)record("order_commit",Map.of("orderId",transition.orderId(),"status",transition.status(),
                                "type",transition.type(),"occurredAt",transition.occurredAt(),"committedAt",committedAt,"phase",phase));
                        pending.clear();
                    }
                }
                case "rollback","close" -> pending.clear();
                default -> { }
            }
            return result;
        });
    }
    private record OrderTransition(long orderId,String status,String type,String occurredAt){ }
    private static PreparedStatement orderEvents(PreparedStatement statement,List<OrderTransition> pending){
        Object[] fields=new Object[7];
        return (PreparedStatement)Proxy.newProxyInstance(PreparedStatement.class.getClassLoader(),new Class<?>[]{PreparedStatement.class},(proxy,method,args)->{
            Object result=invoke(statement,method,args);
            if(method.getName().startsWith("set")&&args!=null&&args.length>=2&&args[0] instanceof Integer index){
                if(index==2||index==3||index==4||index==6)fields[index]=args[1];
            }
            if(method.getName().equals("executeUpdate")&&result instanceof Integer rows&&rows>0
                    &&fields[2] instanceof Number orderId&&fields[3] instanceof String status
                    &&fields[4] instanceof String type&&fields[6] instanceof OffsetDateTime occurred){
                pending.add(new OrderTransition(orderId.longValue(),status,type,occurred.toInstant().toString()));
            }
            return result;
        });
    }
    private static Object invoke(Object target,Method method,Object[] arguments)throws Throwable{
        try{return method.invoke(target,arguments);}
        catch(InvocationTargetException failure){throw failure.getCause();}
    }
    static final class Requests extends OncePerRequestFilter implements Ordered {
        private static final Pattern OBSERVED=Pattern.compile("/api/v1/trading/account/(?:orders(?:/quote|/pending|/[0-9]+(?:/cancel)?)?|positions(?:/[0-9]+/(?:close|close-orders|stop-loss))?|wallet|summary|restart|retry|command-results/query|symbols/[0-9]+/leverage)");
        @Override public int getOrder(){return Ordered.HIGHEST_PRECEDENCE+10;}
        @Override protected boolean shouldNotFilter(HttpServletRequest request){return !OBSERVED.matcher(request.getRequestURI()).matches();}
        @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException{
            var timing=new Timing();String phaseAtStart=phase;ACTIVE.set(timing);var cached=new ContentCachingResponseWrapper(response);
            try{
                chain.doFilter(request,cached);
                var metric=new LinkedHashMap<String,Object>();
                metric.put("phase",phaseAtStart);metric.put("phaseAtEnd",phase);metric.put("observedAt",Instant.now().toString());
                metric.put("method",request.getMethod());metric.put("path",request.getRequestURI());metric.put("httpStatus",cached.getStatus());
                boolean lookup=request.getRequestURI().endsWith("/command-results/query")||request.getRequestURI().endsWith("/orders/quote");
                metric.put("kind",lookup||request.getMethod().equals("GET")?"READ":"MUTATION_ATTEMPT");
                metric.put("handlerMs",(System.nanoTime()-timing.started)/1_000_000.0);metric.put("transactionCommits",timing.commits);
                metric.put("lastCommitMs",timing.committed==0?null:(timing.committed-timing.started)/1_000_000.0);
                try{
                    // Do not record credentials, headers, request bodies or full financial responses.
                    JsonNode body=JSON.readTree(cached.getContentAsByteArray());
                    if(body!=null)for(String field:List.of("code","orderId","positionId","status","outcome","attemptOutcome"))if(body.has(field))metric.put(field,body.get(field));
                }catch(IOException ignored){metric.put("responseJsonReadable",false);}
                cached.copyBodyToResponse();metric.put("serverResponseMs",(System.nanoTime()-timing.started)/1_000_000.0);
                record("request",metric);
            }finally{ACTIVE.remove();}
        }
    }
}
