package main

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/spf13/cobra"

	"github.com/franelias/hackaton/fceia"
	"github.com/franelias/hackaton/fceia/mcpserver"
)

func mcpCmd() *cobra.Command {
	var stdio bool
	var port string
	cmd := &cobra.Command{
		Use:   "mcp",
		Short: "Serve the FCEIA tools as an MCP server (Streamable HTTP at /mcp, or stdio)",
		Long: "Serve the read-only FCEIA tools (the same ones the tutor uses) as an MCP server, for external clients " +
			"such as a student's own Claude. HTTP serves /mcp and /health. Config: FCEIA_API_BASE.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			server := mcpserver.NewServer(fceia.New(env("FCEIA_API_BASE", fceia.DefaultBase)), nil)
			if stdio {
				return server.Run(ctx, &mcp.StdioTransport{})
			}
			mux := http.NewServeMux()
			mux.Handle("/mcp", mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil))
			mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
			if port == "" {
				port = env("MCP_PORT", "8080")
			}
			srv := &http.Server{Addr: ":" + port, Handler: mux}
			go func() {
				<-ctx.Done()
				srv.Shutdown(context.Background())
			}()
			log.Printf("fceia MCP listening on :%s/mcp", port)
			if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
				return err
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&stdio, "stdio", false, "serve over stdio instead of HTTP")
	// Not PORT: .env sets it for the API, and both can run side by side.
	cmd.Flags().StringVar(&port, "port", "", "HTTP port (default MCP_PORT, else 8080)")
	return cmd
}
