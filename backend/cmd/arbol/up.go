package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"time"

	"github.com/spf13/cobra"

	"github.com/franelias/hackaton/backend/internal/db"
)

func upCmd() *cobra.Command {
	var noDocker, withSeed bool
	cmd := &cobra.Command{
		Use:   "up",
		Short: "Bring everything up: docker compose, migrations, plan and periods, optional seed, then the API",
		Long: "Bring everything up, from backend/: `docker compose up -d` (Postgres and the Firebase Auth Emulator), " +
			"wait for Postgres, migrate, import the plan and the periods (both replace what was there), " +
			"seed the demo students with --seed, and serve the API.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			if !noDocker {
				compose := exec.CommandContext(ctx, "docker", "compose", "up", "-d")
				compose.Stdout, compose.Stderr = os.Stdout, os.Stderr
				if err := compose.Run(); err != nil {
					return fmt.Errorf("docker compose up: %w", err)
				}
			}
			if err := waitForDB(ctx); err != nil {
				return err
			}
			g, err := openDB()
			if err != nil {
				return err
			}
			if err := db.Migrate(g); err != nil {
				return err
			}
			if err := importPlan(db.Faculty, defaultPlanFile); err != nil {
				return err
			}
			if err := importPeriods(db.Faculty, defaultPeriodsFile); err != nil {
				return err
			}
			if withSeed {
				if host := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST"); host != "" {
					if err := waitForTCP(ctx, "Firebase Auth Emulator", host, 3*time.Minute); err != nil {
						return err
					}
				}
				if err := seed(ctx); err != nil {
					return err
				}
			}
			return serve(ctx)
		},
	}
	cmd.Flags().BoolVar(&noDocker, "no-docker", false, "do not run docker compose (Postgres and Firebase are already up)")
	cmd.Flags().BoolVar(&withSeed, "seed", false, "(re)create the demo students Ana and Beto")
	return cmd
}

// waitForDB retries until Postgres accepts connections.
func waitForDB(ctx context.Context) error {
	deadline := time.Now().Add(time.Minute)
	for {
		g, err := openDB()
		if err == nil {
			if sqlDB, err := g.DB(); err == nil {
				sqlDB.Close()
			}
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("postgres not ready: %w", err)
		}
		log.Print("waiting for postgres…")
		if err := sleep(ctx, 2*time.Second); err != nil {
			return err
		}
	}
}

// waitForTCP retries until addr accepts TCP connections. The emulator
// container downloads firebase-tools on its first start, so it can be slow.
func waitForTCP(ctx context.Context, name, addr string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
		if err == nil {
			return conn.Close()
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("%s not ready at %s: %w", name, addr, err)
		}
		log.Printf("waiting for %s…", name)
		if err := sleep(ctx, 2*time.Second); err != nil {
			return err
		}
	}
}

func sleep(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}
