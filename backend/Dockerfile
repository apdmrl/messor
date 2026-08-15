# Messor backend production image.
#
# Multi-stage build: the Maven build stage compiles and packages the
# application, and the runtime stage copies only the resulting jar into a slim
# JRE image. Build tooling and intermediate artifacts are not carried into the
# final image.

# ---- Build stage ----
FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /app

# Resolve dependencies first so they are cached across builds.
COPY pom.xml .
RUN mvn -q -DskipTests dependency:go-offline

COPY src ./src
RUN mvn -q -DskipTests package

# ---- Runtime stage ----
FROM eclipse-temurin:25-jre
WORKDIR /app

# Run as a non-root user.
RUN useradd --system --uid 10001 --create-home messor
USER messor

COPY --from=build /app/target/messor-0.0.1-SNAPSHOT.jar /app/app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
