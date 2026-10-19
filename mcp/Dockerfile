FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /fceia-mcp ./cmd/fceia-mcp

FROM gcr.io/distroless/static-debian12
COPY --from=build /fceia-mcp /fceia-mcp
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/fceia-mcp"]
