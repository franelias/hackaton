// Command server runs the HTTP API (DATABASE_URL, PORT, FIREBASE_PROJECT_ID;
// FIREBASE_AUTH_EMULATOR_HOST to use the Auth emulator).
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	firebase "firebase.google.com/go/v4"

	"github.com/franelias/hackaton/backend/internal/api"
	"github.com/franelias/hackaton/backend/internal/db"
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
	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}
	s := &api.Server{DB: g, Auth: authClient, Now: time.Now}
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, s.Routes()))
}
