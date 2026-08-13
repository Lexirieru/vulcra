# Guardian confidential-keeper service (guardian-service) — the long-running
# backend the Vulcra frontend's /guardian page talks to. This is NOT the
# reproducible FCC-attestation image (that is tee-extension/Dockerfile); this is
# a plain Go service that runs the TEE node + keeper + REST facade with
# SIMULATED_TEE (judge-approved Coston2 posture).
#
# Build context = backend/tee-extension (the Go module root, has go.mod).
#   docker build -f tools/cmd/guardian-service/Dockerfile -t vulcra-guardian .
# On Railway: Root Directory = backend/tee-extension, Dockerfile path =
# tools/cmd/guardian-service/Dockerfile. Railway injects $PORT (the REST facade
# binds it); set the branch + RPC env vars (see the service README).

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/guardian-service ./tools/cmd/guardian-service

FROM alpine:3.20
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
COPY --from=build /out/guardian-service /usr/local/bin/guardian-service
USER app
# Defaults; override via env. $PORT (Railway) wins over GUARDIAN_API_PORT.
ENV GUARDIAN_API_PORT=8790 \
    SIGN_PORT=7701 \
    EXTENSION_PORT=7702 \
    SIMULATED_TEE=true \
    MODE=1 \
    LOCAL_MODE=false
EXPOSE 8790
ENTRYPOINT ["/usr/local/bin/guardian-service"]
