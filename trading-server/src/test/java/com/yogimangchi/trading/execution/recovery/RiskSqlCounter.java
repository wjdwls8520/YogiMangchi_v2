package com.yogimangchi.trading.execution.recovery;

import java.lang.reflect.*;
import java.sql.*;
import java.util.concurrent.atomic.AtomicLong;
import javax.sql.DataSource;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.jdbc.datasource.DelegatingDataSource;

/** Test-only JDBC execution counting; counts both Hibernate and JdbcTemplate without a dependency. */
final class RiskSqlCounter implements BeanPostProcessor {
    private static final ThreadLocal<AtomicLong> ACTIVE=new ThreadLocal<>();
    private static final ThreadLocal<AtomicLong> SELECTS=new ThreadLocal<>();
    static Scope start(){var counter=new AtomicLong();var reads=new AtomicLong();ACTIVE.set(counter);SELECTS.set(reads);return new Scope(counter,reads);}
    record Scope(AtomicLong counter,AtomicLong reads) implements AutoCloseable {long count(){return counter.get();}long selectCount(){return reads.get();}public void close(){ACTIVE.remove();SELECTS.remove();}}
    @Override public Object postProcessAfterInitialization(Object bean,String name) {
        if(!(bean instanceof DataSource source))return bean;
        return new DelegatingDataSource(source) {
            @Override public Connection getConnection()throws SQLException{return wrap(super.getConnection());}
            @Override public Connection getConnection(String user,String password)throws SQLException{return wrap(super.getConnection(user,password));}
        };
    }
    private static Connection wrap(Connection connection) {
        return (Connection)Proxy.newProxyInstance(Connection.class.getClassLoader(),new Class<?>[]{Connection.class},(proxy,method,args)->{
            Object result=invoke(connection,method,args);
            if(result instanceof Statement statement) {
                Class<?> type=statement instanceof CallableStatement?CallableStatement.class:statement instanceof PreparedStatement?PreparedStatement.class:Statement.class;
                return Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},(p,m,a)->{
                    var counter=ACTIVE.get();
                    if(counter!=null&&m.getName().startsWith("execute")) {
                        counter.incrementAndGet();
                        String sql=args!=null&&args.length>0&&args[0] instanceof String?(String)args[0]:a!=null&&a.length>0&&a[0] instanceof String?(String)a[0]:"";
                        String normalized=sql.stripLeading().toLowerCase(java.util.Locale.ROOT);
                        if(normalized.startsWith("select")||normalized.startsWith("with")||normalized.startsWith("explain"))SELECTS.get().incrementAndGet();
                    }
                    return invoke(statement,m,a);
                });
            }
            return result;
        });
    }
    private static Object invoke(Object target,Method method,Object[] args)throws Throwable {
        try{return method.invoke(target,args);}catch(InvocationTargetException failure){throw failure.getCause();}
    }
}
