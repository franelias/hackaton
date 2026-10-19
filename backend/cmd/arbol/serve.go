package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/franelias/hackaton/backend/internal/api"
	"github.com/franelias/hackaton/backend/internal/tutor"
	"github.com/franelias/hackaton/fceia"
	"github.com/franelias/hackaton/fceia/tools"
)

func serveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "Run the HTTP API",
		Long: "Run the HTTP API. Config: DATABASE_URL, PORT, FIREBASE_PROJECT_ID (FIREBASE_AUTH_EMULATOR_HOST for the emulator), " +
			"FCEIA_API_BASE, OPENROUTER_API_KEY, TUTOR_MODEL, TUTOR_FALLBACK_MODELS (comma-separated).",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error { return serve(cmd.Context()) },
	}
}

// serve runs the API until ctx is done.
func serve(ctx context.Context) error {
	g, err := openDB()
	if err != nil {
		return err
	}
	authClient, err := firebaseAuth(ctx)
	if err != nil {
		return err
	}
	s := &api.Server{DB: g, Auth: authClient, Now: time.Now, FCEIA: tools.New(fceia.New(env("FCEIA_API_BASE", fceia.DefaultBase)), nil)}
	if key := os.Getenv("OPENROUTER_API_KEY"); key != "" {
		var fallbacks []string
		if f := env("TUTOR_FALLBACK_MODELS", "openai/gpt-6-astra,google/gemini-3.1-pro-preview"); f != "" {
			fallbacks = strings.Split(f, ",")
		}
		s.Tutor = tutor.NewOpenRouter(key, env("TUTOR_MODEL", "anthropic/claude-sonnet-5.5"), fallbacks)
	} else {
		log.Print("OPENROUTER_API_KEY not set: /api/chat answers 503")
	}

	port := env("PORT", "8000")
	srv := &http.Server{Addr: ":" + port, Handler: s.Routes()}
	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()
	log.Printf("listening on :%s", port)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
