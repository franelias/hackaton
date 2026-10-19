// Command server runs the HTTP API. Config: DATABASE_URL, PORT,
// FIREBASE_PROJECT_ID (FIREBASE_AUTH_EMULATOR_HOST for the emulator), MCP_URL,
// AI_GATEWAY_API_KEY, TUTOR_MODEL, TUTOR_FALLBACK_MODELS (comma-separated).
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"

	"github.com/franelias/hackaton/backend/internal/api"
	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/tutor"
)

func main() {
	ctx := context.Background()
	g, err := db.Open(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: os.Getenv("FIREBASE_PROJECT_ID")})
	if err != nil {
		log.Fatal(err)
	}
	authClient, err := app.Auth(ctx)
	if err != nil {
		log.Fatal(err)
	}
	port := env("PORT", "8000")
	s := &api.Server{DB: g, Auth: authClient, Now: time.Now, MCPURL: env("MCP_URL", "http://localhost:8080/mcp")}
	if key := os.Getenv("AI_GATEWAY_API_KEY"); key != "" {
		var fallbacks []string
		if f := env("TUTOR_FALLBACK_MODELS", "openai/gpt-6-astra,google/gemini-3.1-pro-preview"); f != "" {
			fallbacks = strings.Split(f, ",")
		}
		s.Tutor = tutor.NewGateway(key, env("TUTOR_MODEL", "anthropic/claude-sonnet-5-5"), fallbacks)
	} else {
		log.Print("AI_GATEWAY_API_KEY not set: /api/chat answers 503")
	}
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, s.Routes()))
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}
