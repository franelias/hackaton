// Command arbol is the only CLI of the project: it serves the API and the
// FCEIA MCP server, and runs every setup task (migrations, plan and period
// imports, demo seed). `arbol up` brings the whole local stack up in one go.
// Config comes from the environment; .env (or --env-file) is loaded first
// without overriding variables already set.
package main

import (
	"context"
	"errors"
	"io/fs"
	"log"
	"os"
	"os/signal"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/joho/godotenv"
	"github.com/spf13/cobra"
	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/db"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := rootCmd().ExecuteContext(ctx); err != nil {
		os.Exit(1)
	}
}

func rootCmd() *cobra.Command {
	var envFile string
	root := &cobra.Command{
		Use:          "arbol",
		Short:        "Árbol: API server, FCEIA MCP server and setup tasks",
		SilenceUsage: true,
		PersistentPreRunE: func(*cobra.Command, []string) error {
			err := godotenv.Load(envFile)
			if errors.Is(err, fs.ErrNotExist) && envFile == ".env" {
				return nil // optional by default; in production the env comes from the host
			}
			return err
		},
	}
	root.PersistentFlags().StringVar(&envFile, "env-file", ".env", "dotenv file to load (variables already set win)")
	root.AddCommand(upCmd(), serveCmd(), mcpCmd(), migrateCmd(), importCmd(), seedCmd(), planCmd())
	return root
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}

func openDB() (*gorm.DB, error) { return db.Open(os.Getenv("DATABASE_URL")) }

// firebaseAuth uses FIREBASE_PROJECT_ID, and the emulator when
// FIREBASE_AUTH_EMULATOR_HOST is set.
func firebaseAuth(ctx context.Context) (*auth.Client, error) {
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: os.Getenv("FIREBASE_PROJECT_ID")})
	if err != nil {
		return nil, err
	}
	return app.Auth(ctx)
}

func migrateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "migrate",
		Short: "Apply the database migrations (DATABASE_URL)",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			g, err := openDB()
			if err != nil {
				return err
			}
			if err := db.Migrate(g); err != nil {
				return err
			}
			log.Print("migrations applied")
			return nil
		},
	}
}
