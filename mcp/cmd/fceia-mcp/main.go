// Command fceia-mcp serves the FCEIA API as an MCP server over Streamable
// HTTP (default) or stdio.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"

	"github.com/franelias/hackaton/mcp/internal/fceia"
	"github.com/franelias/hackaton/mcp/internal/tools"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	stdio := flag.Bool("stdio", false, "serve over stdio instead of HTTP")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	base := os.Getenv("FCEIA_API_BASE")
	if base == "" {
		base = fceia.DefaultBase
	}
	server := tools.NewServer(fceia.New(base), nil)

	if *stdio {
		if err := server.Run(ctx, &mcp.StdioTransport{}); err != nil {
			log.Fatal(err)
		}
		return
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	mux := http.NewServeMux()
	mux.Handle("/mcp", mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil))
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	srv := &http.Server{Addr: ":" + port, Handler: mux}
	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()
	log.Printf("fceia-mcp listening on :%s/mcp", port)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
