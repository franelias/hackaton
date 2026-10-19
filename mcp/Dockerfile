# Build from the repository root (it needs ../corrections and ../fceia): docker build -f mcp/Dockerfile -t fceia-mcp .
FROM golang:1.26 AS build
WORKDIR /src
COPY corrections ./corrections
COPY fceia ./fceia
COPY mcp ./mcp
WORKDIR /src/mcp
RUN go mod download
RUN CGO_ENABLED=0 go build -o /fceia-mcp ./cmd/fceia-mcp

FROM gcr.io/distroless/static-debian12
COPY --from=build /fceia-mcp /fceia-mcp
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/fceia-mcp"]
