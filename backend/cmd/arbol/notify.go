package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"firebase.google.com/go/v4/auth"
	"github.com/spf13/cobra"
	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/notify"
)

func notifyCmd() *cobra.Command {
	var anyHour bool
	var student string
	cmd := &cobra.Command{
		Use:   "notify",
		Short: "Send the due reminders (push and mail) once",
		Long: "Send the due reminders once: streak at risk, tree about to wilt, pending final before mesas, subject left alone. " +
			"`arbol serve` already does it every NOTIFY_INTERVAL; this is for a manual run or an external cron. " +
			"Config: DATABASE_URL, FIREBASE_PROJECT_ID, APP_URL, PUSH_PROVIDER=fcm (real Firebase credentials), " +
			"SMTP_ADDR, SMTP_USER, SMTP_PASSWORD, MAIL_FROM (without SMTP_ADDR mails are logged).",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			opt := notify.Options{AnyHour: anyHour}
			if student != "" {
				if _, err := fmt.Sscanf(student, "s-%d", &opt.StudentID); err != nil {
					return fmt.Errorf("--student: want s-<n>, got %q", student)
				}
			}
			g, err := openDB()
			if err != nil {
				return err
			}
			authClient, err := firebaseAuth(ctx)
			if err != nil {
				return err
			}
			n, err := notifier(ctx, g, authClient)
			if err != nil {
				return err
			}
			sent, err := n.Run(ctx, opt)
			log.Printf("%d students nudged", sent)
			return err
		},
	}
	cmd.Flags().BoolVar(&anyHour, "any-hour", false, fmt.Sprintf("send outside %d-%dh (Argentina)", notify.FromHour, notify.ToHour))
	cmd.Flags().StringVar(&student, "student", "", "only this student (s-002)")
	return cmd
}

// notifier wires the reminder channels from the environment.
func notifier(ctx context.Context, g *gorm.DB, users *auth.Client) (*notify.Notifier, error) {
	appURL := env("APP_URL", "http://localhost:5173")
	n := &notify.Notifier{DB: g, Users: users, AppURL: appURL, Now: time.Now, Mail: notify.LogMailer{}}
	if addr := os.Getenv("SMTP_ADDR"); addr != "" {
		n.Mail = notify.SMTP{Addr: addr, User: os.Getenv("SMTP_USER"), Password: os.Getenv("SMTP_PASSWORD"), From: env("MAIL_FROM", "Árbol <recordatorios@arbol.local>"), AppURL: appURL}
	}
	switch p := os.Getenv("PUSH_PROVIDER"); p {
	case "":
	case "fcm":
		app, err := firebaseApp(ctx)
		if err != nil {
			return nil, err
		}
		client, err := app.Messaging(ctx)
		if err != nil {
			return nil, fmt.Errorf("FCM: %w", err)
		}
		n.Push = notify.FCM{Client: client}
	default:
		return nil, fmt.Errorf("PUSH_PROVIDER: unknown %q (fcm or empty)", p)
	}
	return n, nil
}
