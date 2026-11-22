# syntax=docker/dockerfile:1

FROM eclipse-temurin:17-jdk-alpine AS builder

WORKDIR /workspace

COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle

RUN sed -i 's/\r$//' gradlew \
    && chmod +x gradlew \
    && ./gradlew dependencies --no-daemon

COPY src ./src

RUN ./gradlew bootJar --no-daemon -x test \
    && BOOT_JAR="$(find build/libs -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar' | head -n 1)" \
    && test -n "$BOOT_JAR" \
    && cp "$BOOT_JAR" /workspace/app.jar

FROM eclipse-temurin:17-jre-alpine AS runtime

RUN apk add --no-cache curl tzdata \
    && addgroup -S app \
    && adduser -S app -G app \
    && mkdir -p /app /var/log/yogimangchi \
    && chown -R app:app /app /var/log/yogimangchi

ENV TZ=Asia/Seoul

WORKDIR /app

COPY --from=builder --chown=app:app /workspace/app.jar /app/app.jar

USER app

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8081/actuator/health/liveness || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
