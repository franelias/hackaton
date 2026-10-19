# Shortcuts over the arbol CLI (backend/cmd/arbol) and the Go modules.
# The CLI runs from backend/, where .env, data/ and docker-compose.yml live.

MODULES := corrections fceia backend
ARBOL   := cd backend && go run ./cmd/arbol
IMAGE   ?= arbol

.DEFAULT_GOAL := help

.PHONY: help up up-seed down serve mcp mcp-stdio migrate import seed plan build test test-live vet fmt tidy docker docker-serve docker-mcp

help: ## List the targets
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}'

up: ## Bring everything up: docker compose, migrate, import plan and periods, serve
	$(ARBOL) up

up-seed: ## Same as up, also (re)creating the demo students Ana and Beto
	$(ARBOL) up --seed

down: ## Stop Postgres and the Firebase Auth Emulator
	cd backend && docker compose down

serve: ## Run only the API
	$(ARBOL) serve

mcp: ## Run the FCEIA MCP server over HTTP (MCP_PORT, default 8080)
	$(ARBOL) mcp

mcp-stdio: ## Run the FCEIA MCP server over stdio
	$(ARBOL) mcp --stdio

migrate: ## Apply the database migrations
	$(ARBOL) migrate

import: ## Load the plan and the calendar periods into the database
	$(ARBOL) import plan
	$(ARBOL) import periods

seed: ## (Re)create the demo students Ana and Beto
	$(ARBOL) seed

plan: ## Regenerate data/plan_career_1.json from the FCEIA API
	$(ARBOL) plan

build: ## Build the arbol binary into bin/arbol
	cd backend && go build -o ../bin/arbol ./cmd/arbol

test: ## Run the tests of every module (no network)
	@for m in $(MODULES); do (cd $$m && go test ./...) || exit 1; done

test-live: ## Smoke-test the tools against the real FCEIA API
	cd fceia && go test -tags live ./mcpserver

vet: ## go vet every module
	@for m in $(MODULES); do (cd $$m && go vet ./...) || exit 1; done
	cd fceia && go vet -tags live ./...

fmt: ## gofmt every module
	gofmt -w $(MODULES)

tidy: ## go mod tidy every module
	@for m in $(MODULES); do (cd $$m && go mod tidy) || exit 1; done

docker: ## Build the single image (IMAGE, default arbol)
	docker build -t $(IMAGE) .

docker-serve: docker ## Run the API from the image with backend/.env
	docker run --rm -p 8000:8000 --env-file backend/.env $(IMAGE)

docker-mcp: docker ## Run the MCP server from the image
	docker run --rm -p 8080:8080 $(IMAGE) mcp
