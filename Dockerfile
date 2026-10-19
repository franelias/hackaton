# The only image of the project: the arbol CLI (backend/cmd/arbol).
#   API:        docker run -p 8000:8000 --env-file backend/.env arbol            (arbol serve)
#   MCP server: docker run -p 8080:8080 arbol mcp
#   Setup:      docker run --env-file backend/.env arbol migrate | import plan | import periods | seed
FROM golang:1.26 AS build
WORKDIR /src
COPY corrections ./corrections
COPY fceia ./fceia
COPY backend/go.mod backend/go.sum ./backend/
WORKDIR /src/backend
RUN go mod download
COPY backend ./
RUN CGO_ENABLED=0 go build -o /arbol ./cmd/arbol

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=build /arbol /usr/local/bin/arbol
# Read by `arbol import plan|periods` (paths relative to /app).
COPY backend/data ./data
EXPOSE 8000 8080
ENTRYPOINT ["arbol"]
CMD ["serve"]
