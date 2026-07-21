// Command extension is the entry point for the Vulcra TEE extension server,
// modeled on the fce-extension-scaffold Docker entry point: it can start the
// tee-node in extension mode (config + sign servers, forward router polling
// PROXY_URL) alongside the extension HTTP server (POST /action, GET /state).
//
// The tee-node sidecar starts only when PROXY_URL is set (as in the Docker
// stack, where the ext-proxy is reachable); a standalone/dev run without a
// proxy serves the extension alone — the E2E driver in tools/cmd/e2e-live
// exercises it with a real in-process tee-node for the decrypt path.
package main

import (
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	teeServer "github.com/flare-foundation/tee-node/pkg/server"

	"github.com/vulcra/tee-extension/internal/config"
	"github.com/vulcra/tee-extension/internal/extension"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	configPort := intEnv("CONFIG_PORT", 5501)
	signPort := intEnv("SIGN_PORT", 7701)
	extensionPort := intEnv("EXTENSION_PORT", 7702)

	// tee-node sidecar (config server + sign server + forward router). The
	// forward router polls the ext-proxy, so it only makes sense with PROXY_URL
	// set (Docker stack) — tee-node reads PROXY_URL itself via settings.init().
	if os.Getenv("PROXY_URL") != "" {
		go teeServer.StartServerExtension(configPort, signPort, extensionPort)
		log.Printf("tee-node extension servers starting (config=%d, sign=%d)", configPort, signPort)
	} else {
		log.Printf("PROXY_URL unset: tee-node sidecar not started (standalone extension mode)")
	}

	ext, err := extension.New(cfg, extensionPort)
	if err != nil {
		log.Fatalf("extension: %v", err)
	}

	errCh := make(chan error, 1)
	go func() { errCh <- ext.Server.ListenAndServe() }()

	log.Printf("vulcra tee-extension %s: simulatedTEE=%v rpc=%s branches=%d listening=:%d",
		config.Version, cfg.SimulatedTEE, cfg.RPCURL, len(cfg.Branches), extensionPort)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	select {
	case sig := <-sigCh:
		log.Printf("shutting down on %v", sig)
	case err := <-errCh:
		log.Fatalf("extension server: %v", err)
	}
}

// intEnv reads an integer environment variable with a default.
func intEnv(name string, def int) int {
	if v := os.Getenv(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
