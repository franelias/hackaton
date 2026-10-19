// Command migrate applies the database migrations (DATABASE_URL).
package main

import (
	"log"
	"os"

	"github.com/franelias/hackaton/backend/internal/db"
)

func main() {
	g, err := db.Open(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	if err := db.Migrate(g); err != nil {
		log.Fatal(err)
	}
}
