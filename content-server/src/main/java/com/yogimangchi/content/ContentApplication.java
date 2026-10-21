package com.yogimangchi.content;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;

@SpringBootApplication(exclude=UserDetailsServiceAutoConfiguration.class)
public class ContentApplication {
    public static void main(String[] args) { SpringApplication.run(ContentApplication.class,args); }
}
